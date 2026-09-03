import { Router } from 'express';
import setupRoutes from './setup.routes.js';
import accountRoutes from './account.routes.js';
import monitorRoutes from './monitor.routes.js';
import monitorTypeRoutes from './monitor-type.routes.js';
import orgRoutes from './org.routes.js';
import roleRoutes from './role.routes.js';
import userRoutes from './user.routes.js';
import groupRoutes from './group.routes.js';
import smtpRoutes from './smtp.routes.js';
import pushRoutes from './push.routes.js';
import agentRoutes from './agent.routes.js';
import mobileRoutes from './mobile.routes.js';
import tagRoutes from './tag.routes.js';
import eagleEyeSettingsRoutes from './eagle-eye-settings.routes.js';
import emailTemplateRoutes from './email-template.routes.js';

const router = Router();

// Unauthenticated reachability check used by the mobile app to validate a
// self-hosted server URL before the user attempts to log in.
router.get('/health', (req, res) => {
    res.json({ status: true, code: 200, message: 'ok', data: { ok: true, name: 'uptinger' }, error: null });
});

router.use('/push', pushRoutes);
router.use('/agent', agentRoutes);
router.use('/mobile', mobileRoutes);
router.use('/tags', tagRoutes);
router.use('/setup', setupRoutes);
router.use('/account', accountRoutes);
router.use('/monitors', monitorRoutes);
router.use('/sites', monitorRoutes);
router.use('/monitor-types', monitorTypeRoutes);
router.use('/org', orgRoutes);
router.use('/roles', roleRoutes);
router.use('/user', userRoutes);
router.use('/groups', groupRoutes);
router.use('/smtp', smtpRoutes);
router.use('/eagle-eye-settings', eagleEyeSettingsRoutes);
router.use('/email-templates', emailTemplateRoutes);

export default router;

