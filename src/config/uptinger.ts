import net from 'net';
import dns from 'dns';
import http from 'http';
import tls from 'tls';
import { lookup as whoisLookup } from 'whois';
import ping from 'ping';
import mqtt from 'mqtt';
import amqplib from 'amqplib';
import WebSocket from 'ws';
import mysql from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';
import { Connection as TediousConnection } from 'tedious';
import { db } from './db.js';
import { IFMonitorParsed, monitorModel } from '../models/monitor.model.js';
import { vpsMetricModel } from '../models/vps-metric.model.js';
import { userOrgModel } from '../models/user_org.model.js';
import { monitorNotifyRecipientModel } from '../models/monitor_notify_recipient.model.js';
import { sendTemplatedMail } from '../utils/notify.utils.js';
import { organizationModel } from '../models/organization.model.js';
import { EmailTemplateType, getAppUrl } from './email-templates.js';

const CHECK_TIMEOUT_MS = 10_000;
const RESYNC_INTERVAL_MS = 30_000;

// Runtime-computed config keys get rewritten on every check (updateDashboardConfig/
// refreshExpiryInfo). They must be excluded when building the resync signature below —
// otherwise every check invalidates the signature on the next resync tick, forcing an
// immediate (0ms) reschedule and making every monitor effectively run on the resync
// cadence instead of its own configured interval.
const RUNTIME_CONFIG_KEYS = new Set([
    'current_response', 'avg_response_24h', 'uptime_24h', 'uptime_30d', 'uptime_1y',
    'last_check_status', 'last_check_msg', 'last_checked_at',
    'cert_exp_date', 'cert_exp_days', 'domain_exp_date', 'domain_exp_days', 'expiry_checked_at'
]);

function staticConfigSignature(config: Record<string, any> | undefined): string {
    if (!config) return '';
    const entries = Object.entries(config).filter(([key]) => !RUNTIME_CONFIG_KEYS.has(key));
    entries.sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(entries);
}

// Types that are actively probed. Anything else (push, manual) is passive —
// it only updates from external pings/manual edits, never from this engine.
const ACTIVE_TYPES = new Set([
    'http', 'http-keyword', 'tcp', 'ping', 'dns', 'docker',
    'smtp', 'mqtt', 'rabbitmq', 'websocket',
    'mssql', 'mongodb', 'mysql', 'postgres', 'redis'
]);

interface ICheckResult {
    ok: boolean;
    ping_ms: number;
    status_code: number;
    msg: string;
    response_headers?: string | null;
}

interface IScheduled {
    timer: NodeJS.Timeout;
    failCount: number;
    signature: string;
}

class UptingerEngine {
    private scheduled = new Map<number, IScheduled>();
    private resyncTimer?: NodeJS.Timeout;

    start(): void {
        this.resync();
        this.resyncTimer = setInterval(() => this.resync(), RESYNC_INTERVAL_MS);
        console.log('⚡ Pinger engine started');
    }

    /** Lets callers (e.g. monitor creation) force an immediate pickup instead of waiting for the next resync tick. */
    resyncNow(): void {
        this.resync();
    }

    stop(): void {
        if (this.resyncTimer) clearInterval(this.resyncTimer);
        for (const { timer } of this.scheduled.values()) clearTimeout(timer);
        this.scheduled.clear();
    }

    /** Picks up new/removed/updated monitors without needing a restart. */
    private resync(): void {
        const monitors = monitorModel.findAll();
        const liveIds = new Set(monitors.map(m => m.id));

        // 'vps' monitors are passive (agent-pushed, see agent.routes.ts) so they're
        // excluded from ACTIVE_TYPES below and never scheduled/run through runCheck().
        // Detecting a dead/uninstalled agent instead means noticing the *absence* of
        // pushes, which only this periodic sweep can do.
        this.checkVpsStaleness(monitors.filter(m => m.type === 'vps' && !m.is_paused));

        for (const id of this.scheduled.keys()) {
            if (!liveIds.has(id)) {
                clearTimeout(this.scheduled.get(id)!.timer);
                this.scheduled.delete(id);
            }
        }

        for (const monitor of monitors) {
            if (!ACTIVE_TYPES.has(monitor.type) || monitor.is_paused) {
                const existing = this.scheduled.get(monitor.id);
                if (existing) {
                    clearTimeout(existing.timer);
                    this.scheduled.delete(monitor.id);
                }
                continue;
            }

            const signature = `${monitor.interval_seconds}:${monitor.retry_interval}:${monitor.type}:${monitor.url}:${monitor.hostname}:${monitor.port}:${staticConfigSignature(monitor.parsed_config)}`;
            const existing = this.scheduled.get(monitor.id);
            if (!existing) {
                this.scheduleNext(monitor.id, 0, signature);
            } else if (existing.signature !== signature) {
                clearTimeout(existing.timer);
                this.scheduleNext(monitor.id, 0, signature);
            }
        }
    }

