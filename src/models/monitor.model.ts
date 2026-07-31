import { db } from '../config/db.js';
import { tagModel } from './tag.model.js';
import { encrypt, decrypt } from '../utils/crypto.utils.js';

// Config fields that hold credentials — encrypted at rest, decrypted only when a
// monitor is read back into memory (e.g. to run a check or pre-fill the edit form).
const SECRET_CONFIG_FIELDS = ['db_password', 'db_connection_string'] as const;

function encryptSecrets(config: Record<string, any>): Record<string, any> {
    const out = { ...config };
    for (const field of SECRET_CONFIG_FIELDS) {
        if (out[field]) out[field] = encrypt(out[field]);
    }
    return out;
}

// SQLite's CURRENT_TIMESTAMP stores UTC as "YYYY-MM-DD HH:MM:SS" with no timezone
// marker, so `new Date(...)` on the client would misread it as local time. Normalize
// to a proper UTC ISO string ("...T...Z") before it ever reaches the client.
function toUtcIso(sqliteTimestamp: string): string {
    if (sqliteTimestamp.includes('T') || sqliteTimestamp.endsWith('Z')) return sqliteTimestamp;
    return sqliteTimestamp.replace(' ', 'T') + 'Z';
}

function decryptSecrets(config: Record<string, any>): Record<string, any> {
    const out = { ...config };
    for (const field of SECRET_CONFIG_FIELDS) {
        if (out[field]) out[field] = decrypt(out[field]);
    }
    return out;
}

export interface IFMonitor {
    id: number;
    org_id: number;
    group_id?: number | null;
    name: string;
    type: string;
    url?: string;
    hostname?: string;
    port?: number;
    interval_seconds: number;
    retry_interval: number;
    max_retries: number;
    resend_interval: number;
    status: string;
    is_paused: number | boolean;
    tags: string;
    config: string;
    notify_on_down?: number | boolean;
    notify_on_paused?: number | boolean;
    notify_on_recovery?: number | boolean;
    created_at?: string;
    updated_at?: string;
}

export interface IFMonitorParsed extends IFMonitor {
    parsed_config: Record<string, any>;
    parsed_tags: string[];
    heartbeats?: any[];
    logs?: any[];
}

class MonitorModel {
    // Pass orgId to scope results to one organization (dashboard/API list views).
    // Omit it only for system-wide jobs (e.g. the pinger's background check runner).
    // Pass groupIds to further restrict to monitors assigned to those groups only
    // (used for non-admin users who are scoped to specific Groups).
    findAll(orgId?: number, groupIds?: number[]): IFMonitorParsed[] {
        let rows: IFMonitor[];
        if (orgId && groupIds) {
            if (groupIds.length === 0) {
                rows = [];
            } else {
                const placeholders = groupIds.map(() => '?').join(',');
                rows = db.prepare(`SELECT * FROM tbl_monitors WHERE org_id = ? AND group_id IN (${placeholders}) ORDER BY id ASC`).all(orgId, ...groupIds) as IFMonitor[];
            }
        } else if (orgId) {
            rows = db.prepare(`SELECT * FROM tbl_monitors WHERE org_id = ? ORDER BY id ASC`).all(orgId) as IFMonitor[];
        } else {
            rows = db.prepare(`SELECT * FROM tbl_monitors ORDER BY id ASC`).all() as IFMonitor[];
        }
        if (rows.length === 0) return [];

        // Batch tags/heartbeats for every monitor in this page in two queries total,
        // instead of parseMonitor's usual 2 queries-per-row (N+1 on the dashboard poll).
        const ids = rows.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');

        const tagRows = db.prepare(`
            SELECT mt.monitor_id, t.name FROM tbl_tags t
            JOIN tbl_monitor_tags mt ON mt.tag_id = t.id
            WHERE mt.monitor_id IN (${placeholders})
            ORDER BY t.name COLLATE NOCASE ASC
        `).all(...ids) as { monitor_id: number; name: string }[];
        const tagsByMonitor = new Map<number, string[]>();
        for (const tr of tagRows) {
            if (!tagsByMonitor.has(tr.monitor_id)) tagsByMonitor.set(tr.monitor_id, []);
            tagsByMonitor.get(tr.monitor_id)!.push(tr.name);
        }

        // Ranked per monitor so only the latest 50 checks per monitor come back,
        // matching parseMonitor's single-row `LIMIT 50`.
        const checkRows = db.prepare(`
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY id DESC) AS rn
                FROM tbl_monitor_checks
                WHERE monitor_id IN (${placeholders})
            ) WHERE rn <= 50
        `).all(...ids) as any[];
        const checksByMonitor = new Map<number, any[]>();
        for (const cr of checkRows) {
            if (!checksByMonitor.has(cr.monitor_id)) checksByMonitor.set(cr.monitor_id, []);
            checksByMonitor.get(cr.monitor_id)!.push(cr);
        }

        return rows.map(r => this.parseMonitor(r, tagsByMonitor.get(r.id), checksByMonitor.get(r.id)));
    }

