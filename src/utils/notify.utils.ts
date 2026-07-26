import { sendMail } from './mail.utils.js';
import { emailTemplateModel } from '../models/email-template.model.js';
import { EmailTemplateType, renderTemplate } from '../config/email-templates.js';

// Renders the org's effective template (custom override or default) with the given
// variables substituted into both subject and body, then sends it.
export async function sendTemplatedMail(
    orgId: number,
    type: EmailTemplateType,
    to: string | string[],
    vars: Record<string, string | number | undefined>
): Promise<void> {
    const template = emailTemplateModel.getEffective(orgId, type);
    await sendMail(orgId, {
        to,
        subject: renderTemplate(template.subject, vars),
        html: renderTemplate(template.html, vars),
    });
}
