import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../../config/db.js';
import { monitorModel } from '../../models/monitor.model.js';
import { vpsMetricModel, IFVpsMetricInput } from '../../models/vps-metric.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { agentIngestRateLimiter } from '../../middlewares/rate-limit.middleware.js';

const router = Router();

// Fixed, non-user-supplied list — the endpoint below serves exactly these two files
// (never an arbitrary req.params.file path) so there's no path-traversal surface.
const AGENT_SOURCE_DIR = path.resolve('agent/linux');
const AGENT_SOURCE_FILES: Record<string, string> = {
    'collect.sh': 'collect.sh',
    'Dockerfile': 'Dockerfile'
};

// GET /api/agent/source/:file - Serves the agent's own source (see /agent in the repo) so
// the install command can download-then-build locally instead of pulling a prebuilt image
// from a registry. No auth: this is the same source that ships in the (public) repo, it
// carries no credentials, and the agent needs to fetch it before it has a token to prove.
router.get('/source/:file', (req, res) => {
    const filename = AGENT_SOURCE_FILES[req.params.file];
    if (!filename) {
        return sendError(res, 'Unknown agent source file', null, 404);
    }
    const filePath = path.join(AGENT_SOURCE_DIR, filename);
    fs.readFile(filePath, 'utf8', (err, content) => {
        if (err) return sendError(res, 'Agent source file not found', null, 404);
        res.type('text/plain').send(content);
    });
});

// Caps so a compromised/misbehaving agent can't grow the DB unbounded via a single
// oversized push — well above anything a real host would ever report.
const MAX_DISK_ENTRIES = 64;
const MAX_ERROR_LINES = 20;
const MAX_ERROR_LINE_LENGTH = 500;

// Constant-time compare so token validation doesn't leak timing info about how many
// leading bytes matched — same reasoning as any credential check.
function tokensMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function num(value: unknown): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number | undefined, min: number, max: number): number | undefined {
    if (n === undefined) return undefined;
    return Math.min(max, Math.max(min, n));
}

// Trusts nothing from the request body beyond what it explicitly reads and bounds —
// the agent is unauthenticated network input from the user's own VPS, but validating
// shape here still protects the DB/dashboard from a malformed or malicious payload.
function parseMetricsPayload(body: any): IFVpsMetricInput {
    const disks = Array.isArray(body?.disks)
        ? body.disks.slice(0, MAX_DISK_ENTRIES).map((d: any) => ({
            mount: String(d?.mount ?? '').slice(0, 128),
            used_mb: clamp(num(d?.used_mb), 0, Number.MAX_SAFE_INTEGER) ?? 0,
            total_mb: clamp(num(d?.total_mb), 0, Number.MAX_SAFE_INTEGER) ?? 0
        }))
        : [];

    const nginxErrors = Array.isArray(body?.nginx_recent_errors)
        ? body.nginx_recent_errors.slice(0, MAX_ERROR_LINES).map((line: any) => String(line ?? '').slice(0, MAX_ERROR_LINE_LENGTH))
        : [];

    return {
        cpu_pct: clamp(num(body?.cpu_pct), 0, 100),
        load1: num(body?.load1),
        load5: num(body?.load5),
        load15: num(body?.load15),
        ram_used_mb: clamp(num(body?.ram_used_mb), 0, Number.MAX_SAFE_INTEGER),
        ram_total_mb: clamp(num(body?.ram_total_mb), 0, Number.MAX_SAFE_INTEGER),
        swap_used_mb: clamp(num(body?.swap_used_mb), 0, Number.MAX_SAFE_INTEGER),
        swap_total_mb: clamp(num(body?.swap_total_mb), 0, Number.MAX_SAFE_INTEGER),
        disks,
        net_rx_bytes: clamp(num(body?.net_rx_bytes), 0, Number.MAX_SAFE_INTEGER),
        net_tx_bytes: clamp(num(body?.net_tx_bytes), 0, Number.MAX_SAFE_INTEGER),
        uptime_seconds: clamp(num(body?.uptime_seconds), 0, Number.MAX_SAFE_INTEGER),
        nginx_active_connections: clamp(num(body?.nginx_active_connections), 0, Number.MAX_SAFE_INTEGER),
        nginx_requests_total: clamp(num(body?.nginx_requests_total), 0, Number.MAX_SAFE_INTEGER),
        nginx_recent_errors: nginxErrors,
        agent_version: body?.agent_version ? String(body.agent_version).slice(0, 32) : undefined
    };
}

// POST /api/agent/:id/ingest - Public ingest endpoint for the Docker agent (see /agent).
// No session/JWT here: the bearer token generated at monitor creation (config.agent_token)
// IS the credential, same pattern as the existing push monitor type in push.routes.ts.
router.post('/:id/ingest', agentIngestRateLimiter, (req, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const monitor = monitorModel.findById(id);
        if (!monitor || monitor.type !== 'vps') {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
        const expectedToken = monitor.parsed_config?.agent_token;
        if (!expectedToken || !bearer || !tokensMatch(bearer, expectedToken)) {
            return sendError(res, 'Invalid or missing agent token', null, 401);
        }

        const metrics = parseMetricsPayload(req.body);
        vpsMetricModel.create(id, metrics);

        const priorStatus = monitor.status;
        db.prepare(`UPDATE tbl_monitors SET status = 'ONLINE', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
        // Log every ingest, not just the transition into ONLINE — matches how push
        // monitors populate tbl_monitor_checks (push.routes.ts), which is what the
        // Heartbeat Event Log reads from. Without this, the log only ever gets one
        // entry (the first time the agent comes online) even though it keeps reporting.
        const msg = priorStatus !== 'ONLINE' ? 'Agent reporting resumed' : 'Agent heartbeat';
        db.prepare(`INSERT INTO tbl_monitor_checks (monitor_id, status, ping_ms, status_code, msg) VALUES (?, 'ONLINE', 0, 200, ?)`)
            .run(id, msg);

        return sendSuccess(res, 'Metrics recorded');
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to record metrics', null, 500);
    }
});

export default router;
