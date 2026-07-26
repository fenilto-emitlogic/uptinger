import { db } from '../config/db.js';

export interface IFGroupMember {
    user_id: number;
    first_name: string;
    last_name: string;
    email: string;
}

class UserGroupModel {
    assign(groupId: number, userId: number, createdBy: number) {
        return db.prepare(/* sql */ `
            INSERT OR IGNORE INTO tbl_user_groups (group_id, user_id, created_by, created_at)
            VALUES (?, ?, ?, ?)
        `).run(groupId, userId, createdBy, new Date().toISOString());
    }

    unassign(groupId: number, userId: number) {
        return db.prepare(`DELETE FROM tbl_user_groups WHERE group_id = ? AND user_id = ?`).run(groupId, userId);
    }

    // Replaces a user's group memberships (within the given org's groups) with exactly `groupIds`.
    setUserGroups(orgId: number, userId: number, groupIds: number[], createdBy: number) {
        const tx = db.transaction(() => {
            db.prepare(/* sql */ `
                DELETE FROM tbl_user_groups
                WHERE user_id = ? AND group_id IN (SELECT id FROM tbl_groups WHERE org_id = ?)
            `).run(userId, orgId);

            const insert = db.prepare(/* sql */ `
                INSERT INTO tbl_user_groups (group_id, user_id, created_by, created_at) VALUES (?, ?, ?, ?)
            `);
            const now = new Date().toISOString();
            for (const groupId of groupIds) insert.run(groupId, userId, createdBy, now);
        });
        tx();
    }

    listGroupIdsForUser(userId: number): number[] {
        const rows = db.prepare(`SELECT group_id FROM tbl_user_groups WHERE user_id = ?`).all(userId) as { group_id: number }[];
        return rows.map(r => r.group_id);
    }

    listMembersForGroup(groupId: number): IFGroupMember[] {
        return db.prepare(/* sql */ `
            SELECT u.id AS user_id, u.first_name, u.last_name, u.email
            FROM tbl_user_groups ug
            JOIN tbl_users u ON u.id = ug.user_id
            WHERE ug.group_id = ?
            ORDER BY u.first_name ASC
        `).all(groupId) as IFGroupMember[];
    }
}

export const userGroupModel = new UserGroupModel();
