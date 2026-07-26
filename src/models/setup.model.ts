import { db } from '../config/db.js';

export interface IFSetup {
    id: number;
    org_name: string;
    first_name: string;
    last_name: string;
    email: string;
    password?: string;
    status: string;
    created_at?: string;
}

class SetupModel {
    findOne() {
        return db.prepare(`SELECT * FROM tbl_init_setup LIMIT 1`).get() as IFSetup | undefined;
    }

    getSetup() {
        return db.prepare(`SELECT * FROM tbl_init_setup LIMIT 1`).get() as IFSetup | undefined;
    }

    create() {
        const stmt = db.prepare(`
            INSERT INTO tbl_init_setup (step_no, is_completed, created_at) 
            VALUES (?, ?, ?)
        `);
        return stmt.run(1, 1, new Date().toISOString());
    }
}

export const setupModel = new SetupModel();