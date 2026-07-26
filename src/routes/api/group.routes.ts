import { Router } from 'express';
import { groupModel } from '../../models/group.model.js';
import { userGroupModel } from '../../models/user_group.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { PERMISSIONS } from '../../config/permissions.js';

const router = Router();
router.use(authenticateTokenMiddelware, attachOrgContext);

router.get('/', requirePermission(PERMISSIONS.GROUP_VIEW), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    return sendSuccess(res, 'Groups fetched', { groups: groupModel.findAllForOrg(orgId) });
});

router.post('/', requirePermission(PERMISSIONS.GROUP_CREATE), (req: OrgScopedRequest, res) => {
    try {
        const orgId = req.currentOrg!.org_id;
        const { name, description } = req.body;
        if (!name || !String(name).trim()) return sendError(res, 'Group name is required.', null, 400);

        const created = groupModel.create(orgId, name.trim(), description || '', (req.user as any).userId);
        return sendSuccess(res, 'Group created', { groupId: created.lastInsertRowid }, 201);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to create group', err, 500);
    }
});

router.put('/:id', requirePermission(PERMISSIONS.GROUP_EDIT), (req: OrgScopedRequest, res) => {
    const id = Number(req.params.id);
    const group = groupModel.findById(id);
    if (!group || group.org_id !== req.currentOrg?.org_id) return sendError(res, 'Group not found', null, 404);

    const { name, description } = req.body;
    if (!name || !String(name).trim()) return sendError(res, 'Group name is required.', null, 400);

    groupModel.update(id, name.trim(), description || '', (req.user as any).userId);
    return sendSuccess(res, 'Group updated');
});

router.delete('/:id', requirePermission(PERMISSIONS.GROUP_DELETE), (req: OrgScopedRequest, res) => {
    const id = Number(req.params.id);
    const group = groupModel.findById(id);
    if (!group || group.org_id !== req.currentOrg?.org_id) return sendError(res, 'Group not found', null, 404);

    groupModel.remove(id); // cascades tbl_user_groups; monitors' group_id is set NULL via FK
    return sendSuccess(res, 'Group deleted');
});

router.get('/:id/members', requirePermission(PERMISSIONS.GROUP_VIEW), (req: OrgScopedRequest, res) => {
    const id = Number(req.params.id);
    const group = groupModel.findById(id);
    if (!group || group.org_id !== req.currentOrg?.org_id) return sendError(res, 'Group not found', null, 404);

    return sendSuccess(res, 'Group members fetched', { members: userGroupModel.listMembersForGroup(id) });
});

// Replace a single member's group assignments (body: { userId, groupIds: number[] })
router.put('/members/assignments', requirePermission(PERMISSIONS.GROUP_EDIT), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    const { userId, groupIds } = req.body;
    if (!userId || !Array.isArray(groupIds)) return sendError(res, 'userId and groupIds[] are required.', null, 400);

    userGroupModel.setUserGroups(orgId, Number(userId), groupIds.map(Number), (req.user as any).userId);
    return sendSuccess(res, 'Member group assignments updated');
});

export default router;
