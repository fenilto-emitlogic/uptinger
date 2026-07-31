import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../../config/db.js';
import { monitorModel, toDashboardSite } from '../../models/monitor.model.js';
import { userGroupModel } from '../../models/user_group.model.js';
import { groupModel } from '../../models/group.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware, AuthenticatedRequest } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { uptinger } from '../../config/uptinger.js';
import { PERMISSIONS } from '../../config/permissions.js';
import { userOrgModel } from '../../models/user_org.model.js';
import { monitorNotifyRecipientModel } from '../../models/monitor_notify_recipient.model.js';
import { sendTemplatedMail } from '../../utils/notify.utils.js';
import { organizationModel } from '../../models/organization.model.js';
import { getAppUrl } from '../../config/email-templates.js';

const router = Router();
router.use(authenticateTokenMiddelware, attachOrgContext);

// Members without monitor.view_all only see monitors in Groups they're assigned to.
// An explicit ?group_id= query narrows further to a single group (used by the header's
// Group filter) — but never grants access beyond what the user is already scoped to.
function scopedGroupIds(req: OrgScopedRequest): number[] | undefined {
    const hasAll = req.currentOrg?.permissions.includes(PERMISSIONS.MONITOR_VIEW_ALL);
    const userId = (req.user as any)?.userId;
    const myGroupIds = hasAll ? undefined : (userId ? userGroupModel.listGroupIdsForUser(userId) : []);

    const requestedGroupId = req.query.group_id ? Number(req.query.group_id) : undefined;
    if (requestedGroupId) {
        if (hasAll || (myGroupIds && myGroupIds.includes(requestedGroupId))) return [requestedGroupId];
        return [];
    }

    return myGroupIds;
}

// GET /api/monitors - List monitors for the active organization
router.get('/', requirePermission(PERMISSIONS.MONITOR_VIEW), (req: OrgScopedRequest, res) => {
    try {
        const monitors = monitorModel.findAll(req.currentOrg?.org_id, scopedGroupIds(req));
        return sendSuccess(res, 'Monitors fetched successfully', { monitors });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to fetch monitors', null, 500);
    }
});

// GET /api/monitors/dashboard/live - Dashboard-shaped snapshot for client-side polling.
// Must be declared before the /:id route so "dashboard" isn't parsed as an id.
router.get('/dashboard/live', requirePermission(PERMISSIONS.MONITOR_VIEW), (req: OrgScopedRequest, res) => {
    try {
        const sites = monitorModel.findAll(req.currentOrg?.org_id, scopedGroupIds(req)).map(toDashboardSite);
        return sendSuccess(res, 'Live dashboard data fetched successfully', { sites });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to fetch live dashboard data', null, 500);
    }
});

// GET /api/monitors/backup/export - Full backup of every monitor in the active org,
// portable enough to recreate them all via /backup/import (same or another instance).
// Must be declared before /:id so "backup" isn't parsed as an id.
router.get('/backup/export', requirePermission(PERMISSIONS.MONITOR_VIEW_ALL), (req: OrgScopedRequest, res) => {
    try {
        if (!req.currentOrg) {
            return sendError(res, 'You must belong to an organization to export monitors.', null, 400);
        }
        const monitors = monitorModel.findAll(req.currentOrg.org_id);
        const groups = groupModel.findAllForOrg(req.currentOrg.org_id);
        const groupNameById = new Map(groups.map(g => [g.id, g.name]));

        const backup = {
            exported_at: new Date().toISOString(),
            org_id: req.currentOrg.org_id,
            org_name: req.currentOrg.org_name,
            monitors: monitors.map(m => ({
                name: m.name,
                type: m.type,
                url: m.url,
                hostname: m.hostname,
                port: m.port,
                interval_seconds: m.interval_seconds,
                retry_interval: m.retry_interval,
                max_retries: m.max_retries,
                tags: m.parsed_tags,
                group_name: m.group_id != null ? groupNameById.get(m.group_id) ?? null : null,
                notify_on_down: Boolean(m.notify_on_down),
                notify_on_paused: Boolean(m.notify_on_paused),
                notify_on_recovery: Boolean(m.notify_on_recovery),
                config: m.parsed_config
            }))
        };

        return sendSuccess(res, 'Monitors exported successfully', backup);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to export monitors', null, 500);
    }
});

