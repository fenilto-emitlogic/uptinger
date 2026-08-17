import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

// Brute-force guard for auth-adjacent endpoints (login, password reset, initial
// setup) — these have no other throttling and are otherwise crackable/spammable.
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: false, code: 429, message: 'Too many attempts. Please try again later.', data: {}, error: 'Too many attempts. Please try again later.' },
});

// Agents are expected to push roughly every 15-30s; keyed on the monitor id (part of the
// URL) rather than IP alone so one VPS's misbehaving agent can't exhaust the budget for
// every other agent sharing an IP/NAT gateway.
export const agentIngestRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 12,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => `${ipKeyGenerator(req.ip || '')}:${req.params.id}`,
    message: { status: false, code: 429, message: 'Too many metrics pushes. Slow down your agent interval.', data: {}, error: 'Rate limit exceeded' },
});
