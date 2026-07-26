import { db } from '../config/db.js';
import { DEFAULT_ROLES, Permission } from '../config/permissions.js';

export interface IFRole {
    id: number;
    org_id: number;
    name: string;
    permissions: string; // JSON array
    is_system: number;
    created_at: string;
    updated_at: string;
}

export interface IFRoleParsed extends Omit<IFRole, 'permissions'> {
    permissions: Permission[];
}

function parseRole(row: IFRole | undefined): IFRoleParsed | undefined {
    if (!row) return undefined;
    return { ...row, permissions: JSON.parse(row.permissions || '[]') };
}

class RoleModel {
    seedDefaultRoles(orgId: number | bigint) {
        const stmt = db.prepare(/* sql */ `
            INSERT INTO tbl_roles (org_id, name, permissions, is_system)
            VALUES (?, ?, ?, ?)
        `);
        let adminRoleId: number | bigint | undefined;
        for (const role of DEFAULT_ROLES) {
            const result = stmt.run(orgId, role.name, JSON.stringify(role.permissions), role.is_system);
            if (role.name === 'Admin') adminRoleId = result.lastInsertRowid;
        }
        return adminRoleId;
    }

    findById(id: number): IFRoleParsed | undefined {
        return parseRole(db.prepare(`SELECT * FROM tbl_roles WHERE id = ?`).get(id) as IFRole | undefined);
    }

    findByOrg(orgId: number): IFRoleParsed[] {
        const rows = db.prepare(`SELECT * FROM tbl_roles WHERE org_id = ? ORDER BY is_system DESC, name ASC`).all(orgId) as IFRole[];
        return rows.map(r => parseRole(r)!);
    }

    findAdminRole(orgId: number | bigint): IFRoleParsed | undefined {
        return parseRole(db.prepare(`SELECT * FROM tbl_roles WHERE org_id = ? AND name = 'Admin'`).get(orgId) as IFRole | undefined);
    }

    create(orgId: number, name: string, permissions: Permission[]) {
        const stmt = db.prepare(/* sql */ `
            INSERT INTO tbl_roles (org_id, name, permissions, is_system, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
        `);
        const now = new Date().toISOString();
        return stmt.run(orgId, name, JSON.stringify(permissions), now, now);
    }

    update(id: number, name: string, permissions: Permission[]) {
        const stmt = db.prepare(/* sql */ `
            UPDATE tbl_roles SET name = ?, permissions = ?, updated_at = ? WHERE id = ?
        `);
        return stmt.run(name, JSON.stringify(permissions), new Date().toISOString(), id);
    }

    remove(id: number) {
        return db.prepare(`DELETE FROM tbl_roles WHERE id = ? AND is_system = 0`).run(id);
    }
}

export const roleModel = new RoleModel();
