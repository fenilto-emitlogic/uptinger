import { Router } from 'express';
import { userModel } from '../../models/user.model.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateTokenMiddelware);

router.get('/profile', (req, res) => {
    const userId = (req as any).user.userId;
    const user = userModel.findById(userId);
    if (!user) return sendError(res, 'User not found.', null, 404);
    return sendSuccess(res, 'Profile fetched', {
        id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name
    });
});

router.put('/profile', (req, res) => {
    const userId = (req as any).user.userId;
    const { first_name, last_name } = req.body;
    if (!first_name || !String(first_name).trim() || !last_name || !String(last_name).trim()) {
        return sendError(res, 'First and last name are required.', null, 400);
    }

    userModel.updateProfile(userId, first_name, last_name);
    return sendSuccess(res, 'Profile updated');
});

export default router;
