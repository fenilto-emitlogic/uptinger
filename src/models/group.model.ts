import { db } from '../config/db.js';

export interface IFGroup {
    id: number;
    org_id: number;
    name: string;
    description: string;
    created_at: string;
    created_by: number;
    updated_at: string;
    updated_by: number | null;
}

export interface IFGroupWithCounts extends IFGroup {
    member_count: number;
    monitor_count: number;
}

class GroupModel {
    findAllForOrg(orgId: number): IFGroupWithCounts[] {
        return db.prepare(/* sql */ `
            SELECT g.*,
                (SELECT COUNT(*) FROM tbl_user_groups ug WHERE ug.group_id = g.id) AS member_count,
                (SELECT COUNT(*) FROM tbl_monitors m WHERE m.group_id = g.id) AS monitor_count
            FROM tbl_groups g
            WHERE g.org_id = ?
            ORDER BY g.name ASC
        `).all(orgId) as IFGroupWithCounts[];
    }

    findById(id: number): IFGroup | undefined {
        return db.prepare(`SELECT * FROM tbl_groups WHERE id = ?`).get(id) as IFGroup | undefined;
    }

    create(orgId: number, name: string, description: string, createdBy: number): { lastInsertRowid: number | bigint } {
        const now = new Date().toISOString();
        return db.prepare(/* sql */ `
            INSERT INTO tbl_groups (org_id, name, description, created_at, created_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(orgId, name, description || '', now, createdBy, now);
    }

    update(id: number, name: string, description: string, updatedBy: number) {
        return db.prepare(/* sql */ `
            UPDATE tbl_groups SET name = ?, description = ?, updated_at = ?, updated_by = ? WHERE id = ?
        `).run(name, description || '', new Date().toISOString(), updatedBy, id);
    }

    remove(id: number) {
        return db.prepare(`DELETE FROM tbl_groups WHERE id = ?`).run(id);
    }
}

export const groupModel = new GroupModel();