    // signatureOverride must be passed whenever the caller knows the freshly-computed signature
    // (new monitor, or config change) — otherwise a freshly scheduled entry keeps the '' placeholder
    // signature, which resync() then treats as a mismatch on its very next tick and forces a
    // redundant duplicate check (this previously produced two concurrent checks per monitor).
    private scheduleNext(monitorId: number, delayMs: number, signatureOverride?: string): void {
        const prior = this.scheduled.get(monitorId);
        const timer = setTimeout(() => this.runCheck(monitorId), delayMs);
        this.scheduled.set(monitorId, {
            timer,
            failCount: prior?.failCount ?? 0,
            signature: signatureOverride ?? prior?.signature ?? ''
        });
    }

    private async runCheck(monitorId: number): Promise<void> {
        const monitor = monitorModel.findById(monitorId);
        const state = this.scheduled.get(monitorId);
        if (!monitor || !state) return;

        if (!ACTIVE_TYPES.has(monitor.type) || monitor.is_paused) {
            this.scheduled.delete(monitorId);
            return;
        }

        let result: ICheckResult;
        try {
            result = await this.performCheck(monitor);
        } catch (err: any) {
            result = { ok: false, ping_ms: 0, status_code: 0, msg: err?.message || 'Unknown check error' };
        }

        const failed = !result.ok;
        const nextFailCount = failed ? state.failCount + 1 : 0;
        // >= (not >): the check that reaches the Nth/Nth retry IS the exhausting one — don't burn one more attempt after it.
        const retriesExhausted = failed && nextFailCount >= monitor.max_retries;

        await this.recordResult(monitor, result, state.failCount, retriesExhausted);

        if (retriesExhausted) {
            this.autoPauseMonitor(monitorId);
            return;
        }

        const withinRetryWindow = failed && !retriesExhausted;
        const delaySeconds = withinRetryWindow ? monitor.retry_interval : monitor.interval_seconds;

        state.failCount = nextFailCount;
        this.scheduleNext(monitorId, Math.max(delaySeconds, 1) * 1000);
    }

    /**
     * Marks a 'vps' monitor OFFLINE once its agent stops pushing for 3x its expected
     * interval (default push interval is 30s, so 90s of silence by default) — covers the
     * agent container being stopped, the VPS going down, or a network/firewall change,
     * none of which the agent itself can report since it's the thing that went quiet.
     */
    private checkVpsStaleness(vpsMonitors: IFMonitorParsed[]): void {
        for (const monitor of vpsMonitors) {
            if (monitor.status !== 'ONLINE') continue;

            const staleAfterSeconds = Math.max(monitor.interval_seconds || 30, 30) * 3;
            const latest = vpsMetricModel.latest(monitor.id);
            const lastSeenMs = latest ? new Date(latest.timestamp).getTime() : new Date(monitor.created_at || 0).getTime();
            if (Date.now() - lastSeenMs < staleAfterSeconds * 1000) continue;

            const msg = `No metrics received from agent in over ${staleAfterSeconds}s`;
            db.prepare(`INSERT INTO tbl_monitor_checks (monitor_id, status, ping_ms, status_code, msg) VALUES (?, 'OFFLINE', 0, 0, ?)`)
                .run(monitor.id, msg);
            db.prepare(`UPDATE tbl_monitors SET status = 'OFFLINE', updated_at = ? WHERE id = ?`)
                .run(new Date().toISOString(), monitor.id);

            if (monitor.notify_on_down) {
                this.notify(monitor, 'down', { status_message: msg });
            }
        }
    }

    /** All retries exhausted for this check cycle — stop hammering a dead target and flip it to paused. */
    private autoPauseMonitor(monitorId: number): void {
        db.prepare(`UPDATE tbl_monitors SET is_paused = 1, updated_at = ? WHERE id = ?`)
            .run(new Date().toISOString(), monitorId);

        const state = this.scheduled.get(monitorId);
        if (state) {
            clearTimeout(state.timer);
            this.scheduled.delete(monitorId);
        }

        const monitor = monitorModel.findById(monitorId);
        if (monitor?.notify_on_paused) {
            this.notify(monitor, 'paused', { actor_email: 'automatic retry exhaustion' });
        }
    }

    private async performCheck(monitor: IFMonitorParsed): Promise<ICheckResult> {
        switch (monitor.type) {
            case 'http':
            case 'http-keyword':
                return this.checkHttp(monitor);
            case 'tcp':
                return this.checkTcp(monitor.hostname || monitor.url || '', monitor.port || 80);
            case 'dns':
                return this.checkDns(monitor);
            case 'ping':
                return this.checkPing(monitor.hostname || monitor.url || '');
            case 'docker':
                return this.checkDocker(monitor);
            case 'smtp':
                return this.checkSmtp(monitor.hostname || monitor.url || '', monitor.port || 25);
            case 'mqtt':
                return this.checkMqtt(monitor);
            case 'rabbitmq':
                return this.checkRabbitmq(monitor);
            case 'websocket':
                return this.checkWebsocket(monitor);
            case 'mysql':
                return this.checkMysql(monitor);
            case 'postgres':
                return this.checkPostgres(monitor);
            case 'mongodb':
                return this.checkMongodb(monitor);
            case 'redis':
                return this.checkRedis(monitor);
            case 'mssql':
                return this.checkMssql(monitor);
            default:
                return { ok: false, ping_ms: 0, status_code: 0, msg: `Unsupported monitor type: ${monitor.type}` };
        }
    }

