import { Router } from 'express';
import { monitorModel, toDashboardSite } from '../../models/monitor.model.js';
import { userGroupModel } from '../../models/user_group.model.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { setupModel } from '../../models/setup.model.js';
import { PERMISSIONS } from '../../config/permissions.js';

const router = Router();

// Mirrors monitor.routes.ts scopedGroupIds() — an explicit ?group_id= query (from the
// header's Group filter) narrows further, but never grants access beyond the user's scope.
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

router.get('/', (req, res) => {
    if (!setupModel.getSetup()) {
        return res.redirect('/auth/init-setup');
    }
    res.redirect('/dashboard');
});

router.get('/dashboard', authenticateTokenMiddelware, attachOrgContext, (req: OrgScopedRequest, res) => {
    if (!req.orgs || req.orgs.length === 0) {
        return res.render('no-organization', {
            title: "Uptinger",
            user: (req as any).user || { first_name: "Admin", email: "admin@uptinger.com" }
        });
    }

    const rawMonitors = monitorModel.findAll(req.currentOrg?.org_id, scopedGroupIds(req));
    const sites = rawMonitors.map(toDashboardSite);

    res.render('dashboard', {
        title: "Uptime Dashboard - Uptinger",
        sites: sites,
        user: (req as any).user || { first_name: "Admin", email: "admin@uptinger.com" },
        orgs: req.orgs || [],
        currentOrg: req.currentOrg || null
    });
});

router.get('/eagle-eye', authenticateTokenMiddelware, attachOrgContext, (req: OrgScopedRequest, res) => {
    if (!req.orgs || req.orgs.length === 0) {
        return res.render('no-organization', {
            title: "Uptinger",
            user: (req as any).user || { first_name: "Admin", email: "admin@uptinger.com" }
        });
    }

    const rawMonitors = monitorModel.findAll(req.currentOrg?.org_id, scopedGroupIds(req));
    const sites = rawMonitors.map(toDashboardSite);

    res.render('eagle-eye', {
        title: "Eagle Eye - Uptinger",
        sites: sites,
        user: (req as any).user || { first_name: "Admin", email: "admin@uptinger.com" },
        orgs: req.orgs || [],
        currentOrg: req.currentOrg || null
    });
});

router.get('/monitors/new', authenticateTokenMiddelware, attachOrgContext, (req: OrgScopedRequest, res) => {
    if (!req.orgs || req.orgs.length === 0) {
        return res.redirect('/dashboard');
    }

    res.render('add-monitor', {
        title: "Add New Monitor - Uptinger",
        user: (req as any).user || { first_name: "Admin", email: "admin@uptinger.com" },
        orgs: req.orgs || [],
        currentOrg: req.currentOrg || null,
        monitor: null
    });
});

router.get('/monitors/:id/edit', authenticateTokenMiddelware, attachOrgContext, (req: OrgScopedRequest, res) => {
    if (!req.orgs || req.orgs.length === 0) {
        return res.redirect('/dashboard');
    }

    const id = parseInt(String(req.params.id));
    const monitor = monitorModel.findById(id);
    if (!monitor || monitor.org_id !== req.currentOrg?.org_id) {
        return res.redirect('/dashboard');
    }

    res.render('add-monitor', {
        title: "Edit Monitor - Uptinger",
        user: (req as any).user || { first_name: "Admin", email: "admin@uptinger.com" },
        orgs: req.orgs || [],
        currentOrg: req.currentOrg || null,
        monitor: toDashboardSite(monitor)
    });
});

export default router;



