import { db } from '../config/db.js';
import { Permission } from '../config/permissions.js';

export interface IFUserOrg {
    id: number;
    org_id: number;
    user_id: number;
    role_id: number | null;
    created_at: string;
    created_by: number;
    updated_at: string;
    updated_by: number | null;
}

export interface IFOrgMembership {
    org_id: number;
    org_name: string;
    role_id: number | null;
    role_name: string | null;
    permissions: Permission[];
}

export interface IFOrgMember {
    user_id: number;
    first_name: string;
    last_name: string;
    email: string;
    role_id: number | null;
    role_name: string | null;
}

class UserOrgModel {
    add(orgId: number | bigint, userId: number | bigint, createdBy: number | bigint, roleId?: number | bigint | null) {
        const stmt = db.prepare(/* sql */ `
            INSERT INTO tbl_user_orgs (org_id, user_id, role_id, created_by, created_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        return stmt.run(orgId, userId, roleId ?? null, createdBy, new Date().toISOString());
    }

    findMembership(userId: number, orgId: number): IFOrgMembership | undefined {
        const row = db.prepare(/* sql */ `
            SELECT uo.org_id, o.name AS org_name, r.id AS role_id, r.name AS role_name, r.permissions AS role_permissions
            FROM tbl_user_orgs uo
            JOIN tbl_organization o ON o.id = uo.org_id
            LEFT JOIN tbl_roles r ON r.id = uo.role_id
            WHERE uo.user_id = ? AND uo.org_id = ?
            LIMIT 1
        `).get(userId, orgId) as any;
        if (!row) return undefined;
        return {
            org_id: row.org_id,
            org_name: row.org_name,
            role_id: row.role_id,
            role_name: row.role_name,
            permissions: row.role_permissions ? JSON.parse(row.role_permissions) : [],
        };
    }

    listOrgsForUser(userId: number): IFOrgMembership[] {
        const rows = db.prepare(/* sql */ `
            SELECT uo.org_id, o.name AS org_name, r.id AS role_id, r.name AS role_name, r.permissions AS role_permissions
            FROM tbl_user_orgs uo
            JOIN tbl_organization o ON o.id = uo.org_id
            LEFT JOIN tbl_roles r ON r.id = uo.role_id
            WHERE uo.user_id = ?
            ORDER BY o.name ASC
        `).all(userId) as any[];
        return rows.map(row => ({
            org_id: row.org_id,
            org_name: row.org_name,
            role_id: row.role_id,
            role_name: row.role_name,
            permissions: row.role_permissions ? JSON.parse(row.role_permissions) : [],
        }));
    }

    listMembers(orgId: number): IFOrgMember[] {
        return db.prepare(/* sql */ `
            SELECT u.id AS user_id, u.first_name, u.last_name, u.email, r.id AS role_id, r.name AS role_name
            FROM tbl_user_orgs uo
            JOIN tbl_users u ON u.id = uo.user_id
            LEFT JOIN tbl_roles r ON r.id = uo.role_id
            WHERE uo.org_id = ?
            ORDER BY u.first_name ASC
        `).all(orgId) as IFOrgMember[];
    }

    countByRole(orgId: number, roleId: number): number {
        const row = db.prepare(`SELECT COUNT(*) AS cnt FROM tbl_user_orgs WHERE org_id = ? AND role_id = ?`).get(orgId, roleId) as { cnt: number };
        return row.cnt;
    }

    updateRole(orgId: number, userId: number, roleId: number, updatedBy: number) {
        return db.prepare(/* sql */ `
            UPDATE tbl_user_orgs SET role_id = ?, updated_by = ?, updated_at = ?
            WHERE org_id = ? AND user_id = ?
        `).run(roleId, updatedBy, new Date().toISOString(), orgId, userId);
    }

    remove(orgId: number, userId: number) {
        return db.prepare(`DELETE FROM tbl_user_orgs WHERE org_id = ? AND user_id = ?`).run(orgId, userId);
    }

    exists(orgId: number, userId: number): boolean {
        const row = db.prepare(`SELECT id FROM tbl_user_orgs WHERE org_id = ? AND user_id = ? LIMIT 1`).get(orgId, userId);
        return !!row;
    }
}

export const userOrgModel = new UserOrgModel();
