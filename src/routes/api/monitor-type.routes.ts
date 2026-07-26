import { Router } from 'express';
import { monitorTypeModel } from '../../models/monitor-type.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';

const router = Router();

// GET /api/monitor-types - List all active monitor types grouped by category
router.get('/', (req, res) => {
    try {
        const grouped = monitorTypeModel.groupedByCategory();
        return sendSuccess(res, 'Monitor types fetched successfully', { types: grouped });
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to fetch monitor types', null, 500);
    }
});

export default router;
