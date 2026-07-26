import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware.js';
import { userOrgModel, IFOrgMembership } from '../models/user_org.model.js';
import { userModel } from '../models/user.model.js';
import { Permission, hasPermission } from '../config/permissions.js';

export interface OrgScopedRequest extends AuthenticatedRequest {
    orgs?: IFOrgMembership[];
    currentOrg?: IFOrgMembership;
}

/**
 * Resolves the acting user's orgs and current org membership (incl. permissions)
 * from the JWT's `orgId`, falling back to the first org they belong to.
 * Also enriches req.user with first_name/last_name — the JWT only carries userId/email.
 */
export function attachOrgContext(req: OrgScopedRequest, res: Response, next: NextFunction) {
    const user = req.user as any;
    if (!user?.userId) return next();

    const profile = userModel.findById(user.userId);
    if (profile) {
        user.first_name = profile.first_name;
        user.last_name = profile.last_name;
    }

    const orgs = userOrgModel.listOrgsForUser(user.userId);
    req.orgs = orgs;

    const requestedOrgId = user.orgId;
    req.currentOrg = orgs.find(o => o.org_id === requestedOrgId) || orgs[0];

    next();
}

export function requirePermission(permission: Permission) {
    return (req: OrgScopedRequest, res: Response, next: NextFunction) => {
        const perms = req.currentOrg?.permissions || [];
        if (!hasPermission(perms, permission)) {
            if (req.headers.accept?.includes('application/json') || req.originalUrl.startsWith('/api')) {
                return res.status(403).json({ status: false, code: 403, message: 'You do not have permission to perform this action.', data: {}, error: 'forbidden' });
            }
            return res.status(403).send('Forbidden: missing permission ' + permission);
        }
        next();
    };
}
