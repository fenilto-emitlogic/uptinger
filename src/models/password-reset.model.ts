import crypto from 'crypto';
import { db } from '../config/db.js';

export interface IFPasswordReset {
    id: number;
    user_id: number;
    token: string;
    purpose: 'reset' | 'invite';
    expires_at: string;
    used_at: string | null;
    created_at: string;
}

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class PasswordResetModel {
    create(userId: number, purpose: 'reset' | 'invite'): { token: string; expiresAt: string } {
        const token = crypto.randomBytes(32).toString('hex');
        const ttl = purpose === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS;
        const expiresAt = new Date(Date.now() + ttl).toISOString();

        db.prepare(`
            INSERT INTO tbl_password_resets (user_id, token, purpose, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(userId, token, purpose, expiresAt);

        return { token, expiresAt };
    }

    // Returns the reset row only if the token exists, hasn't been used, and hasn't expired.
    findValid(token: string): IFPasswordReset | undefined {
        const row = db.prepare(`SELECT * FROM tbl_password_resets WHERE token = ?`).get(token) as IFPasswordReset | undefined;
        if (!row) return undefined;
        if (row.used_at) return undefined;
        if (new Date(row.expires_at).getTime() < Date.now()) return undefined;
        return row;
    }

    markUsed(token: string) {
        db.prepare(`UPDATE tbl_password_resets SET used_at = ? WHERE token = ?`).run(new Date().toISOString(), token);
    }

    expiresInLabel(purpose: 'reset' | 'invite'): string {
        return purpose === 'invite' ? '24 hours' : '1 hour';
    }
}

export const passwordResetModel = new PasswordResetModel();
