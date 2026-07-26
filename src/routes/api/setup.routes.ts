import { Router } from 'express';
import { setupModel } from '../../models/setup.model.js';
import { organizationModel } from '../../models/organization.model.js';
import { userModel } from '../../models/user.model.js';
import { passwordModel } from '../../models/password.model.js';
import { hashPassword } from '../../utils/password.utils.js';
import { db } from '../../config/db.js';
import { roleModel } from '../../models/role.model.js';
import { authRateLimiter } from '../../middlewares/rate-limit.middleware.js';
const router = Router();

router.post('/create', authRateLimiter, async (req, res) => {
    try {
        const { org_name, first_name, last_name, email, password, confirm_password } = req.body;

        const checkSetup = setupModel.getSetup();
        if (checkSetup) {
            return res.status(400).json({ error: 'Setup has already been completed.' });
        }

        if (!org_name || !first_name || !last_name || !email || !password || !confirm_password) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        if (password !== confirm_password) {
            return res.status(400).json({ error: 'Password and Confirm Password do not match.' });
        }

        // Password constraints: min 8 chars, 1 uppercase, 1 lowercase, 1 digit, 1 special char
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                error: 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.'
            });
        }


        const userData = userModel.create(first_name, last_name, email, null);
        if (!userData || !userData.lastInsertRowid) {
            return res.status(500).json({ error: 'Failed to create admin user.' });
        }
        const userId = userData.lastInsertRowid;

        await passwordModel.create(await hashPassword(password), userId);

        const orgData = organizationModel.create(org_name, userId);
        if (orgData && orgData.lastInsertRowid) {
            const adminRoleId = roleModel.seedDefaultRoles(orgData.lastInsertRowid);
            db.prepare(/* sql */ `
                INSERT INTO tbl_user_orgs (org_id, user_id, role_id, created_by, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(orgData.lastInsertRowid, userId, adminRoleId ?? null, userId, new Date().toISOString());
        }

        setupModel.create();

        return res.json({ success: true, redirect: '/auth/login' });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Setup failed' });
    }
});

export default router;


