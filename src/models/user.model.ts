import { db } from '../config/db.js';

export interface IFUser {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    status: number;
    created_at: string;
    created_by: number | null;
    updated_at: string;
    updated_by: number | null;
}


class UserModel {
    create(first_name: string, last_name: string, email: string, created_by: number | null = null) {
        const stmt = db.prepare(/* sql */ `
            INSERT INTO tbl_users 
            (first_name, last_name, email, created_at, updated_at, created_by) 
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        // Force 'undefined' to explicitly become 'null'
        const createdByValue = created_by ?? null;

        return stmt.run(
            first_name,
            last_name,
            email,
            new Date().toISOString(),
            new Date().toISOString(),
            createdByValue
        );
    }

    findByEmail<T = IFUser>(email: string): T | undefined {
        const stmt = db.prepare(/* sql */ `
            SELECT * FROM tbl_users WHERE email = ? LIMIT 1
        `);

        // Cast the return value to T | undefined
        return stmt.get(email) as T | undefined;
    }

    findById(id: number): IFUser | undefined {
        return db.prepare(`SELECT * FROM tbl_users WHERE id = ?`).get(id) as IFUser | undefined;
    }

    updateProfile(id: number, first_name: string, last_name: string) {
        const stmt = db.prepare(/* sql */ `
            UPDATE tbl_users SET first_name = ?, last_name = ?, updated_at = ?, updated_by = ? WHERE id = ?
        `);
        return stmt.run(first_name, last_name, new Date().toISOString(), id, id);
    }
}
export const userModel = new UserModel();