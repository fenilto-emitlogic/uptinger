import { Router } from 'express';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { userModel } from '../../models/user.model.js';
import { PERMISSION_GROUPS, PERMISSIONS } from '../../config/permissions.js';

const router = Router();

router.get('/organization', authenticateTokenMiddelware, attachOrgContext, requirePermission(PERMISSIONS.ORG_VIEW), (req: OrgScopedRequest, res) => {
    if (!req.currentOrg) return res.redirect('/dashboard');

    res.render('org-settings', {
        title: 'Organization Settings - Uptinger',
        user: (req as any).user || { first_name: 'Admin', email: 'admin@uptinger.com' },
        orgs: req.orgs || [],
        currentOrg: req.currentOrg,
        permissionGroups: PERMISSION_GROUPS,
        permissions: req.currentOrg.permissions
    });
});

router.get('/profile', authenticateTokenMiddelware, attachOrgContext, (req: OrgScopedRequest, res) => {
    const userId = (req.user as any).userId;
    const profile = userModel.findById(userId);

    res.render('user-settings', {
        title: 'My Profile - Uptinger',
        user: (req as any).user || { first_name: 'Admin', email: 'admin@uptinger.com' },
        orgs: req.orgs || [],
        currentOrg: req.currentOrg || null,
        profile
    });
});

export default router;
