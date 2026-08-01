import { Request, Response, NextFunction } from 'express';
import {
    verifyAccessToken,
    JwtPayload
} from '../utils/jwt.utils.js';
import { userSessionModel } from '../models/user_session.model.js';

// Extend Express Request interface to include `user`
export interface AuthenticatedRequest extends Request {
    user?: JwtPayload | { userId: number; email: string; first_name?: string };
}

export async function authenticateTokenMiddelware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    const isApiRequest = req.path.startsWith('/api') || req.baseUrl.startsWith('/api');
    const bearerToken = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined;
    // Cookie is the web login; Bearer is the mobile app — try cookie first, then Bearer.
    const accessToken = req.cookies?.accessToken || bearerToken;

    if (accessToken) {
        try {
            const decoded = verifyAccessToken(accessToken);
            // Sessions created before this check existed have no sessionId claim —
            // treat them as valid rather than force-logging out every existing user.
            if (decoded.sessionId !== undefined && !userSessionModel.isActive(decoded.sessionId)) {
                res.clearCookie('accessToken');
                if (isApiRequest) return res.status(401).json({ status: false, code: 401, message: 'Unauthorized', data: {}, error: 'Session expired' });
                return res.redirect('/auth/login');
            }
            req.user = decoded;
            return next();
        } catch (err: any) {
            res.clearCookie('accessToken');
        }
    }

    if (isApiRequest) return res.status(401).json({ status: false, code: 401, message: 'Unauthorized', data: {}, error: 'Authentication required' });
    return res.redirect('/auth/login');
}