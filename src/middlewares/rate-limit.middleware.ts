import rateLimit from 'express-rate-limit';

// Brute-force guard for auth-adjacent endpoints (login, password reset, initial
// setup) — these have no other throttling and are otherwise crackable/spammable.
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: false, code: 429, message: 'Too many attempts. Please try again later.', data: {}, error: 'Too many attempts. Please try again later.' },
});