// POST /api/monitors/backup/import - Recreate monitors from a previously exported backup.
// Each monitor in the payload is created fresh (never overwrites an existing monitor by
// name/id) — importing the same backup twice produces duplicates, by design, since the
// backup has no stable id to reconcile against once a monitor's original row is gone.
router.post('/backup/import', requirePermission(PERMISSIONS.MONITOR_CREATE), (req: OrgScopedRequest, res) => {
    try {
        if (!req.currentOrg) {
            return sendError(res, 'You must belong to an organization to import monitors.', null, 400);
        }

        const monitors = Array.isArray(req.body?.monitors) ? req.body.monitors : null;
        if (!monitors) {
            return sendError(res, 'Backup file is missing a "monitors" array', null, 400);
        }

        const groups = groupModel.findAllForOrg(req.currentOrg.org_id);
        const groupIdByName = new Map(groups.map(g => [g.name, g.id]));
        const createdBy = req.user && 'userId' in req.user ? req.user.userId : undefined;

        let imported = 0;
        const errors: string[] = [];

        for (const item of monitors) {
            try {
                if (!item || !item.name) {
                    errors.push('Skipped an entry with no name');
                    continue;
                }
                monitorModel.create({
                    name: item.name,
                    type: item.type || 'http',
                    url: item.url || '',
                    hostname: item.hostname || '',
                    port: item.port || undefined,
                    interval_seconds: item.interval_seconds || 60,
                    retry_interval: item.retry_interval || 60,
                    max_retries: item.max_retries != null ? item.max_retries : 3,
                    tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''),
                    config: item.config || {},
                    org_id: req.currentOrg.org_id,
                    group_id: item.group_name ? groupIdByName.get(item.group_name) ?? null : null,
                    created_by: createdBy,
                    notify_on_down: item.notify_on_down !== false,
                    notify_on_paused: Boolean(item.notify_on_paused),
                    notify_on_recovery: item.notify_on_recovery !== false
                });
                imported++;
            } catch (itemErr: any) {
                errors.push(`"${item?.name || 'unknown'}": ${itemErr.message || 'failed to import'}`);
            }
        }

        uptinger.resyncNow();

        return sendSuccess(res, `Imported ${imported} of ${monitors.length} monitor(s)`, { imported, total: monitors.length, errors });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to import monitors', null, 500);
    }
});

// GET /api/monitors/:id - Single monitor (scoped to the active org and, for
// non-admins, to their assigned Groups)
router.get('/:id', requirePermission(PERMISSIONS.MONITOR_VIEW), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const monitor = monitorModel.findById(id);
        if (!monitor || monitor.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }
        const groupIds = scopedGroupIds(req);
        if (groupIds && (monitor.group_id == null || !groupIds.includes(monitor.group_id))) {
            return sendError(res, 'Monitor not found', null, 404);
        }
        return sendSuccess(res, 'Monitor details', { monitor });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to fetch monitor', null, 500);
    }
});

// GET /api/monitors/:id/heartbeats?range=1h|6h|24h|7d - Response-time chart data scoped to
// an actual time window, instead of the fixed last-50-rows cap used for the monitor's preview.
const HEARTBEAT_RANGE_MS: Record<string, number> = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000
};

router.get('/:id/heartbeats', requirePermission(PERMISSIONS.MONITOR_VIEW), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const monitor = monitorModel.findById(id);
        if (!monitor || monitor.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }
        const groupIds = scopedGroupIds(req);
        if (groupIds && (monitor.group_id == null || !groupIds.includes(monitor.group_id))) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const range = String(req.query.range || '');
        const rangeMs = HEARTBEAT_RANGE_MS[range];
        const sinceIso = rangeMs ? new Date(Date.now() - rangeMs).toISOString() : undefined;

        const heartbeats = monitorModel.getHeartbeatsInRange(id, sinceIso);
        return sendSuccess(res, 'Heartbeats', { heartbeats });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to fetch heartbeats', null, 500);
    }
});

