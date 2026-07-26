import { Router } from 'express';
import { IFUser, userModel } from '../../models/user.model.js';
import { IFPassword, passwordModel } from '../../models/password.model.js';
import { hashPassword, verifyPassword } from '../../utils/password.utils.js';
import { generateAccessToken, generateRefreshToken, verifyAccessToken } from '../../utils/jwt.utils.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { userSessionModel } from '../../models/user_session.model.js';
import { userOrgModel } from '../../models/user_org.model.js';
import { passwordResetModel } from '../../models/password-reset.model.js';
import { sendTemplatedMail } from '../../utils/notify.utils.js';
import { getAppUrl } from '../../config/email-templates.js';
import { authRateLimiter } from '../../middlewares/rate-limit.middleware.js';
const router = Router();

router.post('/login', authRateLimiter, async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;

        if (!email || !password) {
            return sendError(res, 'All fields are required.', null, 400);
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        }

        // FIND USER AND PASSWORD
        let userExist: IFUser | undefined = userModel.findByEmail(email)
        if (!userExist) {
            return sendError(res, "User Not Found!", null, 404);
        }
        let userPassword: IFPassword | undefined = passwordModel.findByUserId(userExist.id)
        if (!userPassword) {
            return sendError(res, "Password Not Found!", null, 404);
        }
        if (await verifyPassword(password, userPassword.password)) {
            //Generate Refresh and Access Token
            const refreshToken = generateRefreshToken();
            const orgs = userOrgModel.listOrgsForUser(userExist.id);
            const session = userSessionModel.create(userExist.id, JSON.stringify(req.headers), req.ip);
            const accessToken = generateAccessToken({
                userId: userExist.id,
                email: userExist.email,
                orgId: orgs[0]?.org_id,
                sessionId: Number(session.lastInsertRowid),
            }, rememberMe);

            res.cookie('accessToken', accessToken, {
                httpOnly: true,                         // Prevents JavaScript access (XSS protection)
                secure: process.env.NODE_ENV === 'production', // Send over HTTPS in production
                sameSite: 'strict',                     // CSRF protection
                // "Remember me" keeps the cookie for a year, matching the access token's
                // extended validity; otherwise it's a session cookie cleared when the browser closes.
                ...(rememberMe ? { maxAge: 365 * 24 * 60 * 60 * 1000 } : {}),
            });

            return sendSuccess(res, "Login Successfully!", {
                user: {
                    id: userExist.id,
                    email: userExist.email,
                    first_name: userExist.first_name,
                    last_name: userExist.last_name
                },
                redirect: '/dashboard'
            });
        }

        return sendError(res, "Invalid email or password.", null, 401);

    } catch (err: any) {
        return res.status(500).json({ error: err.message || 'Setup failed' });
    }
});

router.post('/forgot-password', authRateLimiter, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return sendError(res, 'Email is required.', null, 400);

        // Always return a generic success message so this endpoint can't be used to
        // enumerate which emails have accounts.
        const genericMessage = 'If an account exists for that email, a reset link has been sent.';

        const user = userModel.findByEmail(email);
        if (!user) return sendSuccess(res, genericMessage);

        const orgs = userOrgModel.listOrgsForUser(user.id);
        const orgId = orgs[0]?.org_id;
        if (!orgId) return sendSuccess(res, genericMessage);

        const { token } = passwordResetModel.create(user.id, 'reset');
        const actionUrl = `${getAppUrl()}/auth/reset-password?token=${token}`;

        sendTemplatedMail(orgId, 'forgot_password', user.email, {
            user_name: user.first_name,
            org_name: orgs[0].org_name,
            action_url: actionUrl,
            expires_in: passwordResetModel.expiresInLabel('reset'),
        }).catch(err => console.error('Failed to send forgot-password email:', err.message));

        return sendSuccess(res, genericMessage);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to process request', err, 500);
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) return sendError(res, 'Token and new password are required.', null, 400);
        if (String(password).length < 8) return sendError(res, 'Password must be at least 8 characters.', null, 400);

        const reset = passwordResetModel.findValid(token);
        if (!reset) return sendError(res, 'This reset link is invalid or has expired.', null, 400);

        await passwordModel.setPassword(reset.user_id, await hashPassword(password));
        passwordResetModel.markUsed(token);

        return sendSuccess(res, 'Password reset successfully. You can now sign in.');
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to reset password', err, 500);
    }
});

function revokeCurrentSession(req: any) {
    const token = req.cookies?.accessToken;
    if (!token) return;
    try {
        const decoded = verifyAccessToken(token);
        if (decoded.sessionId) userSessionModel.revoke(decoded.sessionId);
    } catch {
        // Token already invalid/expired — nothing to revoke.
    }
}

router.post('/logout', (req, res) => {
    revokeCurrentSession(req);
    res.clearCookie('accessToken');
    return sendSuccess(res, "Logged out successfully", { redirect: '/auth/login' });
});

router.get('/logout', (req, res) => {
    revokeCurrentSession(req);
    res.clearCookie('accessToken');
    return res.redirect('/auth/login');
});

export default router;