    private async checkHttp(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const url = monitor.url || (monitor.hostname ? `http://${monitor.hostname}` : '');
        if (!url) return { ok: false, ping_ms: 0, status_code: 0, msg: 'No URL configured' };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
        const started = Date.now();

        try {
            const cfg = monitor.parsed_config || {};
            const method = (cfg.http_method || 'GET').toUpperCase();
            let headers: Record<string, string> | undefined;
            if (cfg.request_headers) {
                try { headers = JSON.parse(cfg.request_headers); } catch { headers = undefined; }
            }

            const res = await fetch(url, {
                method,
                headers,
                body: method !== 'GET' && method !== 'HEAD' && cfg.request_body ? cfg.request_body : undefined,
                signal: controller.signal,
                redirect: 'follow'
            });
            const ping_ms = Date.now() - started;
            const body = monitor.type === 'http-keyword' ? await res.text() : '';
            const response_headers = JSON.stringify(Object.fromEntries(res.headers.entries()));

            if (monitor.type === 'http-keyword') {
                const keyword = cfg.keyword;
                if (keyword) {
                    const found = body.includes(keyword);
                    const shouldExist = cfg.invert_keyword !== true;
                    if (found !== shouldExist) {
                        return { ok: false, ping_ms, status_code: res.status, msg: `Keyword check failed (expected ${shouldExist ? 'present' : 'absent'})`, response_headers };
                    }
                }
            }

            const ok = this.isAcceptedStatus(res.status, cfg.accepted_status_codes);
            return { ok, ping_ms, status_code: res.status, msg: ok ? 'OK' : `Unexpected status ${res.status}`, response_headers };
        } catch (err: any) {
            const ping_ms = Date.now() - started;
            const msg = err?.name === 'AbortError' ? `Timed out after ${CHECK_TIMEOUT_MS}ms` : (err?.message || 'Request failed');
            return { ok: false, ping_ms, status_code: 0, msg };
        } finally {
            clearTimeout(timeout);
        }
    }

    /** Parses ranges/comma lists like "200-299,301,302" (defaults to 200-299). */
    private isAcceptedStatus(status: number, spec?: string): boolean {
        const ranges = (spec || '200-299').split(',').map(s => s.trim()).filter(Boolean);
        for (const range of ranges) {
            const [start, end] = range.split('-').map(Number);
            if (!Number.isNaN(start) && (Number.isNaN(end) ? status === start : (status >= start && status <= end))) {
                return true;
            }
        }
        return false;
    }

    private checkTcp(host: string, port: number): Promise<ICheckResult> {
        return new Promise((resolve) => {
            if (!host) return resolve({ ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' });

            const started = Date.now();
            const socket = new net.Socket();
            let settled = false;

            const finish = (result: ICheckResult) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(result);
            };

            socket.setTimeout(CHECK_TIMEOUT_MS);
            socket.once('connect', () => finish({ ok: true, ping_ms: Date.now() - started, status_code: 200, msg: 'Port open' }));
            socket.once('timeout', () => finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `Connection timed out after ${CHECK_TIMEOUT_MS}ms` }));
            socket.once('error', (err) => finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err.message }));

