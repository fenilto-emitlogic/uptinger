import { Router } from 'express';
import { smtpModel } from '../../models/smtp.model.js';
import { sendTemplatedMail } from '../../utils/notify.utils.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { PERMISSIONS } from '../../config/permissions.js';

const router = Router();
router.use(authenticateTokenMiddelware, attachOrgContext);

router.get('/', requirePermission(PERMISSIONS.SMTP_MANAGE), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    const settings = smtpModel.findByOrg(orgId);
    if (!settings) return sendSuccess(res, 'SMTP settings fetched', { settings: null });

    // Never return the stored password to the client.
    const { password, ...safe } = settings;
    return sendSuccess(res, 'SMTP settings fetched', { settings: { ...safe, has_password: !!password } });
});

router.put('/', requirePermission(PERMISSIONS.SMTP_MANAGE), (req: OrgScopedRequest, res) => {
    try {
        const orgId = req.currentOrg!.org_id;
        const { host, port, username, password, encryption, from_email, from_name, is_active } = req.body;
        if (!host || !port || !from_email) return sendError(res, 'Host, port and From address are required.', null, 400);

        smtpModel.upsert(orgId, {
            host, port: parseInt(port), username, password,
            encryption: encryption || 'starttls', from_email, from_name,
            is_active: is_active !== false,
        }, (req.user as any).userId);

        return sendSuccess(res, 'SMTP settings saved');
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to save SMTP settings', err, 500);
    }
});

router.post('/test', requirePermission(PERMISSIONS.SMTP_MANAGE), async (req: OrgScopedRequest, res) => {
    try {
        const orgId = req.currentOrg!.org_id;
        const to = (req.user as any).email;
        await sendTemplatedMail(orgId, 'test', to, {
            org_name: req.currentOrg?.org_name || '',
            recipient_email: to,
        });
        return sendSuccess(res, `Test email sent to ${to}`);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to send test email', err, 500);
    }
});

export default router;
