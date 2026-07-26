import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export interface JwtPayload {
    userId: number;
    email: string;
    orgId?: number;
    sessionId?: number;
}

if (!process.env.JWT_ACCESS_SECRET) {
    console.error('[security] JWT_ACCESS_SECRET is not set. Set it in your environment before starting the server.');
    process.exit(1);
}
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
// Session revocation (see tbl_user_sessions.status) is the real logout/expiry backstop,
// so the token's own lifetime just bounds worst-case exposure of a stolen cookie.
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '30d';
// "Remember me" keeps both the cookie and the token itself alive for a year, instead
// of the short-lived default — matches the cookie maxAge set in account.routes.ts.
const ACCESS_EXPIRES_IN_REMEMBERED = process.env.JWT_ACCESS_EXPIRES_IN_REMEMBERED || '365d';

/**
 * Generate Access Token (JWT)
 */
export function generateAccessToken(payload: JwtPayload, rememberMe = false): string {
    return jwt.sign(payload, ACCESS_SECRET, {
        expiresIn: rememberMe ? ACCESS_EXPIRES_IN_REMEMBERED : ACCESS_EXPIRES_IN,
    } as jwt.SignOptions);
}

/**
 * Verify Access Token
 */
export function verifyAccessToken(token: string): JwtPayload {
    return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
}

/**
 * Generate Random Hex Refresh Token (Opaque Token)
 * Generates a 64-character secure random hex string (32 bytes)
 */
export function generateRefreshToken(): string {
    return crypto.randomBytes(32).toString('hex');
}