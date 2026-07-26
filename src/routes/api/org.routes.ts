import { Router } from 'express';
import { organizationModel } from '../../models/organization.model.js';
import { userModel } from '../../models/user.model.js';
import { roleModel } from '../../models/role.model.js';
import { userOrgModel } from '../../models/user_org.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { PERMISSIONS } from '../../config/permissions.js';
import { passwordResetModel } from '../../models/password-reset.model.js';
import { sendTemplatedMail } from '../../utils/notify.utils.js';
import { getAppUrl } from '../../config/email-templates.js';

const router = Router();

router.use(authenticateTokenMiddelware, attachOrgContext);

// This app is single-tenant: the one organization is created during initial setup
// (see setup.routes.ts) and cannot be created, switched, or deleted from here.

// Fetch the organization the current user belongs to
router.get('/', (req: OrgScopedRequest, res) => {
    return sendSuccess(res, 'Organizations fetched', { orgs: req.orgs || [], currentOrgId: req.currentOrg?.org_id });
});

router.put('/:id', requirePermission(PERMISSIONS.ORG_EDIT), (req: OrgScopedRequest, res) => {
    const orgId = Number(req.params.id);
    const { name } = req.body;
    if (!name || !String(name).trim()) return sendError(res, 'Organization name is required.', null, 400);
    if (orgId !== req.currentOrg?.org_id) return sendError(res, 'Org mismatch.', null, 403);

    organizationModel.update(orgId, name, (req.user as any).userId);
    return sendSuccess(res, 'Organization updated');
});

// List members of current org
router.get('/:id/members', requirePermission(PERMISSIONS.ORG_VIEW), (req: OrgScopedRequest, res) => {
    const orgId = Number(req.params.id);
    return sendSuccess(res, 'Members fetched', { members: userOrgModel.listMembers(orgId) });
});

// Invite (create-or-attach) a user to the org with a role
router.post('/:id/invite', requirePermission(PERMISSIONS.ORG_INVITE), async (req: OrgScopedRequest, res) => {
    try {
        const orgId = Number(req.params.id);
        if (orgId !== req.currentOrg?.org_id) return sendError(res, 'Org mismatch.', null, 403);

        const { email, first_name, last_name, role_id } = req.body;
        if (!email || !role_id) return sendError(res, 'Email and role are required.', null, 400);

        const role = roleModel.findById(Number(role_id));
        if (!role || role.org_id !== orgId) return sendError(res, 'Invalid role for this organization.', null, 400);

        let user = userModel.findByEmail(email);
        let isNewUser = false;

        if (!user) {
            if (!first_name || !last_name) return sendError(res, 'First and last name are required for a new user.', null, 400);
            const created = userModel.create(first_name, last_name, email, (req.user as any).userId);
            user = userModel.findById(Number(created.lastInsertRowid));
            isNewUser = true;
        }

        if (!user) return sendError(res, 'Failed to resolve user.', null, 500);

        if (userOrgModel.exists(orgId, user.id)) {
            return sendError(res, 'User is already a member of this organization.', null, 400);
        }

        userOrgModel.add(orgId, user.id, (req.user as any).userId, role.id);

        // New accounts have no password yet — send a set-password link. Existing users
        // just get pointed at sign-in since they can already log in.
        const inviterEmail = (req.user as any).email;
        const actionUrl = isNewUser
            ? (() => {
                const { token } = passwordResetModel.create(user!.id, 'invite');
                return `${getAppUrl()}/auth/reset-password?token=${token}`;
            })()
            : `${getAppUrl()}/auth/login`;

        sendTemplatedMail(orgId, 'invite', user.email, {
            user_name: user.first_name,
            org_name: req.currentOrg?.org_name || '',
            inviter_email: inviterEmail,
            action_url: actionUrl,
            expires_in: passwordResetModel.expiresInLabel('invite'),
        }).catch(err => console.error(`Failed to send invite email to ${user!.email}:`, err.message));

        return sendSuccess(res, 'User invited to organization', {
            user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name },
        }, 201);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to invite user', err, 500);
    }
});

router.put('/:id/members/:userId/role', requirePermission(PERMISSIONS.ORG_INVITE), (req: OrgScopedRequest, res) => {
    const orgId = Number(req.params.id);
    const memberUserId = Number(req.params.userId);
    const { role_id } = req.body;

    const role = roleModel.findById(Number(role_id));
    if (!role || role.org_id !== orgId) return sendError(res, 'Invalid role for this organization.', null, 400);

    userOrgModel.updateRole(orgId, memberUserId, role.id, (req.user as any).userId);
    return sendSuccess(res, 'Member role updated');
});

router.delete('/:id/members/:userId', requirePermission(PERMISSIONS.ORG_INVITE), (req: OrgScopedRequest, res) => {
    const orgId = Number(req.params.id);
    const memberUserId = Number(req.params.userId);
    if (memberUserId === (req.user as any).userId) {
        return sendError(res, 'You cannot remove yourself from the organization.', null, 400);
    }
    userOrgModel.remove(orgId, memberUserId);
    return sendSuccess(res, 'Member removed');
});

export default router;