// POST /api/monitors - Create monitor with dynamic type validation
router.post('/', requirePermission(PERMISSIONS.MONITOR_CREATE), (req: OrgScopedRequest, res) => {
    try {
        if (!req.currentOrg) {
            return sendError(res, 'You must belong to an organization to create monitors.', null, 400);
        }

        const {
            name,
            type,
            url,
            hostname,
            port,
            interval_seconds,
            retries,
            retry_interval,
            tags,
            // Type-specific config fields
            dns_resolve_server,
            dns_rr_type,
            keyword,
            json_query,
            expected_value,
            http_method,
            body_encoding,
            request_body,
            request_headers,
            accepted_status_codes,
            db_name,
            db_user,
            db_password,
            db_connection_string,
            container_name,
            mqtt_topic,
            rabbitmq_queue,
            expiry_notification,
            ignore_tls,
            group_id,
            notify_on_down,
            notify_on_paused,
            notify_on_recovery
        } = req.body;

        if (!name) {
            return sendError(res, 'Friendly Name is required', null, 400);
        }

        const monitorType = (type || 'http').toLowerCase();

        // Validation per monitor type
        if (monitorType.includes('dns')) {
            if (!hostname) return sendError(res, 'Domain/Hostname is required for DNS monitoring', null, 400);
        } else if (monitorType.includes('http')) {
            if (!url) return sendError(res, 'Target URL is required for HTTP monitoring', null, 400);
        } else if (['tcp', 'ping', 'smtp', 'postgres', 'mysql', 'mongodb', 'redis', 'mssql'].includes(monitorType)) {
            if (!hostname) return sendError(res, 'Hostname or IP is required for this monitor type', null, 400);
        }

        // Build type-specific configuration payload
        const configPayload: Record<string, any> = {
            http_method: http_method || 'GET',
            body_encoding: body_encoding || 'json',
            request_body: request_body || '',
            request_headers: request_headers || '',
            accepted_status_codes: accepted_status_codes || '200-299',
            expiry_notification: expiry_notification ?? true,
            ignore_tls: ignore_tls ?? false
        };

        if (dns_resolve_server) configPayload.dns_resolve_server = dns_resolve_server;
        if (dns_rr_type) configPayload.dns_rr_type = dns_rr_type;
        if (keyword) configPayload.keyword = keyword;
        if (json_query) configPayload.json_query = json_query;
        if (expected_value) configPayload.expected_value = expected_value;
        if (db_name) configPayload.db_name = db_name;
        if (db_user) configPayload.db_user = db_user;
        if (db_password) configPayload.db_password = db_password;
        if (db_connection_string) configPayload.db_connection_string = db_connection_string;
        if (container_name) configPayload.container_name = container_name;
        if (mqtt_topic) configPayload.mqtt_topic = mqtt_topic;
        if (rabbitmq_queue) configPayload.rabbitmq_queue = rabbitmq_queue;

        // Passive types are never actively probed, so they need a way to be updated from
        // outside the engine: push monitors get a secret token to authenticate a heartbeat URL.
        if (monitorType === 'push') {
            configPayload.push_token = crypto.randomBytes(20).toString('hex');
        }

        const newMonitor = monitorModel.create({
            name,
            type: monitorType,
            url: url || '',
            hostname: hostname || '',
            port: port ? parseInt(port) : undefined,
            interval_seconds: interval_seconds ? parseInt(interval_seconds) : 60,
            retry_interval: retry_interval ? parseInt(retry_interval) : 60,
            max_retries: retries !== undefined && retries !== '' ? parseInt(retries) : 3,
            tags: Array.isArray(tags) ? tags.join(', ') : (tags || ''),
            config: configPayload,
            org_id: req.currentOrg.org_id,
            group_id: group_id ? parseInt(group_id) : null,
            created_by: req.user && 'userId' in req.user ? req.user.userId : undefined,
            notify_on_down: notify_on_down === undefined ? true : Boolean(notify_on_down),
            notify_on_paused: Boolean(notify_on_paused),
            notify_on_recovery: notify_on_recovery === undefined ? true : Boolean(notify_on_recovery)
        });

        // Kick off the real first check now instead of waiting for the next resync tick (up to 30s away).
        uptinger.resyncNow();

        return sendSuccess(res, 'Monitor created successfully', { monitor: newMonitor }, 201);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to create monitor', null, 500);
    }
});

