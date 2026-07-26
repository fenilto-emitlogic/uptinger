import { db } from '../config/db.js';

export interface IFEagleEyeSettings {
    id: number;
    org_id: number;
    autoscroll_interval_seconds: number;
    updated_at: string;
    updated_by: number | null;
}

class EagleEyeSettingsModel {
    findByOrg(orgId: number): IFEagleEyeSettings | undefined {
        return db.prepare(`SELECT * FROM tbl_eagle_eye_settings WHERE org_id = ?`).get(orgId) as IFEagleEyeSettings | undefined;
    }

    upsert(orgId: number, autoscrollIntervalSeconds: number, updatedBy: number) {
        const existing = this.findByOrg(orgId);
        const now = new Date().toISOString();

        if (existing) {
            return db.prepare(/* sql */ `
                UPDATE tbl_eagle_eye_settings SET
                    autoscroll_interval_seconds = ?, updated_at = ?, updated_by = ?
                WHERE org_id = ?
            `).run(autoscrollIntervalSeconds, now, updatedBy, orgId);
        }

        return db.prepare(/* sql */ `
            INSERT INTO tbl_eagle_eye_settings (org_id, autoscroll_interval_seconds, updated_at, updated_by)
            VALUES (?, ?, ?, ?)
        `).run(orgId, autoscrollIntervalSeconds, now, updatedBy);
    }
}

export const eagleEyeSettingsModel = new EagleEyeSettingsModel();
