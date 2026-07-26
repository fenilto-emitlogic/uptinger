import { Router } from 'express';
import { eagleEyeSettingsModel } from '../../models/eagle-eye-settings.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { PERMISSIONS } from '../../config/permissions.js';

const router = Router();
router.use(authenticateTokenMiddelware, attachOrgContext);

router.get('/', requirePermission(PERMISSIONS.ORG_VIEW), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    const settings = eagleEyeSettingsModel.findByOrg(orgId);
    return sendSuccess(res, 'Eagle Eye settings fetched', {
        settings: { autoscroll_interval_seconds: settings?.autoscroll_interval_seconds ?? 30 }
    });
});

router.put('/', requirePermission(PERMISSIONS.ORG_EDIT), (req: OrgScopedRequest, res) => {
    try {
        const orgId = req.currentOrg!.org_id;
        const autoscrollIntervalSeconds = parseInt(req.body.autoscroll_interval_seconds);
        if (!Number.isFinite(autoscrollIntervalSeconds) || autoscrollIntervalSeconds < 5) {
            return sendError(res, 'Auto-scroll interval must be at least 5 seconds.', null, 400);
        }

        eagleEyeSettingsModel.upsert(orgId, autoscrollIntervalSeconds, (req.user as any).userId);
        return sendSuccess(res, 'Eagle Eye settings saved');
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to save Eagle Eye settings', err, 500);
    }
});

export default router;
