import { db } from '../config/db.js';
import { toUtcIso } from './monitor.model.js';

export type MobileEventType = 'crash' | 'error' | 'custom' | 'session_start' | 'session_end';

export interface IFMobileEventInput {
    event_type: MobileEventType;
    event_name?: string;
    device_id: string;
    session_id?: string;
    app_version?: string;
    build_number?: string;
    os_name?: string;
    os_version?: string;
    device_model?: string;
    region?: string;
    locale?: string;
    timezone?: string;
    props?: Record<string, any>;
    stack_trace?: string;
    fatal?: boolean;
    client_timestamp?: string;
}

export interface IFMobileEventRow {
    id: number;
    monitor_id: number;
    event_type: MobileEventType;
    event_name: string | null;
    device_id: string;
    session_id: string | null;
    app_version: string | null;
    build_number: string | null;
    os_name: string | null;
    os_version: string | null;
    device_model: string | null;
    region: string | null;
    locale: string | null;
    timezone: string | null;
    props: Record<string, any> | null;
    stack_trace: string | null;
    fatal: boolean;
    client_timestamp: string | null;
    created_at: string;
}

export interface IFCrashIssue {
    id: number;
    monitor_id: number;
    signature: string;
    title: string | null;
    first_seen_at: string;
    last_seen_at: string;
    occurrence_count: number;
    is_fatal: boolean;
    sample_stack_trace: string | null;
}

function parseEventRow(r: any): IFMobileEventRow {
    let props: Record<string, any> | null = null;
    if (r.props) {
        try { props = JSON.parse(r.props); } catch { props = null; }
    }
    return {
        id: r.id,
        monitor_id: r.monitor_id,
        event_type: r.event_type,
        event_name: r.event_name,
        device_id: r.device_id,
        session_id: r.session_id,
        app_version: r.app_version,
        build_number: r.build_number,
        os_name: r.os_name,
        os_version: r.os_version,
        device_model: r.device_model,
        region: r.region,
        locale: r.locale,
        timezone: r.timezone,
        props,
        stack_trace: r.stack_trace,
        fatal: Boolean(r.fatal),
        client_timestamp: r.client_timestamp,
        created_at: toUtcIso(r.created_at)
    };
}

function parseCrashIssueRow(r: any): IFCrashIssue {
    return {
        id: r.id,
        monitor_id: r.monitor_id,
        signature: r.signature,
        title: r.title,
        first_seen_at: toUtcIso(r.first_seen_at),
        last_seen_at: toUtcIso(r.last_seen_at),
        occurrence_count: r.occurrence_count,
        is_fatal: Boolean(r.is_fatal),
        sample_stack_trace: r.sample_stack_trace
    };
}