    findById(id: number): IFMonitorParsed | undefined {
        const row = db.prepare(`SELECT * FROM tbl_monitors WHERE id = ?`).get(id) as IFMonitor | undefined;
        if (!row) return undefined;
        return this.parseMonitor(row);
    }

    create(data: {
        name: string;
        type: string;
        url?: string;
        hostname?: string;
        port?: number;
        interval_seconds?: number;
        retry_interval?: number;
        max_retries?: number;
        resend_interval?: number;
        tags?: string;
        config?: Record<string, any>;
        org_id?: number;
        group_id?: number | null;
        created_by?: number;
        notify_on_down?: boolean;
        notify_on_paused?: boolean;
        notify_on_recovery?: boolean;
    }): IFMonitorParsed {
        const stmt = db.prepare(`
            INSERT INTO tbl_monitors (
                org_id, group_id, name, type, url, hostname, port,
                interval_seconds, retry_interval, max_retries, resend_interval,
                status, is_paused, tags, config, created_at, updated_at, created_by,
                notify_on_down, notify_on_paused, notify_on_recovery
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONLINE', 0, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const configObj = data.config || {};
        // Add default stats for new monitor rendering
        if (!configObj.current_response) configObj.current_response = '45ms';
        if (!configObj.avg_response_24h) configObj.avg_response_24h = '45ms';
        if (!configObj.uptime_24h) configObj.uptime_24h = '100%';
        if (!configObj.uptime_30d) configObj.uptime_30d = '100%';
        if (!configObj.uptime_1y) configObj.uptime_1y = '100%';

        const now = new Date().toISOString();
        const res = stmt.run(
            data.org_id ?? null,
            data.group_id ?? null,
            data.name,
            data.type || 'http',
            data.url || '',
            data.hostname || '',
            data.port || (data.type === 'dns' ? 53 : data.type === 'postgres' ? 5432 : 80),
            data.interval_seconds || 60,
            data.retry_interval || 60,
            data.max_retries || 3,
            data.resend_interval || 0,
            data.tags || '',
            JSON.stringify(encryptSecrets(configObj)),
            now,
            now,
            data.created_by ?? null,
            data.notify_on_down === false ? 0 : 1,
            data.notify_on_paused ? 1 : 0,
            data.notify_on_recovery === false ? 0 : 1
        );

        const newId = Number(res.lastInsertRowid);

        if (data.org_id) {
            const tagNames = (data.tags || '').split(',').map(t => t.trim()).filter(Boolean);
            tagModel.setForMonitor(newId, data.org_id, tagNames);
        }

        // No fabricated "success" heartbeat here — the pinger engine runs the first
        // real check moments after creation (see resyncNow() in the create route)
        // and that check's actual result becomes the first tbl_monitor_checks row.
        return this.findById(newId)!;
    }

    update(id: number, data: Partial<IFMonitor & { configObj: Record<string, any> }>): IFMonitorParsed | undefined {
        const existing = this.findById(id);
        if (!existing) return undefined;

        const mergedConfig = {
            ...existing.parsed_config,
            ...(data.configObj || {})
        };

        const stmt = db.prepare(`
            UPDATE tbl_monitors SET
                name = COALESCE(?, name),
                type = COALESCE(?, type),
                url = COALESCE(?, url),
                hostname = COALESCE(?, hostname),
                port = COALESCE(?, port),
                interval_seconds = COALESCE(?, interval_seconds),
                retry_interval = COALESCE(?, retry_interval),
                max_retries = COALESCE(?, max_retries),
                tags = COALESCE(?, tags),
                group_id = ?,
                notify_on_down = COALESCE(?, notify_on_down),
                notify_on_paused = COALESCE(?, notify_on_paused),
                notify_on_recovery = COALESCE(?, notify_on_recovery),
                config = ?,
                updated_at = ?
            WHERE id = ?
        `);

        stmt.run(
            data.name ?? null,
            data.type ?? null,
            data.url ?? null,
            data.hostname ?? null,
            data.port ?? null,
            data.interval_seconds ?? null,
            data.retry_interval ?? null,
            data.max_retries ?? null,
            data.tags ?? null,
            data.group_id === undefined ? existing.group_id ?? null : data.group_id,
            data.notify_on_down === undefined ? null : (data.notify_on_down ? 1 : 0),
            data.notify_on_paused === undefined ? null : (data.notify_on_paused ? 1 : 0),
            data.notify_on_recovery === undefined ? null : (data.notify_on_recovery ? 1 : 0),
            JSON.stringify(encryptSecrets(mergedConfig)),
            new Date().toISOString(),
            id
        );

        if (data.tags !== undefined) {
            const tagNames = data.tags.split(',').map(t => t.trim()).filter(Boolean);
            tagModel.setForMonitor(id, existing.org_id, tagNames);
        }

        return this.findById(id);
    }

    togglePause(id: number): IFMonitorParsed | undefined {
        const existing = this.findById(id);
        if (!existing) return undefined;

        const nextPause = existing.is_paused ? 0 : 1;
        db.prepare(`UPDATE tbl_monitors SET is_paused = ? WHERE id = ?`).run(nextPause, id);
        return this.findById(id);
    }

    delete(id: number): boolean {
        db.prepare(`DELETE FROM tbl_monitor_checks WHERE monitor_id = ?`).run(id);
        const res = db.prepare(`DELETE FROM tbl_monitors WHERE id = ?`).run(id);
        return res.changes > 0;
    }

    /** Wipes all check history/analytics for a monitor while leaving its own settings (interval, retries, etc.) untouched. */
    resetData(id: number): IFMonitorParsed | undefined {
        const existing = this.findById(id);
        if (!existing) return undefined;

        db.prepare(`DELETE FROM tbl_monitor_checks WHERE monitor_id = ?`).run(id);
        db.prepare(`DELETE FROM tbl_monitor_analytics WHERE monitor_id = ?`).run(id);

        const RUNTIME_CONFIG_KEYS = [
            'current_response', 'avg_response_24h', 'uptime_24h', 'uptime_30d', 'uptime_1y',
            'last_check_status', 'last_check_msg', 'last_checked_at',
            'cert_exp_date', 'cert_exp_days', 'domain_exp_date', 'domain_exp_days', 'expiry_checked_at'
        ];
        const staticConfig = { ...existing.parsed_config };
        for (const key of RUNTIME_CONFIG_KEYS) delete staticConfig[key];

        db.prepare(`UPDATE tbl_monitors SET status = 'ONLINE', config = ?, updated_at = ? WHERE id = ?`)
            .run(JSON.stringify(encryptSecrets(staticConfig)), new Date().toISOString(), id);

        return this.findById(id);
    }

    private parseMonitor(r: IFMonitor, presetTags?: string[], presetChecks?: any[]): IFMonitorParsed {
        let parsedConfig: Record<string, any> = {};
        try {
            parsedConfig = decryptSecrets(JSON.parse(r.config || '{}'));
        } catch {
            parsedConfig = {};
        }

        const tagsArr = presetTags ?? tagModel.getForMonitor(r.id).map(t => t.name);

        // Fetch heartbeats (unless already batch-fetched by findAll)
        const hbs = presetChecks ?? db.prepare(`
            SELECT * FROM tbl_monitor_checks
            WHERE monitor_id = ?
            ORDER BY id DESC LIMIT 50
        `).all(r.id) as any[];

        const logs = hbs.map(h => ({
            id: h.id,
            timestamp: h.timestamp ? toUtcIso(h.timestamp) : '',
            status: h.status_code === 200 ? '200 OK' : 'ERROR',
            ms: h.ping_ms,
            type: 'heartbeat',
            msg: h.msg || 'Check completed',
            response_headers: h.response_headers || null
        }));

        const heartbeats = hbs.reverse().map(h => ({
            status: h.status === 'ONLINE' ? 'up' : 'down',
            ping: h.ping_ms,
            time: h.timestamp ? new Date(toUtcIso(h.timestamp)).toISOString().slice(11, 16) : '00:00',
            timestamp: h.timestamp ? toUtcIso(h.timestamp) : null
        }));

        return {
            ...r,
            is_paused: Boolean(r.is_paused),
            parsed_config: parsedConfig,
            parsed_tags: tagsArr,
            heartbeats,
            logs
        };
    }
}

export const monitorModel = new MonitorModel();

// Shape consumed by the dashboard view / live-polling API. Kept in one place
// so the initial server render and the client-side refresh stay identical.
export function toDashboardSite(m: IFMonitorParsed) {
    return {
        id: m.id,
        name: m.name,
        type: m.type,
        url: m.url || m.hostname || '',
        hostname: m.hostname || '',
        port: m.port,
        status: m.status || 'ONLINE',
        uptime_percentage: m.parsed_config.uptime_24h || '100%',
        current_response: m.parsed_config.current_response || '45ms',
        avg_response_24h: m.parsed_config.avg_response_24h || '45ms',
        uptime_24h: m.parsed_config.uptime_24h || '100%',
        uptime_30d: m.parsed_config.uptime_30d || '100%',
        uptime_1y: m.parsed_config.uptime_1y || '100%',
        cert_exp_date: m.parsed_config.cert_exp_date ?? null,
        cert_exp_days: m.parsed_config.cert_exp_days ?? null,
        domain_exp_date: m.parsed_config.domain_exp_date ?? null,
        domain_exp_days: m.parsed_config.domain_exp_days ?? null,
        interval_seconds: m.interval_seconds || 60,
        max_retries: m.max_retries,
        retry_interval: m.retry_interval,
        is_paused: m.is_paused,
        tags: m.parsed_tags,
        config: m.parsed_config,
        group_id: m.group_id ?? null,
        notify_on_down: Boolean(m.notify_on_down),
        notify_on_paused: Boolean(m.notify_on_paused),
        notify_on_recovery: Boolean(m.notify_on_recovery),
        heartbeats: m.heartbeats || [],
        logs: m.logs || []
    };
}
