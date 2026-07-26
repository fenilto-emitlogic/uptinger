import { db } from '../config/db.js';
import { encrypt, decrypt } from '../utils/crypto.utils.js';

export interface IFSmtpSettings {
    id: number;
    org_id: number;
    host: string | null;
    port: number | null;
    username: string | null;
    password: string | null;
    encryption: string;
    from_email: string | null;
    from_name: string | null;
    is_active: number;
    updated_at: string;
    updated_by: number | null;
}

class SmtpModel {
    findByOrg(orgId: number): IFSmtpSettings | undefined {
        const row = db.prepare(`SELECT * FROM tbl_smtp_settings WHERE org_id = ?`).get(orgId) as IFSmtpSettings | undefined;
        if (row && row.password) row.password = decrypt(row.password);
        return row;
    }

    upsert(orgId: number, data: {
        host: string; port: number; username?: string; password?: string;
        encryption: string; from_email: string; from_name?: string; is_active: boolean;
    }, updatedBy: number) {
        const existing = this.findByOrg(orgId);
        const now = new Date().toISOString();
        const encryptedPassword = data.password ? encrypt(data.password) : null;

        if (existing) {
            return db.prepare(/* sql */ `
                UPDATE tbl_smtp_settings SET
                    host = ?, port = ?, username = ?, password = COALESCE(?, password),
                    encryption = ?, from_email = ?, from_name = ?, is_active = ?,
                    updated_at = ?, updated_by = ?
                WHERE org_id = ?
            `).run(
                data.host, data.port, data.username || null, encryptedPassword,
                data.encryption, data.from_email, data.from_name || null, data.is_active ? 1 : 0,
                now, updatedBy, orgId
            );
        }

        return db.prepare(/* sql */ `
            INSERT INTO tbl_smtp_settings (org_id, host, port, username, password, encryption, from_email, from_name, is_active, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            orgId, data.host, data.port, data.username || null, encryptedPassword,
            data.encryption, data.from_email, data.from_name || null, data.is_active ? 1 : 0,
            now, updatedBy
        );
    }
}

export const smtpModel = new SmtpModel();
