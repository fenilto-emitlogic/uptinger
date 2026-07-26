import { Router } from 'express';
import { setupModel } from '../../models/setup.model.js';
import { guestMiddleware } from '../../middlewares/guest.middleware.js';

const router = Router();

router.get('/login', guestMiddleware, (req, res) => {
    if (!setupModel.getSetup()) {
        return res.redirect('/auth/init-setup');
    }
    res.render('login');
});

router.get('/init-setup', guestMiddleware, (req, res) => {
    if (setupModel.getSetup()) {
        return res.redirect('/auth/login');
    }
    res.render('setup');
});

router.get('/forgot-password', guestMiddleware, (req, res) => {
    res.render('forgot-password');
});

router.get('/reset-password', guestMiddleware, (req, res) => {
    res.render('reset-password', { token: req.query.token || '' });
});

export default router;

