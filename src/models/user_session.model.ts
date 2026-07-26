import { db } from '../config/db.js';

export interface IFUserSessionModel {
    id: number,
    user_id: number,
    meta: string,
    ip_address: string,
    created_date: string,
    status: number
}


class UserSessionModel {
    create(user_id: number, meta: string | null, ip_address: string | null | undefined = null) {
        const stmt = db.prepare(/* sql */ `
            INSERT INTO tbl_user_sessions
            (user_id, meta, ip_address, created_date)
            VALUES (?, ?, ?, ?)
        `);

        return stmt.run(
            user_id,
            meta,
            ip_address,
            new Date().toISOString()
        );
    }

    isActive(id: number): boolean {
        const row = db.prepare(`SELECT status FROM tbl_user_sessions WHERE id = ?`).get(id) as { status: number } | undefined;
        return !!row && row.status === 1;
    }

    revoke(id: number) {
        db.prepare(`UPDATE tbl_user_sessions SET status = 0 WHERE id = ?`).run(id);
    }

}
export const userSessionModel = new UserSessionModel();