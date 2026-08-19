import { db } from '../config/db.js';

export interface IFVpsMetricInput {
    cpu_pct?: number;
    load1?: number;
    load5?: number;
    load15?: number;
    ram_used_mb?: number;
    ram_total_mb?: number;
    swap_used_mb?: number;
    swap_total_mb?: number;
    disks?: Array<{ mount: string; used_mb: number; total_mb: number }>;
    net_rx_bytes?: number;
    net_tx_bytes?: number;
    uptime_seconds?: number;
    nginx_active_connections?: number;
    nginx_requests_total?: number;
    nginx_recent_errors?: string[];
    nginx_recent_access?: string[];
    agent_version?: string;
}

export interface IFVpsMetric extends IFVpsMetricInput {
    id: number;
    monitor_id: number;
    timestamp: string;
}

// SQLite's CURRENT_TIMESTAMP has no timezone marker; normalize to UTC ISO before it
// reaches the client, same convention as monitor.model.ts's toUtcIso().
function toUtcIso(sqliteTimestamp: string): string {
    if (sqliteTimestamp.includes('T') || sqliteTimestamp.endsWith('Z')) return sqliteTimestamp;
    return sqliteTimestamp.replace(' ', 'T') + 'Z';
}

function parseRow(r: any): IFVpsMetric {
    return {
        id: r.id,
        monitor_id: r.monitor_id,
        cpu_pct: r.cpu_pct,
        load1: r.load1,
        load5: r.load5,
        load15: r.load15,
        ram_used_mb: r.ram_used_mb,
        ram_total_mb: r.ram_total_mb,
        swap_used_mb: r.swap_used_mb,
        swap_total_mb: r.swap_total_mb,
        disks: safeParseArray(r.disks),
        net_rx_bytes: r.net_rx_bytes,
        net_tx_bytes: r.net_tx_bytes,
        uptime_seconds: r.uptime_seconds,
        nginx_active_connections: r.nginx_active_connections,
        nginx_requests_total: r.nginx_requests_total,
        nginx_recent_errors: safeParseArray(r.nginx_recent_errors),
        nginx_recent_access: safeParseArray(r.nginx_recent_access),
        agent_version: r.agent_version,
        timestamp: toUtcIso(r.timestamp)
    };
}

function safeParseArray(value: string | null | undefined): any[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

class VpsMetricModel {
    create(monitorId: number, data: IFVpsMetricInput): IFVpsMetric {
        const stmt = db.prepare(`
            INSERT INTO tbl_vps_metrics (
                monitor_id, cpu_pct, load1, load5, load15,
                ram_used_mb, ram_total_mb, swap_used_mb, swap_total_mb, disks,
                net_rx_bytes, net_tx_bytes, uptime_seconds,
                nginx_active_connections, nginx_requests_total, nginx_recent_errors, nginx_recent_access, agent_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const res = stmt.run(
            monitorId,
            data.cpu_pct ?? null,
            data.load1 ?? null,
            data.load5 ?? null,
            data.load15 ?? null,
            data.ram_used_mb ?? null,
            data.ram_total_mb ?? null,
            data.swap_used_mb ?? null,
            data.swap_total_mb ?? null,
            JSON.stringify(data.disks ?? []),
            data.net_rx_bytes ?? null,
            data.net_tx_bytes ?? null,
            data.uptime_seconds ?? null,
            data.nginx_active_connections ?? null,
            data.nginx_requests_total ?? null,
            JSON.stringify(data.nginx_recent_errors ?? []),
            JSON.stringify(data.nginx_recent_access ?? []),
            data.agent_version ?? null
        );

        return this.findById(Number(res.lastInsertRowid))!;
    }

    findById(id: number): IFVpsMetric | undefined {
        const row = db.prepare(`SELECT * FROM tbl_vps_metrics WHERE id = ?`).get(id) as any;
        return row ? parseRow(row) : undefined;
    }

    latest(monitorId: number): IFVpsMetric | undefined {
        const row = db.prepare(`
            SELECT * FROM tbl_vps_metrics WHERE monitor_id = ? ORDER BY id DESC LIMIT 1
        `).get(monitorId) as any;
        return row ? parseRow(row) : undefined;
    }

    getRange(monitorId: number, sinceIso?: string, limit = 500): IFVpsMetric[] {
        const sinceSqlite = sinceIso ? sinceIso.replace('T', ' ').replace(/\.\d+Z$/, '') : undefined;

        const rows = (sinceSqlite
            ? db.prepare(`
                SELECT * FROM tbl_vps_metrics
                WHERE monitor_id = ? AND timestamp >= ?
                ORDER BY id DESC LIMIT ?
            `).all(monitorId, sinceSqlite, limit)
            : db.prepare(`
                SELECT * FROM tbl_vps_metrics
                WHERE monitor_id = ?
                ORDER BY id DESC LIMIT ?
            `).all(monitorId, limit)) as any[];

        return rows.reverse().map(parseRow);
    }

    /** Monitor ids of type 'vps' whose newest metric row is older than `staleBeforeIso` (or has none at all). */
    findStaleMonitorIds(monitorIds: number[], staleBeforeIso: string): number[] {
        if (monitorIds.length === 0) return [];
        const staleBeforeSqlite = staleBeforeIso.replace('T', ' ').replace(/\.\d+Z$/, '');
        const placeholders = monitorIds.map(() => '?').join(',');

        const fresh = db.prepare(`
            SELECT DISTINCT monitor_id FROM tbl_vps_metrics
            WHERE monitor_id IN (${placeholders}) AND timestamp >= ?
        `).all(...monitorIds, staleBeforeSqlite) as { monitor_id: number }[];
        const freshIds = new Set(fresh.map(r => r.monitor_id));

        return monitorIds.filter(id => !freshIds.has(id));
    }

    deleteForMonitor(monitorId: number): void {
        db.prepare(`DELETE FROM tbl_vps_metrics WHERE monitor_id = ?`).run(monitorId);
    }
}

export const vpsMetricModel = new VpsMetricModel();