// Normalizes an event's date filter (an ISO string from the client) into SQLite's
// CURRENT_TIMESTAMP format ("YYYY-MM-DD HH:MM:SS", no 'T'/'Z') — comparing an ISO
// string directly against the stored format is a lexicographic mismatch (see the
// same note in monitor.model.ts's getHeartbeatsInRange).
function toSqliteTimestamp(iso: string): string {
    return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// Derives a stable grouping key for a crash/fatal-error event from its event name and
// the first couple of stack frames — not a full hash, just enough to bucket "the same
// crash reported many times" without pulling in symbolication (out of scope for v1).
export function crashSignature(eventName: string | undefined, stackTrace: string | undefined): string {
    const topFrames = (stackTrace || '').split('\n').slice(0, 3).join('|');
    const basis = `${eventName || 'UnknownError'}::${topFrames}`;
    let hash = 0;
    for (let i = 0; i < basis.length; i++) {
        hash = (hash * 31 + basis.charCodeAt(i)) | 0;
    }
    return `${eventName || 'UnknownError'}-${Math.abs(hash).toString(36)}`;
}

class MobileEventModel {
    private insertStmt = db.prepare(`
        INSERT INTO tbl_mobile_events (
            monitor_id, event_type, event_name, device_id, session_id,
            app_version, build_number, os_name, os_version, device_model,
            region, locale, timezone,
            props, stack_trace, fatal, client_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    private upsertCrashIssueStmt = db.prepare(`
        INSERT INTO tbl_mobile_crash_issues (monitor_id, signature, title, is_fatal, sample_stack_trace, occurrence_count, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(monitor_id, signature) DO UPDATE SET
            occurrence_count = occurrence_count + 1,
            last_seen_at = CURRENT_TIMESTAMP,
            sample_stack_trace = COALESCE(tbl_mobile_crash_issues.sample_stack_trace, excluded.sample_stack_trace)
    `);

    insertBatch(monitorId: number, events: IFMobileEventInput[]): void {
        const run = db.transaction((rows: IFMobileEventInput[]) => {
            for (const e of rows) {
                this.insertStmt.run(
                    monitorId,
                    e.event_type,
                    e.event_name ?? null,
                    e.device_id,
                    e.session_id ?? null,
                    e.app_version ?? null,
                    e.build_number ?? null,
                    e.os_name ?? null,
                    e.os_version ?? null,
                    e.device_model ?? null,
                    e.region ?? null,
                    e.locale ?? null,
                    e.timezone ?? null,
                    e.props ? JSON.stringify(e.props) : null,
                    e.stack_trace ?? null,
                    e.fatal ? 1 : 0,
                    e.client_timestamp ?? null
                );

                if (e.event_type === 'crash' || (e.event_type === 'error' && e.fatal)) {
                    const signature = crashSignature(e.event_name, e.stack_trace);
                    const title = e.event_name || (e.stack_trace || '').split('\n')[0]?.slice(0, 200) || 'Unknown crash';
                    this.upsertCrashIssueStmt.run(monitorId, signature, title, e.fatal === false ? 0 : 1, e.stack_trace ?? null);
                }
            }
        });
        run(events);
    }

    listCrashIssues(monitorId: number, limit = 50): IFCrashIssue[] {
        const rows = db.prepare(`
            SELECT * FROM tbl_mobile_crash_issues
            WHERE monitor_id = ?
            ORDER BY last_seen_at DESC LIMIT ?
        `).all(monitorId, limit) as any[];
        return rows.map(parseCrashIssueRow);
    }

    getCrashFreeRate(monitorId: number, sinceIso: string): { sessions: number; crashed_sessions: number; rate: number } {
        const since = toSqliteTimestamp(sinceIso);
        const sessions = (db.prepare(`
            SELECT COUNT(DISTINCT session_id) as c FROM tbl_mobile_events
            WHERE monitor_id = ? AND event_type = 'session_start' AND session_id IS NOT NULL AND created_at >= ?
        `).get(monitorId, since) as { c: number }).c;

        const crashedSessions = (db.prepare(`
            SELECT COUNT(DISTINCT session_id) as c FROM tbl_mobile_events
            WHERE monitor_id = ? AND event_type = 'crash' AND session_id IS NOT NULL AND created_at >= ?
        `).get(monitorId, since) as { c: number }).c;

        const rate = sessions > 0 ? Math.max(0, (sessions - crashedSessions) / sessions) : 1;
        return { sessions, crashed_sessions: crashedSessions, rate };
    }

    private distinctDevices(monitorId: number, sinceIso: string): number {
        const since = toSqliteTimestamp(sinceIso);
        return (db.prepare(`
            SELECT COUNT(DISTINCT device_id) as c FROM tbl_mobile_events
            WHERE monitor_id = ? AND created_at >= ?
        `).get(monitorId, since) as { c: number }).c;
    }

    getDau(monitorId: number, sinceIso: string): number { return this.distinctDevices(monitorId, sinceIso); }
    getWau(monitorId: number, sinceIso: string): number { return this.distinctDevices(monitorId, sinceIso); }
    getMau(monitorId: number, sinceIso: string): number { return this.distinctDevices(monitorId, sinceIso); }

    // One point per calendar day: distinct devices seen that day, for the DAU trend chart.
    getDauSeries(monitorId: number, sinceIso: string): { date: string; count: number }[] {
        const since = toSqliteTimestamp(sinceIso);
        return db.prepare(`
            SELECT date(created_at) as date, COUNT(DISTINCT device_id) as count
            FROM tbl_mobile_events
            WHERE monitor_id = ? AND created_at >= ?
            GROUP BY date(created_at)
            ORDER BY date ASC
        `).all(monitorId, since) as { date: string; count: number }[];
    }

    getSessionCounts(monitorId: number, sinceIso: string): { date: string; count: number }[] {
        const since = toSqliteTimestamp(sinceIso);
        return db.prepare(`
            SELECT date(created_at) as date, COUNT(DISTINCT session_id) as count
            FROM tbl_mobile_events
            WHERE monitor_id = ? AND event_type = 'session_start' AND created_at >= ?
            GROUP BY date(created_at)
            ORDER BY date ASC
        `).all(monitorId, since) as { date: string; count: number }[];
    }

    getVersionBreakdown(monitorId: number, sinceIso: string): { app_version: string; count: number }[] {
        const since = toSqliteTimestamp(sinceIso);
        return db.prepare(`
            SELECT app_version, COUNT(DISTINCT device_id) as count
            FROM tbl_mobile_events
            WHERE monitor_id = ? AND created_at >= ? AND app_version IS NOT NULL
            GROUP BY app_version
            ORDER BY count DESC
        `).all(monitorId, since) as { app_version: string; count: number }[];
    }

    getOsBreakdown(monitorId: number, sinceIso: string): { os_name: string; os_version: string; count: number }[] {
        const since = toSqliteTimestamp(sinceIso);
        return db.prepare(`
            SELECT os_name, os_version, COUNT(DISTINCT device_id) as count
            FROM tbl_mobile_events
            WHERE monitor_id = ? AND created_at >= ? AND os_name IS NOT NULL
            GROUP BY os_name, os_version
            ORDER BY count DESC
        `).all(monitorId, since) as { os_name: string; os_version: string; count: number }[];
    }

    getRegionBreakdown(monitorId: number, sinceIso: string): { region: string; count: number }[] {
        const since = toSqliteTimestamp(sinceIso);
        return db.prepare(`
            SELECT region, COUNT(DISTINCT device_id) as count
            FROM tbl_mobile_events
            WHERE monitor_id = ? AND created_at >= ? AND region IS NOT NULL
            GROUP BY region
            ORDER BY count DESC
        `).all(monitorId, since) as { region: string; count: number }[];
    }

    listCustomEvents(monitorId: number, sinceIso: string, eventName?: string): { event_name: string; count: number }[] {
        const since = toSqliteTimestamp(sinceIso);
        if (eventName) {
            return db.prepare(`
                SELECT event_name, COUNT(*) as count FROM tbl_mobile_events
                WHERE monitor_id = ? AND event_type = 'custom' AND created_at >= ? AND event_name = ?
                GROUP BY event_name
            `).all(monitorId, since, eventName) as { event_name: string; count: number }[];
        }
        return db.prepare(`
            SELECT event_name, COUNT(*) as count FROM tbl_mobile_events
            WHERE monitor_id = ? AND event_type = 'custom' AND created_at >= ?
            GROUP BY event_name
            ORDER BY count DESC
        `).all(monitorId, since) as { event_name: string; count: number }[];
    }

    getEventFeed(monitorId: number, limit = 100, eventType?: string): IFMobileEventRow[] {
        const rows = (eventType
            ? db.prepare(`SELECT * FROM tbl_mobile_events WHERE monitor_id = ? AND event_type = ? ORDER BY id DESC LIMIT ?`).all(monitorId, eventType, limit)
            : db.prepare(`SELECT * FROM tbl_mobile_events WHERE monitor_id = ? ORDER BY id DESC LIMIT ?`).all(monitorId, limit)) as any[];
        return rows.map(parseEventRow);
    }

    // True server-side pagination (LIMIT/OFFSET), unlike getEventFeed above which the web
    // dashboard fetches once (up to 100 rows) and slices/filters client-side — that doesn't
    // scale to a mobile client paging through history a page at a time. Returns `total` (of
    // just this monitor's events, ignoring eventType) so a "N pages / has more" UI doesn't
    // need a second request to know when to stop.
    getEventFeedPage(monitorId: number, limit: number, offset: number, eventType?: string): { events: IFMobileEventRow[]; total: number; has_more: boolean } {
        const rows = (eventType
            ? db.prepare(`SELECT * FROM tbl_mobile_events WHERE monitor_id = ? AND event_type = ? ORDER BY id DESC LIMIT ? OFFSET ?`).all(monitorId, eventType, limit, offset)
            : db.prepare(`SELECT * FROM tbl_mobile_events WHERE monitor_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`).all(monitorId, limit, offset)) as any[];

        const total = (eventType
            ? db.prepare(`SELECT COUNT(*) as c FROM tbl_mobile_events WHERE monitor_id = ? AND event_type = ?`).get(monitorId, eventType)
            : db.prepare(`SELECT COUNT(*) as c FROM tbl_mobile_events WHERE monitor_id = ?`).get(monitorId)) as { c: number };

        return {
            events: rows.map(parseEventRow),
            total: total.c,
            has_more: offset + rows.length < total.c
        };
    }

    deleteForMonitor(monitorId: number): void {
        db.prepare(`DELETE FROM tbl_mobile_events WHERE monitor_id = ?`).run(monitorId);
        db.prepare(`DELETE FROM tbl_mobile_crash_issues WHERE monitor_id = ?`).run(monitorId);
    }
}

export const mobileEventModel = new MobileEventModel();