// PUT /api/monitors/:id - Update monitor
router.put('/:id', requirePermission(PERMISSIONS.MONITOR_EDIT), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const {
            dns_resolve_server,
            dns_rr_type,
            keyword,
            json_query,
            expected_value,
            http_method,
            body_encoding,
            request_body,
            request_headers,
            accepted_status_codes,
            db_name,
            db_user,
            db_password,
            db_connection_string,
            container_name,
            mqtt_topic,
            rabbitmq_queue,
            expiry_notification,
            ignore_tls
        } = req.body;

        const configPayload: Record<string, any> = {};
        if (http_method !== undefined) configPayload.http_method = http_method;
        if (body_encoding !== undefined) configPayload.body_encoding = body_encoding;
        if (request_body !== undefined) configPayload.request_body = request_body;
        if (request_headers !== undefined) configPayload.request_headers = request_headers;
        if (accepted_status_codes !== undefined) configPayload.accepted_status_codes = accepted_status_codes;
        if (expiry_notification !== undefined) configPayload.expiry_notification = expiry_notification;
        if (ignore_tls !== undefined) configPayload.ignore_tls = ignore_tls;
        if (dns_resolve_server !== undefined) configPayload.dns_resolve_server = dns_resolve_server;
        if (dns_rr_type !== undefined) configPayload.dns_rr_type = dns_rr_type;
        if (keyword !== undefined) configPayload.keyword = keyword;
        if (json_query !== undefined) configPayload.json_query = json_query;
        if (expected_value !== undefined) configPayload.expected_value = expected_value;
        if (db_name !== undefined) configPayload.db_name = db_name;
        if (db_user !== undefined) configPayload.db_user = db_user;
        if (db_password !== undefined) configPayload.db_password = db_password;
        if (db_connection_string !== undefined) configPayload.db_connection_string = db_connection_string;
        if (container_name !== undefined) configPayload.container_name = container_name;
        if (mqtt_topic !== undefined) configPayload.mqtt_topic = mqtt_topic;
        if (rabbitmq_queue !== undefined) configPayload.rabbitmq_queue = rabbitmq_queue;

        const updated = monitorModel.update(id, {
            name: req.body.name,
            type: req.body.type,
            url: req.body.url,
            hostname: req.body.hostname,
            port: req.body.port ? parseInt(req.body.port) : undefined,
            interval_seconds: req.body.interval_seconds ? parseInt(req.body.interval_seconds) : undefined,
            retry_interval: req.body.retry_interval ? parseInt(req.body.retry_interval) : undefined,
            max_retries: req.body.retries !== undefined && req.body.retries !== '' ? parseInt(req.body.retries) : undefined,
            tags: Array.isArray(req.body.tags) ? req.body.tags.join(', ') : req.body.tags,
            group_id: req.body.group_id !== undefined ? (req.body.group_id ? parseInt(req.body.group_id) : null) : undefined,
            notify_on_down: req.body.notify_on_down,
            notify_on_paused: req.body.notify_on_paused,
            notify_on_recovery: req.body.notify_on_recovery,
            configObj: configPayload
        });

        if (!updated) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        return sendSuccess(res, 'Monitor updated successfully', { monitor: updated });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to update monitor', null, 500);
    }
});

// PATCH /api/monitors/:id/notifications - Update alert-trigger toggles only
router.patch('/:id/notifications', requirePermission(PERMISSIONS.MONITOR_EDIT), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const updated = monitorModel.update(id, {
            notify_on_down: req.body.notify_on_down,
            notify_on_paused: req.body.notify_on_paused,
            notify_on_recovery: req.body.notify_on_recovery,
            configObj: {}
        });
        return sendSuccess(res, 'Notification settings updated', { monitor: updated });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to update notification settings', null, 500);
    }
});

