import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.utils.js';
import { userSessionModel } from '../models/user_session.model.js';

export function guestMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const accessToken = req.cookies?.accessToken;

    if (accessToken) {
        try {
            // Verify the token to ensure it's valid and not expired
            const decoded = verifyAccessToken(accessToken);
            // A signature-valid token whose session was revoked/wiped (e.g. DB reset)
            // must not count as "logged in" — otherwise this redirects to /dashboard,
            // which redirects back here whenever setup/auth also considers it invalid,
            // producing an infinite redirect loop.
            if (decoded.sessionId !== undefined && !userSessionModel.isActive(decoded.sessionId)) {
                res.clearCookie('accessToken');
                return next();
            }
            // User is already logged in -> redirect to dashboard
            return res.redirect('/dashboard');
        } catch (err) {
            // Token is invalid/expired -> clear cookie and let them access login
            res.clearCookie('accessToken');
        }
    }

    // No valid token found -> allow access to login page
    return next();
}