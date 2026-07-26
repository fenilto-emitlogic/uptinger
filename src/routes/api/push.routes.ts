import { Router } from 'express';
import { db } from '../../config/db.js';
import { monitorModel } from '../../models/monitor.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';

const router = Router();

// GET/POST /api/push/:id/:token - Public heartbeat endpoint for "push" type monitors.
// No auth middleware here: the token itself (generated at monitor creation, stored in
// config.push_token) is the credential, matching how push monitors work in Uptime Kuma etc.
function handlePush(req: any, res: any) {
    const id = parseInt(String(req.params.id));
    const token = String(req.params.token || '');
    const monitor = monitorModel.findById(id);

    if (!monitor || monitor.type !== 'push') {
        return sendError(res, 'Monitor not found', null, 404);
    }
    if (!monitor.parsed_config?.push_token || monitor.parsed_config.push_token !== token) {
        return sendError(res, 'Invalid push token', null, 401);
    }

    const statusParam = String(req.query.status || req.body?.status || 'up').toLowerCase();
    const status = statusParam === 'down' ? 'OFFLINE' : 'ONLINE';
    const msg = String(req.query.msg || req.body?.msg || 'Heartbeat received');
    const pingMs = Number(req.query.ping || req.body?.ping || 0) || 0;
    const priorStatus = monitor.status;

    db.prepare(`INSERT INTO tbl_monitor_checks (monitor_id, status, ping_ms, status_code, msg) VALUES (?, ?, ?, 200, ?)`)
        .run(id, status, pingMs, msg);
    db.prepare(`UPDATE tbl_monitors SET status = ?, updated_at = ? WHERE id = ?`)
        .run(status, new Date().toISOString(), id);

    if (priorStatus !== status) {
        // Reuse the same notification behavior as active checks would have. Kept intentionally
        // minimal here (no email) to avoid duplicating pinger's recipient-scoping logic; the
        // dashboard status/log stream is the primary signal for push monitors.
    }

    return sendSuccess(res, 'Heartbeat recorded', { status });
}

router.get('/:id/:token', handlePush);
router.post('/:id/:token', handlePush);

export default router;