// GET /api/monitors/:id/notify-recipients - User IDs selected to receive alerts (empty = all org members)
router.get('/:id/notify-recipients', requirePermission(PERMISSIONS.MONITOR_VIEW), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const userIds = monitorNotifyRecipientModel.listUserIds(id);
        return sendSuccess(res, 'Notification recipients fetched successfully', { userIds });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to fetch notification recipients', null, 500);
    }
});

// PUT /api/monitors/:id/notify-recipients - Choose which org members receive alerts for this monitor
router.put('/:id/notify-recipients', requirePermission(PERMISSIONS.MONITOR_EDIT), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const userIds = Array.isArray(req.body.userIds) ? req.body.userIds.map((v: any) => parseInt(v)).filter((v: number) => !Number.isNaN(v)) : [];
        monitorNotifyRecipientModel.setRecipients(id, userIds);
        return sendSuccess(res, 'Notification recipients updated successfully', { userIds });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to update notification recipients', null, 500);
    }
});

// POST /api/monitors/:id/pause - Toggle pause
router.post('/:id/pause', requirePermission(PERMISSIONS.MONITOR_EDIT), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const updated = monitorModel.togglePause(id);
        if (!updated) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        if (updated.is_paused && updated.notify_on_paused) {
            const to = userOrgModel.listMembers(updated.org_id).map(m => m.email).filter(Boolean);
            if (to.length > 0) {
                const org = organizationModel.findById(updated.org_id);
                sendTemplatedMail(updated.org_id, 'paused', to, {
                    monitor_name: updated.name,
                    org_name: org?.name || '',
                    actor_email: (req.user as any).email,
                    action_url: `${getAppUrl()}/dashboard`,
                }).catch(err => console.error(`Failed to send pause notification for monitor ${updated.id}:`, err.message));
            }
        }

        return sendSuccess(res, `Monitor ${updated.is_paused ? 'paused' : 'resumed'}`, { monitor: updated });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to pause monitor', null, 500);
    }
});

// POST /api/monitors/:id/reset - Wipe all check history/analytics for a monitor, keeping its settings intact
router.post('/:id/reset', requirePermission(PERMISSIONS.MONITOR_EDIT), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const updated = monitorModel.resetData(id);
        if (!updated) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        return sendSuccess(res, 'Monitor data reset', { monitor: updated });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to reset monitor data', null, 500);
    }
});

// POST /api/monitors/:id/status - Manually set status (for "manual" type monitors, which are never actively probed)
router.post('/:id/status', requirePermission(PERMISSIONS.MONITOR_EDIT), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }
        if (existing.type !== 'manual') {
            return sendError(res, 'Only "manual" type monitors can have their status set directly', null, 400);
        }

        const status = String(req.body.status || '').toUpperCase();
        if (status !== 'ONLINE' && status !== 'OFFLINE') {
            return sendError(res, 'status must be ONLINE or OFFLINE', null, 400);
        }

        const msg = req.body.msg || `Manually set to ${status}`;
        db.prepare(`INSERT INTO tbl_monitor_checks (monitor_id, status, ping_ms, status_code, msg) VALUES (?, ?, 0, 200, ?)`).run(id, status, msg);
        db.prepare(`UPDATE tbl_monitors SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);

        const updated = monitorModel.findById(id);
        return sendSuccess(res, 'Monitor status updated', { monitor: updated });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to update monitor status', null, 500);
    }
});

// DELETE /api/monitors/:id - Delete monitor
router.delete('/:id', requirePermission(PERMISSIONS.MONITOR_DELETE), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const existing = monitorModel.findById(id);
        if (!existing || existing.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Monitor not found', null, 404);
        }

        const deleted = monitorModel.delete(id);
        if (!deleted) {
            return sendError(res, 'Monitor not found', null, 404);
        }
        return sendSuccess(res, 'Monitor deleted successfully');
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to delete monitor', null, 500);
    }
});

export default router;
