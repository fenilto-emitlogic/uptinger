import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../../config/db.js';
import { monitorModel } from '../../models/monitor.model.js';
import { mobileEventModel, IFMobileEventInput, MobileEventType } from '../../models/mobile-event.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { mobileIngestRateLimiter } from '../../middlewares/rate-limit.middleware.js';

const router = Router();

// Caps so a misbehaving/malicious client can't grow the DB unbounded via a single
// oversized batch — same reasoning as agent.routes.ts's MAX_DISK_ENTRIES etc.
const MAX_EVENTS_PER_BATCH = 50;
const MAX_STRING_FIELD_LENGTH = 256;
const MAX_STACK_TRACE_LENGTH = 8000;
const MAX_PROPS_JSON_LENGTH = 2000;

const VALID_EVENT_TYPES: MobileEventType[] = ['crash', 'error', 'custom', 'session_start', 'session_end'];

// Constant-time compare so token validation doesn't leak timing info — same helper
// as agent.routes.ts's tokensMatch.
function tokensMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function str(value: unknown, maxLen = MAX_STRING_FIELD_LENGTH): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value).slice(0, maxLen);
}

function parseProps(value: unknown): Record<string, any> | undefined {
    if (value === undefined || value === null || typeof value !== 'object') return undefined;
    try {
        const json = JSON.stringify(value).slice(0, MAX_PROPS_JSON_LENGTH);
        return JSON.parse(json);
    } catch {
        return undefined;
    }
}

// Trusts nothing from the request body beyond what it explicitly reads and bounds — the
// mobile client is unauthenticated-by-session network input, but validating shape here
// still protects the DB/dashboard from a malformed or malicious payload (mirrors
// agent.routes.ts's parseMetricsPayload).
function parseMobileBatch(body: any, deviceId: string, sessionId: string | undefined, sharedFields: {
    app_version?: string; build_number?: string; os_name?: string; os_version?: string; device_model?: string;
    region?: string; locale?: string; timezone?: string;
}): IFMobileEventInput[] {
    if (!Array.isArray(body?.events)) return [];

    return body.events.slice(0, MAX_EVENTS_PER_BATCH).map((e: any): IFMobileEventInput | null => {
        const type = VALID_EVENT_TYPES.includes(e?.type) ? (e.type as MobileEventType) : undefined;
        if (!type) return null;

        return {
            event_type: type,
            event_name: str(e?.name),
            device_id: deviceId,
            session_id: sessionId,
            app_version: sharedFields.app_version,
            build_number: sharedFields.build_number,
            os_name: sharedFields.os_name,
            os_version: sharedFields.os_version,
            device_model: sharedFields.device_model,
            region: sharedFields.region,
            locale: sharedFields.locale,
            timezone: sharedFields.timezone,
            props: parseProps(e?.props),
            stack_trace: str(e?.stack_trace, MAX_STACK_TRACE_LENGTH),
            fatal: typeof e?.fatal === 'boolean' ? e.fatal : (type === 'crash'),
            client_timestamp: str(e?.client_timestamp, 64)
        };
    }).filter((e: IFMobileEventInput | null): e is IFMobileEventInput => e !== null);
}

// POST /api/mobile/:id/ingest - Public ingest endpoint for a mobile app's Uptinger SDK.
// No session/JWT here: the bearer token generated at monitor creation (config.mobile_token)
// IS the credential, same pattern as the 'vps' agent in agent.routes.ts.
router.post('/:id/ingest', mobileIngestRateLimiter, (req, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const monitor = monitorModel.findById(id);
        if (!monitor || monitor.type !== 'mobile') {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
        const expectedToken = monitor.parsed_config?.mobile_token;
        if (!expectedToken || !bearer || !tokensMatch(bearer, expectedToken)) {
            return sendError(res, 'Invalid or missing mobile token', null, 401);
        }

        const deviceId = str(req.body?.device_id);
        if (!deviceId) {
            return sendError(res, 'device_id is required', null, 400);
        }

        const events = parseMobileBatch(req.body, deviceId, str(req.body?.session_id), {
            app_version: str(req.body?.app_version),
            build_number: str(req.body?.build_number),
            os_name: str(req.body?.os_name),
            os_version: str(req.body?.os_version),
            device_model: str(req.body?.device_model),
            region: str(req.body?.region),
            locale: str(req.body?.locale),
            timezone: str(req.body?.timezone)
        });

        if (events.length === 0) {
            return sendError(res, 'No valid events in batch', null, 400);
        }

        mobileEventModel.insertBatch(id, events);

        const priorStatus = monitor.status;
        db.prepare(`UPDATE tbl_monitors SET status = 'ONLINE', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
        // Log every ingest, not just the transition into ONLINE — same reasoning as
        // agent.routes.ts, so the Heartbeat Event Log reflects ongoing activity.
        const msg = priorStatus !== 'ONLINE' ? 'Mobile reporting resumed' : `Mobile events ingested (${events.length})`;
        db.prepare(`INSERT INTO tbl_monitor_checks (monitor_id, status, ping_ms, status_code, msg) VALUES (?, 'ONLINE', 0, 200, ?)`)
            .run(id, msg);

        return sendSuccess(res, 'Events recorded', { accepted: events.length });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to record events', null, 500);
    }
});

export default router;
