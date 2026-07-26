import { db } from '../config/db.js';

export interface IFTag {
    id: number;
    org_id: number;
    name: string;
    created_at?: string;
}

export interface IFTagWithCount extends IFTag {
    monitor_count: number;
}

class TagModel {
    findAllForOrg(orgId: number): IFTag[] {
        return db.prepare(`SELECT * FROM tbl_tags WHERE org_id = ? ORDER BY name COLLATE NOCASE ASC`).all(orgId) as IFTag[];
    }

    findAllForOrgWithCounts(orgId: number): IFTagWithCount[] {
        return db.prepare(`
            SELECT t.*, (SELECT COUNT(*) FROM tbl_monitor_tags mt WHERE mt.tag_id = t.id) AS monitor_count
            FROM tbl_tags t
            WHERE t.org_id = ?
            ORDER BY t.name COLLATE NOCASE ASC
        `).all(orgId) as IFTagWithCount[];
    }

    findById(id: number): IFTag | undefined {
        return db.prepare(`SELECT * FROM tbl_tags WHERE id = ?`).get(id) as IFTag | undefined;
    }

    // Cascades tbl_monitor_tags via FK — removing a tag unassigns it from every
    // monitor it was on rather than blocking the delete.
    remove(id: number): boolean {
        const res = db.prepare(`DELETE FROM tbl_tags WHERE id = ?`).run(id);
        return res.changes > 0;
    }

    // Case-insensitive thanks to the column's COLLATE NOCASE — "web" and "Web"
    // resolve to the same row instead of creating a duplicate tag.
    findOrCreate(orgId: number, name: string): IFTag | undefined {
        const trimmed = name.trim();
        if (!trimmed) return undefined;

        const existing = db.prepare(`SELECT * FROM tbl_tags WHERE org_id = ? AND name = ?`).get(orgId, trimmed) as IFTag | undefined;
        if (existing) return existing;

        const res = db.prepare(`INSERT INTO tbl_tags (org_id, name) VALUES (?, ?)`).run(orgId, trimmed);
        return db.prepare(`SELECT * FROM tbl_tags WHERE id = ?`).get(res.lastInsertRowid) as IFTag;
    }

    getForMonitor(monitorId: number): IFTag[] {
        return db.prepare(`
            SELECT t.* FROM tbl_tags t
            JOIN tbl_monitor_tags mt ON mt.tag_id = t.id
            WHERE mt.monitor_id = ?
            ORDER BY t.name COLLATE NOCASE ASC
        `).all(monitorId) as IFTag[];
    }

    // Replaces the full set of tags assigned to a monitor with `names`,
    // creating any tags that don't exist yet for the org.
    setForMonitor(monitorId: number, orgId: number, names: string[]): void {
        const uniqueNames = Array.from(new Set(names.map(n => n.trim()).filter(Boolean)));
        const tagIds = uniqueNames
            .map(n => this.findOrCreate(orgId, n))
            .filter((t): t is IFTag => !!t)
            .map(t => t.id);

        const replace = db.transaction((ids: number[]) => {
            db.prepare(`DELETE FROM tbl_monitor_tags WHERE monitor_id = ?`).run(monitorId);
            const insert = db.prepare(`INSERT OR IGNORE INTO tbl_monitor_tags (monitor_id, tag_id) VALUES (?, ?)`);
            for (const tagId of ids) insert.run(monitorId, tagId);
        });
        replace(tagIds);
    }
}

export const tagModel = new TagModel();