            socket.connect(port, host);
        });
    }

    private checkDns(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const hostname = monitor.hostname || monitor.url || '';
        const cfg = monitor.parsed_config || {};
        const rrType = (cfg.dns_rr_type || 'A').toUpperCase();
        const resolver = cfg.dns_resolve_server;

        return new Promise((resolve) => {
            if (!hostname) return resolve({ ok: false, ping_ms: 0, status_code: 0, msg: 'No hostname configured' });

            const resolverInstance = resolver ? new dns.Resolver() : dns;
            if (resolver && resolverInstance instanceof dns.Resolver) {
                resolverInstance.setServers([resolver]);
            }

            const started = Date.now();
            (resolverInstance as any).resolve(hostname, rrType, (err: any, records: any) => {
                const ping_ms = Date.now() - started;
                if (err) return resolve({ ok: false, ping_ms, status_code: 0, msg: err.message });
                const count = Array.isArray(records) ? records.length : 1;
                resolve({ ok: true, ping_ms, status_code: 200, msg: `Resolved ${count} ${rrType} record(s)` });
            });
        });
    }

    /** Real ICMP echo via the `ping` package (shells out to the OS ping binary). */
    private async checkPing(host: string): Promise<ICheckResult> {
        if (!host) return { ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' };

        const started = Date.now();
        try {
            const res = await ping.promise.probe(host, { timeout: CHECK_TIMEOUT_MS / 1000 });
            const ping_ms = (res.time == null || Number.isNaN(Number(res.time))) ? Date.now() - started : Math.round(Number(res.time));
            if (!res.alive) {
                return { ok: false, ping_ms, status_code: 0, msg: 'Host did not respond to ICMP echo' };
            }
            return { ok: true, ping_ms, status_code: 200, msg: 'ICMP reply received' };
        } catch (err: any) {
            return { ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'Ping failed' };
        }
    }

    /** Real SMTP handshake: expects a 220 greeting then a 250 response to EHLO. */
    private checkSmtp(host: string, port: number): Promise<ICheckResult> {
        return new Promise((resolve) => {
            if (!host) return resolve({ ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' });

            const started = Date.now();
            const socket = new net.Socket();
            let settled = false;
            let stage: 'greeting' | 'ehlo' = 'greeting';
            let buffer = '';

            const finish = (result: ICheckResult) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(result);
            };

            socket.setTimeout(CHECK_TIMEOUT_MS);
            socket.once('timeout', () => finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `Timed out after ${CHECK_TIMEOUT_MS}ms` }));
            socket.once('error', (err) => finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err.message }));

            socket.on('data', (chunk) => {
                buffer += chunk.toString();
                if (!buffer.includes('\r\n')) return;

                if (stage === 'greeting') {
                    if (!buffer.startsWith('220')) {
                        return finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `Unexpected greeting: ${buffer.trim()}` });
                    }
                    buffer = '';
                    stage = 'ehlo';
                    socket.write(`EHLO pinger.local\r\n`);
                } else if (stage === 'ehlo') {
                    if (!buffer.startsWith('250')) {
                        return finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `EHLO rejected: ${buffer.trim()}` });
                    }
                    socket.write('QUIT\r\n');
                    finish({ ok: true, ping_ms: Date.now() - started, status_code: 250, msg: 'SMTP handshake OK' });
                }
            });

            socket.connect(port, host);
        });
    }

    /** Connects with an MQTT client and waits for a real CONNACK. */
    private checkMqtt(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const host = monitor.hostname || monitor.url || '';
        const port = monitor.port || 1883;
        const cfg = monitor.parsed_config || {};

        return new Promise((resolve) => {
            if (!host) return resolve({ ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' });

            const started = Date.now();
            let settled = false;
            const client = mqtt.connect(`mqtt://${host}:${port}`, {
                connectTimeout: CHECK_TIMEOUT_MS,
                username: cfg.db_user || undefined,
                password: cfg.db_password || undefined,
                reconnectPeriod: 0
            });

            const finish = (result: ICheckResult) => {
                if (settled) return;
                settled = true;
                client.end(true);
                resolve(result);
            };

            const timer = setTimeout(() => finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `Timed out after ${CHECK_TIMEOUT_MS}ms` }), CHECK_TIMEOUT_MS);

            client.once('connect', () => {
                clearTimeout(timer);
                if (cfg.mqtt_topic) {
                    client.subscribe(cfg.mqtt_topic, (err) => {
                        if (err) return finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `Subscribe failed: ${err.message}` });
                        finish({ ok: true, ping_ms: Date.now() - started, status_code: 200, msg: `Connected, subscribed to ${cfg.mqtt_topic}` });
                    });
                } else {
                    finish({ ok: true, ping_ms: Date.now() - started, status_code: 200, msg: 'MQTT broker connected' });
                }
            });

            client.once('error', (err) => {
                clearTimeout(timer);
                finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err.message });
            });
        });
    }

    /** Opens a real AMQP 0-9-1 connection to RabbitMQ; optionally verifies a queue exists. */
    private async checkRabbitmq(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const host = monitor.hostname || monitor.url || '';
        const port = monitor.port || 5672;
        const cfg = monitor.parsed_config || {};
        if (!host) return { ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' };

        const started = Date.now();
        let conn: any;
        try {
            conn = await Promise.race([
                amqplib.connect({
                    hostname: host,
                    port,
                    username: cfg.db_user || 'guest',
                    password: cfg.db_password || 'guest'
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS))
            ]);

            if (cfg.rabbitmq_queue) {
                const channel = await conn.createChannel();
                await channel.checkQueue(cfg.rabbitmq_queue);
                await channel.close();
            }

            const ping_ms = Date.now() - started;
            return { ok: true, ping_ms, status_code: 200, msg: cfg.rabbitmq_queue ? `Connected, queue "${cfg.rabbitmq_queue}" exists` : 'AMQP connection OK' };
        } catch (err: any) {
            return { ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'AMQP connection failed' };
        } finally {
            if (conn) conn.close().catch(() => { });
        }
    }

    /** Opens a real WebSocket connection and waits for the 'open' event. */
    private checkWebsocket(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const target = monitor.url || (monitor.hostname ? `ws://${monitor.hostname}:${monitor.port || 80}` : '');

        return new Promise((resolve) => {
            if (!target) return resolve({ ok: false, ping_ms: 0, status_code: 0, msg: 'No URL/host configured' });

            const started = Date.now();
            let settled = false;
            let ws: WebSocket;
            try {
                ws = new WebSocket(target, { handshakeTimeout: CHECK_TIMEOUT_MS });
            } catch (err: any) {
                return resolve({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'Invalid WebSocket URL' });
            }

            const finish = (result: ICheckResult) => {
                if (settled) return;
                settled = true;
                try { ws.terminate(); } catch { /* already closed */ }
                resolve(result);
            };

            const timer = setTimeout(() => finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `Timed out after ${CHECK_TIMEOUT_MS}ms` }), CHECK_TIMEOUT_MS);

            ws.once('open', () => {
                clearTimeout(timer);
                finish({ ok: true, ping_ms: Date.now() - started, status_code: 101, msg: 'WebSocket handshake OK' });
            });
            ws.once('error', (err) => {
                clearTimeout(timer);
                finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err.message });
            });
        });
    }

    /** Queries the Docker Engine API over its unix socket for the named container's running state. */
    private checkDocker(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const cfg = monitor.parsed_config || {};
        const containerName = cfg.container_name;
        const socketPath = monitor.hostname && monitor.hostname !== '' && monitor.hostname !== 'localhost' ? undefined : '/var/run/docker.sock';
        const path = containerName ? `/containers/${encodeURIComponent(containerName)}/json` : '/version';

        return new Promise((resolve) => {
            const started = Date.now();
            const opts: http.RequestOptions = socketPath
                ? { socketPath, path, method: 'GET', timeout: CHECK_TIMEOUT_MS }
                : { host: monitor.hostname, port: monitor.port || 2375, path, method: 'GET', timeout: CHECK_TIMEOUT_MS };

            const req = http.request(opts, (res) => {
                let data = '';
                res.on('data', (c) => data += c);
                res.on('end', () => {
                    const ping_ms = Date.now() - started;
                    if (res.statusCode === 404) {
                        return resolve({ ok: false, ping_ms, status_code: 404, msg: containerName ? `Container "${containerName}" not found` : 'Docker API not found' });
                    }
                    if ((res.statusCode || 0) >= 400) {
                        return resolve({ ok: false, ping_ms, status_code: res.statusCode || 0, msg: `Docker API returned ${res.statusCode}` });
                    }
                    if (containerName) {
                        try {
                            const parsed = JSON.parse(data);
                            const running = parsed?.State?.Running === true;
                            return resolve({ ok: running, ping_ms, status_code: 200, msg: running ? `Container "${containerName}" is running` : `Container "${containerName}" is not running (${parsed?.State?.Status || 'unknown'})` });
                        } catch {
                            return resolve({ ok: false, ping_ms, status_code: 200, msg: 'Could not parse Docker API response' });
                        }
                    }
                    resolve({ ok: true, ping_ms, status_code: 200, msg: 'Docker daemon reachable' });
                });
            });

            req.on('timeout', () => req.destroy(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`)));
            req.on('error', (err: any) => {
                resolve({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'Docker API unreachable' });
            });
            req.end();
        });
    }

    private async checkMysql(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const cfg = monitor.parsed_config || {};
        const host = monitor.hostname || monitor.url || '';
        if (!host) return { ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' };

        const started = Date.now();
        let conn: mysql.Connection | undefined;
        try {
            conn = await mysql.createConnection({
                host,
                port: monitor.port || 3306,
                user: cfg.db_user || 'root',
                password: cfg.db_password || '',
                database: cfg.db_name || undefined,
                connectTimeout: CHECK_TIMEOUT_MS
            });
            await conn.ping();
            return { ok: true, ping_ms: Date.now() - started, status_code: 200, msg: 'MySQL connection OK' };
        } catch (err: any) {
            return { ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'MySQL connection failed' };
        } finally {
            if (conn) await conn.end().catch(() => { });
        }
    }

    private async checkPostgres(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const cfg = monitor.parsed_config || {};
        const host = monitor.hostname || monitor.url || '';
        if (!host) return { ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' };

        const started = Date.now();
        const client = new PgClient({
            host,
            port: monitor.port || 5432,
            user: cfg.db_user || 'postgres',
            password: cfg.db_password || '',
            database: cfg.db_name || 'postgres',
            connectionTimeoutMillis: CHECK_TIMEOUT_MS,
            connectionString: cfg.db_connection_string || undefined
        });

        try {
            await client.connect();
            await client.query('SELECT 1');
            return { ok: true, ping_ms: Date.now() - started, status_code: 200, msg: 'PostgreSQL connection OK' };
        } catch (err: any) {
            return { ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'PostgreSQL connection failed' };
        } finally {
            await client.end().catch(() => { });
        }
    }

    private async checkMongodb(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const cfg = monitor.parsed_config || {};
        const host = monitor.hostname || monitor.url || '';
        if (!host && !cfg.db_connection_string) return { ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' };

        const uri = cfg.db_connection_string ||
            (cfg.db_user
                ? `mongodb://${encodeURIComponent(cfg.db_user)}:${encodeURIComponent(cfg.db_password || '')}@${host}:${monitor.port || 27017}/${cfg.db_name || ''}`
                : `mongodb://${host}:${monitor.port || 27017}/${cfg.db_name || ''}`);

        const started = Date.now();
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: CHECK_TIMEOUT_MS, connectTimeoutMS: CHECK_TIMEOUT_MS });
        try {
            await client.connect();
            await client.db(cfg.db_name || 'admin').command({ ping: 1 });
            return { ok: true, ping_ms: Date.now() - started, status_code: 200, msg: 'MongoDB connection OK' };
        } catch (err: any) {
            return { ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'MongoDB connection failed' };
        } finally {
            await client.close().catch(() => { });
        }
    }

    private checkRedis(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const cfg = monitor.parsed_config || {};
        const host = monitor.hostname || monitor.url || '';

        return new Promise((resolve) => {
            if (!host) return resolve({ ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' });

            const started = Date.now();
            let settled = false;
            const client = new Redis({
                host,
                port: monitor.port || 6379,
                password: cfg.db_password || undefined,
                username: cfg.db_user || undefined,
                connectTimeout: CHECK_TIMEOUT_MS,
                lazyConnect: true,
                retryStrategy: () => null,
                maxRetriesPerRequest: 1
            });

            const finish = (result: ICheckResult) => {
                if (settled) return;
                settled = true;
                client.disconnect();
                resolve(result);
            };

            const timer = setTimeout(() => finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: `Timed out after ${CHECK_TIMEOUT_MS}ms` }), CHECK_TIMEOUT_MS);

            client.connect()
                .then(() => client.ping())
                .then(() => {
                    clearTimeout(timer);
                    finish({ ok: true, ping_ms: Date.now() - started, status_code: 200, msg: 'Redis PONG received' });
                })
                .catch((err: any) => {
                    clearTimeout(timer);
                    finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err?.message || 'Redis connection failed' });
                });
        });
    }

    private checkMssql(monitor: IFMonitorParsed): Promise<ICheckResult> {
        const cfg = monitor.parsed_config || {};
        const host = monitor.hostname || monitor.url || '';

        return new Promise((resolve) => {
            if (!host) return resolve({ ok: false, ping_ms: 0, status_code: 0, msg: 'No host configured' });

            const started = Date.now();
            let settled = false;
            const connection = new TediousConnection({
                server: host,
                options: {
                    port: monitor.port || 1433,
                    database: cfg.db_name || undefined,
                    connectTimeout: CHECK_TIMEOUT_MS,
                    encrypt: true,
                    trustServerCertificate: true
                },
                authentication: {
                    type: 'default',
                    options: {
                        userName: cfg.db_user || 'sa',
                        password: cfg.db_password || ''
                    }
                }
            } as any);

            const finish = (result: ICheckResult) => {
                if (settled) return;
                settled = true;
                try { connection.close(); } catch { /* already closed */ }
                resolve(result);
            };

            connection.on('connect', (err) => {
                if (err) return finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err.message });
                finish({ ok: true, ping_ms: Date.now() - started, status_code: 200, msg: 'MSSQL connection OK' });
            });
            connection.on('error', (err) => {
                finish({ ok: false, ping_ms: Date.now() - started, status_code: 0, msg: err.message });
            });

            connection.connect();
        });
    }

    /** Opens a TLS connection and reads the peer certificate's expiry. Only meaningful for https:// targets. */
    private getCertExpiry(hostname: string, port: number): Promise<{ date: string; days: number } | null> {
        return new Promise((resolve) => {
            const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: CHECK_TIMEOUT_MS, rejectUnauthorized: false }, () => {
                const cert = socket.getPeerCertificate();
                socket.destroy();
                if (!cert || !cert.valid_to) return resolve(null);
                const validTo = new Date(cert.valid_to);
                const days = Math.ceil((validTo.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                resolve({ date: validTo.toISOString().slice(0, 10), days });
            });
            socket.once('error', () => resolve(null));
            socket.once('timeout', () => { socket.destroy(); resolve(null); });
        });
    }

    /**
     * RDAP is the IETF-standard, JSON-over-HTTPS replacement for legacy port-43 WHOIS. rdap.org
     * runs the IANA bootstrap redirect, so one URL works for any TLD without us maintaining a
     * per-registry server list. Registries are actively retiring legacy WHOIS in favor of this
     * (e.g. VeriSign's WHOIS server now returns a "being retired... rate limit exceeded" message
     * instead of data), so RDAP is the primary and more durable lookup path.
     */
    private async queryRdapExpiry(domain: string): Promise<{ date: string; days: number } | null> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) return null;

            const json: any = await res.json();
            const events: Array<{ eventAction: string; eventDate: string }> = json?.events || [];
            const expiryEvent = events.find(e => e.eventAction === 'expiration');
            if (!expiryEvent) return null;

            const parsed = new Date(expiryEvent.eventDate);
            if (Number.isNaN(parsed.getTime())) return null;
            const days = Math.ceil((parsed.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
            return { date: parsed.toISOString().slice(0, 10), days };
        } catch {
            return null;
        }
    }

    /** Runs a single legacy whois query (optionally following a registrar referral) and extracts the expiry date. */
    private queryWhoisExpiry(domain: string, follow: number): Promise<{ date: string; days: number } | null> {
        return new Promise((resolve) => {
            whoisLookup(domain, { timeout: CHECK_TIMEOUT_MS, follow }, (err, data) => {
                if (err || typeof data !== 'string') return resolve(null);
                const match = data.match(/(?:Registry Expiry Date|Registrar Registration Expiration Date|Expiration Date|Expiry Date|paid-till|renewal date)\s*:\s*(.+)/i);
                if (!match) return resolve(null);
                const parsed = new Date(match[1].trim());
                if (Number.isNaN(parsed.getTime())) return resolve(null);
                const days = Math.ceil((parsed.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                resolve({ date: parsed.toISOString().slice(0, 10), days });
            });
        });
    }

    /**
     * Looks up domain registration expiry. Tries RDAP first (see queryRdapExpiry) since it's the
     * modern standard and not subject to legacy WHOIS rate-limiting/retirement. Falls back to
     * legacy WHOIS (with a same-request retry if the `follow` referral hits a blank
     * "Registrar WHOIS Server:" line — some registrars, e.g. Hostinger, publish that field empty,
     * which makes the `whois` package try to connect to it and fail against 127.0.0.1:43) only if
     * RDAP has no answer, e.g. for TLDs not covered by the IANA RDAP bootstrap.
     */
    private async getDomainExpiry(hostname: string): Promise<{ date: string; days: number } | null> {
        const parts = hostname.split('.');
        const domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;

        const viaRdap = await this.queryRdapExpiry(domain);
        if (viaRdap) return viaRdap;

        const followed = await this.queryWhoisExpiry(domain, 2);
        if (followed) return followed;

        return this.queryWhoisExpiry(domain, 0);
    }

    /** Refreshes cert/domain expiry for https monitors, throttled to once per 12h since lookups are slow/rate-limited. */
    private async refreshExpiryInfo(monitor: IFMonitorParsed): Promise<Record<string, any>> {
        const cfg = monitor.parsed_config || {};
        const isHttps = monitor.type === 'http' || monitor.type === 'http-keyword';
        if (!isHttps) return {};

        let hostname = monitor.hostname;
        let tlsPort = 443;
        try {
            if (monitor.url) {
                const parsedUrl = new URL(monitor.url);
                if (!hostname) hostname = parsedUrl.hostname;
                // The URL's own port (e.g. https://example.com:8443) is the one actually
                // serving TLS. monitor.port is the HTTP check port and defaults to 80 for
                // this monitor type — using it here would connect to the wrong port and
                // always fail the handshake, leaving cert expiry permanently N/A.
                if (parsedUrl.port) tlsPort = parseInt(parsedUrl.port, 10);
            }
        } catch { /* invalid URL, skip */ }
        const usesHttps = monitor.url ? monitor.url.startsWith('https://') : true;
        if (!hostname || !usesHttps) return {};

        const lastChecked = cfg.expiry_checked_at ? new Date(cfg.expiry_checked_at).getTime() : 0;
        if (Date.now() - lastChecked < 12 * 60 * 60 * 1000) return {};

        const [cert, domain] = await Promise.all([
            this.getCertExpiry(hostname, tlsPort),
            this.getDomainExpiry(hostname)
        ]);

        // Only commit to the 12h cache when we actually got something — a transient failure
        // (network blip, target briefly unreachable) would otherwise stamp expiry_checked_at
        // and lock the monitor into showing N/A for a full 12 hours before it's retried, even
        // though the very next check cycle might well have succeeded.
        if (!cert && !domain) return {};

        return {
            cert_exp_date: cert ? cert.date : null,
            cert_exp_days: cert ? `${cert.days} days` : null,
            domain_exp_date: domain ? domain.date : null,
            domain_exp_days: domain ? `${domain.days} days` : null,
            expiry_checked_at: new Date().toISOString()
        };
    }

    private async recordResult(monitor: IFMonitorParsed, result: ICheckResult, priorFailCount: number, retriesExhausted: boolean): Promise<void> {
        const isDown = !result.ok && retriesExhausted;
        const isRetrying = !result.ok && !isDown;
        // Only flip the persisted status to OFFLINE once retries are exhausted — while a
        // retry is still in progress, keep the monitor's stored status as its prior value
        // so the Up/Down filter doesn't flag it as down before it's actually considered down.
        const status = result.ok ? 'ONLINE' : (isRetrying ? monitor.status : 'OFFLINE');
        const priorStatus = monitor.status;

        const msg = isRetrying
            ? `${result.msg} (retry ${priorFailCount + 1}/${monitor.max_retries})`
            : (isDown ? `${result.msg} — retries exhausted, monitor auto-paused` : result.msg);

        db.prepare(`
            INSERT INTO tbl_monitor_checks (monitor_id, status, ping_ms, status_code, msg, response_headers)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(monitor.id, result.ok ? 'ONLINE' : 'OFFLINE', result.ping_ms, result.status_code, msg, result.response_headers ?? null);

        db.prepare(`UPDATE tbl_monitors SET status = ?, updated_at = ? WHERE id = ?`)
            .run(status, new Date().toISOString(), monitor.id);

        this.updateAnalytics(monitor.id, status);
        const expiryInfo = await this.refreshExpiryInfo(monitor);
        this.updateDashboardConfig(monitor, result, status, expiryInfo);

        if (priorStatus !== status) {
            if (status === 'OFFLINE' && monitor.notify_on_down) {
                this.notify(monitor, 'down', { status_message: msg });
            } else if (status === 'ONLINE' && priorStatus === 'OFFLINE' && monitor.notify_on_recovery) {
                this.notify(monitor, 'recovery', {});
            }
        }
    }

    /** Best-effort templated alert email to the monitor's chosen recipients (or every org member if none are set). Never throws into the check loop. */
    private notify(monitor: IFMonitorParsed, type: EmailTemplateType, extraVars: Record<string, string | number | undefined>): void {
        const members = userOrgModel.listMembers(monitor.org_id);
        const recipientIds = monitorNotifyRecipientModel.listUserIds(monitor.id);
        const scopedMembers = recipientIds.length > 0
            ? members.filter(m => recipientIds.includes(m.user_id))
            : members;
        const to = scopedMembers.map(m => m.email).filter(Boolean);
        if (to.length === 0) return;

        const org = organizationModel.findById(monitor.org_id);
        sendTemplatedMail(monitor.org_id, type, to, {
            monitor_name: monitor.name,
            org_name: org?.name || '',
            action_url: `${getAppUrl()}/dashboard`,
            ...extraVars,
        }).catch(err => {
            console.error(`Failed to send notification email for monitor ${monitor.id}:`, err.message);
        });
    }

    private updateAnalytics(monitorId: number, status: string): void {
        const totals = db.prepare(`
            SELECT
                COUNT(*) AS total_checks,
                COALESCE(AVG(ping_ms), 0) AS average_response_time,
                SUM(CASE WHEN status = 'ONLINE' THEN 1 ELSE 0 END) AS up_checks,
                SUM(CASE WHEN status != 'ONLINE' THEN 1 ELSE 0 END) AS down_checks
            FROM tbl_monitor_checks WHERE monitor_id = ?
        `).get(monitorId) as any;

        const window24h = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status != 'ONLINE' THEN 1 ELSE 0 END) AS down
            FROM tbl_monitor_checks
            WHERE monitor_id = ? AND timestamp >= datetime('now', '-1 day')
        `).get(monitorId) as any;

        const window30d = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status != 'ONLINE' THEN 1 ELSE 0 END) AS down
            FROM tbl_monitor_checks
            WHERE monitor_id = ? AND timestamp >= datetime('now', '-30 day')
        `).get(monitorId) as any;

        const intervalSeconds = (db.prepare(`SELECT interval_seconds FROM tbl_monitors WHERE id = ?`).get(monitorId) as any)?.interval_seconds || 60;

        const totalDowntime = (totals.down_checks || 0) * intervalSeconds;
        const totalUptime = (totals.up_checks || 0) * intervalSeconds;
        const downtime24h = (window24h.down || 0) * intervalSeconds;
        const uptime24h = ((window24h.total || 0) - (window24h.down || 0)) * intervalSeconds;
        const downtime30d = (window30d.down || 0) * intervalSeconds;
        const uptime30d = ((window30d.total || 0) - (window30d.down || 0)) * intervalSeconds;

        db.prepare(`
            INSERT INTO tbl_monitor_analytics (
                monitor_id, total_checks, average_response_time,
                total_downtime, total_downtime_24h, total_downtime_30d,
                total_uptime, total_uptime_24h, total_uptime_30d,
                status, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(monitor_id) DO UPDATE SET
                total_checks = excluded.total_checks,
                average_response_time = excluded.average_response_time,
                total_downtime = excluded.total_downtime,
                total_downtime_24h = excluded.total_downtime_24h,
                total_downtime_30d = excluded.total_downtime_30d,
                total_uptime = excluded.total_uptime,
                total_uptime_24h = excluded.total_uptime_24h,
                total_uptime_30d = excluded.total_uptime_30d,
                status = excluded.status,
                timestamp = excluded.timestamp
        `).run(
            monitorId, totals.total_checks || 0, Math.round(totals.average_response_time || 0),
            totalDowntime, downtime24h, downtime30d,
            totalUptime, uptime24h, uptime30d,
            status, new Date().toISOString()
        );
    }

    /** Keeps the JSON config mirror in sync so the dashboard (which reads parsed_config) never shows stale numbers. */
    private updateDashboardConfig(monitor: IFMonitorParsed, result: ICheckResult, status: string, expiryInfo: Record<string, any> = {}): void {
        const window24h = db.prepare(`
            SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'ONLINE' THEN 1 ELSE 0 END) AS down
            FROM tbl_monitor_checks WHERE monitor_id = ? AND timestamp >= datetime('now', '-1 day')
        `).get(monitor.id) as any;

        const window30d = db.prepare(`
            SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'ONLINE' THEN 1 ELSE 0 END) AS down
            FROM tbl_monitor_checks WHERE monitor_id = ? AND timestamp >= datetime('now', '-30 day')
        `).get(monitor.id) as any;

        const window1y = db.prepare(`
            SELECT COUNT(*) AS total, SUM(CASE WHEN status != 'ONLINE' THEN 1 ELSE 0 END) AS down
            FROM tbl_monitor_checks WHERE monitor_id = ? AND timestamp >= datetime('now', '-365 day')
        `).get(monitor.id) as any;

        const avg24h = db.prepare(`
            SELECT COALESCE(AVG(ping_ms), 0) AS avg FROM tbl_monitor_checks
            WHERE monitor_id = ? AND timestamp >= datetime('now', '-1 day')
        `).get(monitor.id) as any;

        const pct = (total: number, down: number) => total > 0 ? `${(((total - down) / total) * 100).toFixed(2)}%` : '100%';

        const config = {
            ...monitor.parsed_config,
            current_response: `${result.ping_ms}ms`,
            avg_response_24h: `${Math.round(avg24h.avg || 0)}ms`,
            uptime_24h: pct(window24h.total || 0, window24h.down || 0),
            uptime_30d: pct(window30d.total || 0, window30d.down || 0),
            uptime_1y: pct(window1y.total || 0, window1y.down || 0),
            last_check_status: status,
            last_check_msg: result.msg,
            last_checked_at: new Date().toISOString(),
            ...expiryInfo
        };

        db.prepare(`UPDATE tbl_monitors SET config = ? WHERE id = ?`).run(JSON.stringify(config), monitor.id);
    }
}

export const uptinger = new UptingerEngine();
