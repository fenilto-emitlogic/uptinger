import { Router } from 'express';
import { emailTemplateModel } from '../../models/email-template.model.js';
import { sendMail } from '../../utils/mail.utils.js';
import { EMAIL_TEMPLATE_META, EMAIL_TEMPLATE_TYPES, EmailTemplateType, renderTemplate, SAMPLE_VARS } from '../../config/email-templates.js';
import { sendError, sendSuccess } from '../../utils/res.utils.js';
import { authenticateTokenMiddelware } from '../../middlewares/auth.middleware.js';
import { attachOrgContext, requirePermission, OrgScopedRequest } from '../../middlewares/org.middleware.js';
import { PERMISSIONS } from '../../config/permissions.js';

const router = Router();
router.use(authenticateTokenMiddelware, attachOrgContext);

function isValidType(type: string): type is EmailTemplateType {
    return (EMAIL_TEMPLATE_TYPES as string[]).includes(type);
}

// GET /api/email-templates - list all template types with their effective content
router.get('/', requirePermission(PERMISSIONS.SMTP_MANAGE), (req: OrgScopedRequest, res) => {
    const orgId = req.currentOrg!.org_id;
    const templates = EMAIL_TEMPLATE_TYPES.map(type => ({
        type,
        ...EMAIL_TEMPLATE_META[type],
        ...emailTemplateModel.getEffective(orgId, type),
    }));
    return sendSuccess(res, 'Email templates fetched', { templates });
});

// GET /api/email-templates/:type - fetch a single template
router.get('/:type', requirePermission(PERMISSIONS.SMTP_MANAGE), (req: OrgScopedRequest, res) => {
    const type = String(req.params.type);
    if (!isValidType(type)) return sendError(res, 'Unknown template type.', null, 400);

    const orgId = req.currentOrg!.org_id;
    return sendSuccess(res, 'Email template fetched', {
        type,
        ...EMAIL_TEMPLATE_META[type],
        ...emailTemplateModel.getEffective(orgId, type),
    });
});

// PUT /api/email-templates/:type - save a custom override
router.put('/:type', requirePermission(PERMISSIONS.SMTP_MANAGE), (req: OrgScopedRequest, res) => {
    const type = String(req.params.type);
    if (!isValidType(type)) return sendError(res, 'Unknown template type.', null, 400);

    const { subject, html } = req.body;
    if (!subject || !html) return sendError(res, 'Subject and HTML content are required.', null, 400);

    const orgId = req.currentOrg!.org_id;
    emailTemplateModel.upsert(orgId, type, subject, html, (req.user as any).userId);
    return sendSuccess(res, 'Email template saved', emailTemplateModel.getEffective(orgId, type));
});

// POST /api/email-templates/:type/revert - discard the custom override
router.post('/:type/revert', requirePermission(PERMISSIONS.SMTP_MANAGE), (req: OrgScopedRequest, res) => {
    const type = String(req.params.type);
    if (!isValidType(type)) return sendError(res, 'Unknown template type.', null, 400);

    const orgId = req.currentOrg!.org_id;
    emailTemplateModel.revert(orgId, type);
    return sendSuccess(res, 'Reverted to default template', emailTemplateModel.getEffective(orgId, type));
});

// POST /api/email-templates/:type/preview - render (unsaved) subject/html with sample data
router.post('/:type/preview', requirePermission(PERMISSIONS.SMTP_MANAGE), (req: OrgScopedRequest, res) => {
    const type = String(req.params.type);
    if (!isValidType(type)) return sendError(res, 'Unknown template type.', null, 400);

    const orgId = req.currentOrg!.org_id;
    const source = (req.body.subject && req.body.html)
        ? { subject: req.body.subject, html: req.body.html }
        : emailTemplateModel.getEffective(orgId, type);

    const vars = { ...SAMPLE_VARS[type], org_name: req.currentOrg?.org_name || SAMPLE_VARS[type].org_name };
    return sendSuccess(res, 'Preview rendered', {
        subject: renderTemplate(source.subject, vars),
        html: renderTemplate(source.html, vars),
    });
});

// POST /api/email-templates/:type/send-test - actually send this template (with sample data) to the current user
router.post('/:type/send-test', requirePermission(PERMISSIONS.SMTP_MANAGE), async (req: OrgScopedRequest, res) => {
    const type = String(req.params.type);
    if (!isValidType(type)) return sendError(res, 'Unknown template type.', null, 400);

    try {
        const orgId = req.currentOrg!.org_id;
        const to = (req.user as any).email;
        const source = (req.body.subject && req.body.html)
            ? { subject: req.body.subject, html: req.body.html }
            : emailTemplateModel.getEffective(orgId, type);
        const vars = { ...SAMPLE_VARS[type], org_name: req.currentOrg?.org_name || SAMPLE_VARS[type].org_name, recipient_email: to };

        await sendMail(orgId, {
            to,
            subject: renderTemplate(source.subject, vars),
            html: renderTemplate(source.html, vars),
        });
        return sendSuccess(res, `Test email sent to ${to}`);
    } catch (err: any) {
        return sendError(res, err.message || 'Failed to send test email', err, 500);
    }
});

export default router;
