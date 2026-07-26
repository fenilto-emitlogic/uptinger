import { db } from '../config/db.js';

export interface IFHeartbeat {
    id: number;
    monitor_id: number;
    status: string;
    ping_ms: number;
    status_code: number;
    msg: string;
    timestamp?: string;
}

class HeartbeatModel {
    findByMonitorId(monitorId: number, limit = 50): IFHeartbeat[] {
        return db.prepare(`
            SELECT * FROM tbl_monitor_checks 
            WHERE monitor_id = ? 
            ORDER BY id DESC LIMIT ?
        `).all(monitorId, limit) as IFHeartbeat[];
    }

    create(monitorId: number, status: string, pingMs: number, statusCode = 200, msg = ''): IFHeartbeat {
        const stmt = db.prepare(`
            INSERT INTO tbl_monitor_checks (monitor_id, status, ping_ms, status_code, msg)
            VALUES (?, ?, ?, ?, ?)
        `);
        const res = stmt.run(monitorId, status, pingMs, statusCode, msg);
        return {
            id: Number(res.lastInsertRowid),
            monitor_id: monitorId,
            status,
            ping_ms: pingMs,
            status_code: statusCode,
            msg,
            timestamp: new Date().toISOString()
        };
    }
}

export const heartbeatModel = new HeartbeatModel();
