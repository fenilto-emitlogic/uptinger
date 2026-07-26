import { db } from '../config/db.js';
import { EmailTemplateType, getDefaultTemplate } from '../config/email-templates.js';

export interface IFEmailTemplateRow {
    id: number;
    org_id: number;
    type: string;
    subject: string;
    html: string;
    updated_at: string;
    updated_by: number | null;
}

class EmailTemplateModel {
    findOverride(orgId: number, type: EmailTemplateType): IFEmailTemplateRow | undefined {
        return db.prepare(`SELECT * FROM tbl_email_templates WHERE org_id = ? AND type = ?`).get(orgId, type) as IFEmailTemplateRow | undefined;
    }

    // Returns the effective subject/html for a type: the org's custom override if one
    // exists, otherwise the built-in default.
    getEffective(orgId: number, type: EmailTemplateType): { subject: string; html: string; is_custom: boolean } {
        const override = this.findOverride(orgId, type);
        if (override) return { subject: override.subject, html: override.html, is_custom: true };
        const def = getDefaultTemplate(type);
        return { ...def, is_custom: false };
    }

    upsert(orgId: number, type: EmailTemplateType, subject: string, html: string, updatedBy: number) {
        const now = new Date().toISOString();
        return db.prepare(`
            INSERT INTO tbl_email_templates (org_id, type, subject, html, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(org_id, type) DO UPDATE SET
                subject = excluded.subject, html = excluded.html,
                updated_at = excluded.updated_at, updated_by = excluded.updated_by
        `).run(orgId, type, subject, html, now, updatedBy);
    }

    // Reverting just removes the override row — getEffective() then falls back to the default.
    revert(orgId: number, type: EmailTemplateType) {
        return db.prepare(`DELETE FROM tbl_email_templates WHERE org_id = ? AND type = ?`).run(orgId, type);
    }
}

export const emailTemplateModel = new EmailTemplateModel();
