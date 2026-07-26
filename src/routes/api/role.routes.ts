import { Router } from 'express';
import { roleModel } from '../../models/role.model.js';
import { userOrgModel } from '../../models/user_org.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { ALL_PERMISSIONS, PERMISSIONS, Permission } from '../../config/permissions.js';

const router = Router();

router.use(authenticateTokenMiddelware, attachOrgContext);

router.get('/', requirePermission(PERMISSIONS.ROLE_VIEW), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    return sendSuccess(res, 'Roles fetched', { roles: roleModel.findByOrg(orgId) });
});

router.post('/', requirePermission(PERMISSIONS.ROLE_CREATE), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    const { name, permissions } = req.body;
    if (!name || !String(name).trim()) return sendError(res, 'Role name is required.', null, 400);

    const perms: Permission[] = Array.isArray(permissions) ? permissions.filter((p: string) => ALL_PERMISSIONS.includes(p as Permission)) : [];

    try {
        const result = roleModel.create(orgId, name, perms);
        return sendSuccess(res, 'Role created', { roleId: result.lastInsertRowid }, 201);
    } catch (err: any) {
        if (String(err.message).includes('UNIQUE')) return sendError(res, 'A role with that name already exists.', null, 400);
        return sendError(res, err.message || 'Failed to create role', err, 500);
    }
});

router.put('/:id', requirePermission(PERMISSIONS.ROLE_EDIT), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    const roleId = Number(req.params.id);
    const { name, permissions } = req.body;

    const role = roleModel.findById(roleId);
    if (!role || role.org_id !== orgId) return sendError(res, 'Role not found.', null, 404);
    if (!name || !String(name).trim()) return sendError(res, 'Role name is required.', null, 400);

    const perms: Permission[] = Array.isArray(permissions) ? permissions.filter((p: string) => ALL_PERMISSIONS.includes(p as Permission)) : [];

    try {
        roleModel.update(roleId, name, perms);
        return sendSuccess(res, 'Role updated');
    } catch (err: any) {
        if (String(err.message).includes('UNIQUE')) return sendError(res, 'A role with that name already exists.', null, 400);
        return sendError(res, err.message || 'Failed to update role', err, 500);
    }
});

router.delete('/:id', requirePermission(PERMISSIONS.ROLE_DELETE), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    const roleId = Number(req.params.id);

    const role = roleModel.findById(roleId);
    if (!role || role.org_id !== orgId) return sendError(res, 'Role not found.', null, 404);
    if (role.is_system) return sendError(res, 'System roles cannot be deleted.', null, 400);
    if (userOrgModel.countByRole(orgId, roleId) > 0) {
        return sendError(res, 'Cannot delete a role that is still assigned to members.', null, 400);
    }

    roleModel.remove(roleId);
    return sendSuccess(res, 'Role deleted');
});

export default router;
