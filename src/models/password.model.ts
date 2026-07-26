import { db } from '../config/db.js';

export interface IFPassword {
    id: number,
    user_id: number,
    password: string,
    status: number,
    created_at: string
}


class PasswordModel {
    create(password: string, user_id: number | BigInt) {
        const stmt = db.prepare(/* sql */ `
            INSERT INTO tbl_passwords 
            (password, user_id, created_at) 
            VALUES (?, ?, ?)
            `);
        return stmt.run(password, user_id, new Date().toISOString());
    }

    findByUserId<T = IFPassword>(userId: number) {
        const stmt = db.prepare(/* sql */ `
            SELECT password FROM tbl_passwords WHERE user_id = ? LIMIT 1
        `);
        return stmt.get(userId) as T | undefined;
    }

    // Sets (or replaces) the user's password — used by forgot/reset-password and
    // invite-acceptance flows, where a row may or may not already exist.
    setPassword(userId: number, hashedPassword: string) {
        const existing = this.findByUserId(userId);
        if (existing) {
            return db.prepare(`UPDATE tbl_passwords SET password = ? WHERE user_id = ?`).run(hashedPassword, userId);
        }
        return this.create(hashedPassword, userId);
    }
}
export const passwordModel = new PasswordModel();