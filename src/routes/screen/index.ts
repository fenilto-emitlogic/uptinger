import { Router } from 'express';
import openRoutes from '../screen/open.routes.js';
import dashboardRoutes from '../screen/dashboard.routes.js';
import settingsRoutes from '../screen/settings.routes.js';

const router = Router();

// Mount view routes
router.use('/', dashboardRoutes);
router.use('/auth', openRoutes);
router.use('/settings', settingsRoutes);


export default router;
