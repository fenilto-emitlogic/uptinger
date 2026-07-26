import { Request, Response, NextFunction } from 'express';
import { setupModel } from '../models/setup.model.js';

export function checkSetupMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const setup = setupModel.findOne();
        const isSetupCompleted = !!setup;

        // Path of current request
        const currentPath = req.path;

        // API setup endpoint or setup view page
        const isSetupRoute = currentPath === '/auth/init-setup' || currentPath.startsWith('/api/setup');
        if (!isSetupCompleted) {
            // Setup not done: redirect to setup screen if accessing any other route
            if (!isSetupRoute) {
                return res.redirect('/auth/init-setup');
            }
        } else {
            // Setup already done: prevent re-accessing setup screen, redirect to login
            if (isSetupRoute && req.method === 'GET') {
                return res.redirect('/auth/login');
            }
        }

        next();
    } catch (error) {
        console.error('Setup Check Middleware Error:', error);
        next();
    }
}
