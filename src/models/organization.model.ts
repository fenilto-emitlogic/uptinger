import { db } from '../config/db.js';

export interface IFOrganization {
    id: number;
    name: string;
    status: string;
}


class OrganizationModel {
    findOne() {
        return db.prepare(`
            SELECT * FROM tbl_organization LIMIT 1`).get();
    }

    findById(id: number): IFOrganization | undefined {
        return db.prepare(`SELECT * FROM tbl_organization WHERE id = ?`).get(id) as IFOrganization | undefined;
    }

    // This app is single-tenant: exactly one organization, created during initial setup.
    create(org_name: string, owner_id: number | BigInt) {
        if (this.findOne()) {
            throw new Error('An organization already exists — this application supports a single organization.');
        }
        const stmt = db.prepare(/* sql */ `
            INSERT INTO tbl_organization
            (name, owner_id, created_at)
            VALUES (?, ?, ?)
            `);
        return stmt.run(org_name, owner_id, new Date().toISOString());
    }

    update(id: number, org_name: string, updated_by: number) {
        const stmt = db.prepare(/* sql */ `
            UPDATE tbl_organization SET name = ?, updated_at = ?, updated_by = ? WHERE id = ?
        `);
        return stmt.run(org_name, new Date().toISOString(), updated_by, id);
    }

    remove(id: number) {
        return db.prepare(`DELETE FROM tbl_organization WHERE id = ?`).run(id);
    }
}

export const organizationModel = new OrganizationModel();