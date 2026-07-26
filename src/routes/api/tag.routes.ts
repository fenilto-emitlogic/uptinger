import { Router } from 'express';
import { tagModel } from '../../models/tag.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { PERMISSIONS } from '../../config/permissions.js';

const router = Router();
router.use(authenticateTokenMiddelware, attachOrgContext);

// GET /api/tags - List tags for the active organization (used for filter dropdowns
// and the tag-input autocomplete). Pass ?withCounts=1 for the org-settings management
// view, which also needs how many monitors each tag is attached to.
router.get('/', (req: OrgScopedRequest, res) => {
    try {
        if (!req.currentOrg) {
            return sendSuccess(res, 'Tags fetched successfully', { tags: [] });
        }
        const tags = req.query.withCounts
            ? tagModel.findAllForOrgWithCounts(req.currentOrg.org_id)
            : tagModel.findAllForOrg(req.currentOrg.org_id);
        return sendSuccess(res, 'Tags fetched successfully', { tags });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to fetch tags', null, 500);
    }
});

// POST /api/tags - Create a tag, or return the existing one if the name already
// exists for this org (case-insensitive)
router.post('/', (req: OrgScopedRequest, res) => {
    try {
        if (!req.currentOrg) {
            return sendError(res, 'You must belong to an organization to create tags.', null, 400);
        }
        const name = String(req.body.name || '').trim();
        if (!name) {
            return sendError(res, 'Tag name is required', null, 400);
        }
        const tag = tagModel.findOrCreate(req.currentOrg.org_id, name);
        return sendSuccess(res, 'Tag created successfully', { tag }, 201);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to create tag', null, 500);
    }
});

// DELETE /api/tags/:id - Permanently delete a tag, unassigning it from every
// monitor it was on (org-settings only; requires TAG_MANAGE)
router.delete('/:id', requirePermission(PERMISSIONS.TAG_MANAGE), (req: OrgScopedRequest, res) => {
    try {
        const id = parseInt(String(req.params.id));
        const tag = tagModel.findById(id);
        if (!tag || tag.org_id !== req.currentOrg?.org_id) {
            return sendError(res, 'Tag not found', null, 404);
        }
        tagModel.remove(id);
        return sendSuccess(res, 'Tag deleted successfully');
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to delete tag', null, 500);
    }
});

export default router;
