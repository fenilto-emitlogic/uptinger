// Central definition of all transactional email templates. Each type has a default
// subject/body that orgs can override (stored in tbl_email_templates); reverting
// just deletes the override row so the default here takes effect again.

export type EmailTemplateType = 'test' | 'down' | 'recovery' | 'paused' | 'forgot_password' | 'invite';

export const EMAIL_TEMPLATE_TYPES: EmailTemplateType[] = ['test', 'down', 'recovery', 'paused', 'forgot_password', 'invite'];

export const EMAIL_TEMPLATE_META: Record<EmailTemplateType, { label: string; description: string; vars: string[] }> = {
    test: {
        label: 'Test Email',
        description: 'Sent from Mail/SMTP Settings to verify your configuration works.',
        vars: ['org_name', 'recipient_email'],
    },
    down: {
        label: 'Monitor Down',
        description: 'Sent when a monitor goes offline.',
        vars: ['monitor_name', 'org_name', 'status_message', 'action_url'],
    },
    recovery: {
        label: 'Monitor Recovered',
        description: 'Sent when a monitor that was down comes back online.',
        vars: ['monitor_name', 'org_name', 'action_url'],
    },
    paused: {
        label: 'Monitor Paused',
        description: 'Sent when a monitor is manually paused.',
        vars: ['monitor_name', 'org_name', 'actor_email', 'action_url'],
    },
    forgot_password: {
        label: 'Forgot Password',
        description: 'Sent when a user requests a password reset link.',
        vars: ['user_name', 'org_name', 'action_url', 'expires_in'],
    },
    invite: {
        label: 'Invite',
        description: 'Sent when a new user is invited to join the organization.',
        vars: ['user_name', 'org_name', 'inviter_email', 'action_url', 'expires_in'],
    },
};

export const APP_NAME = 'Uptinger';

export function getAppUrl(): string {
    return (process.env.APP_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
}

function escapeHtml(value: string): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Substitutes {{key}} placeholders with escaped values; unknown keys are left as-is.
export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
        if (!(key in vars) || vars[key] === undefined) return match;
        return escapeHtml(String(vars[key]));
    });
}

// Wraps a template's inner body HTML in the shared branded layout (logo header, card, footer).
export function wrapEmailLayout(bodyHtml: string, orgName?: string): string {
    const logoUrl = `${getAppUrl()}/logo.png`;
    const year = new Date().getFullYear();
    return `<!doctype html>
<html style="height:100%;">
<head><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"></head>
<body style="margin:0;padding:0;height:100%;min-height:100%;background:#0b0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" style="background:#0b0f14;padding:32px 16px;height:100%;min-height:100vh;">
    <tr>
      <td align="center" valign="middle">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#141b23;border-radius:16px;overflow:hidden;border:1px solid #232e3a;">
          <tr>
            <td style="padding:28px 32px;border-bottom:1px solid #232e3a;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:10px;">
                    <img src="${logoUrl}" width="36" height="36" alt="${APP_NAME}" style="border-radius:10px;display:block;">
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:18px;font-weight:800;color:#f5f7fa;letter-spacing:-0.02em;">${APP_NAME}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#cbd5e1;font-size:14px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #232e3a;color:#64748b;font-size:12px;">
              ${orgName ? `${escapeHtml(orgName)} &middot; ` : ''}Sent by ${APP_NAME} &middot; &copy; ${year}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(label: string, url: string, color = '#3b82f6'): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr><td style="border-radius:10px;background:${color};">
        <a href="${url}" style="display:inline-block;padding:12px 22px;color:#0b0f14;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px;">${label}</a>
      </td></tr>
    </table>`;
}

export interface IFEmailTemplateDefault {
    subject: string;
    html: string; // full layout-wrapped default, generated lazily via a body builder below
}

// Default body builders (inner HTML only — wrapEmailLayout() adds the header/footer chrome).
// Kept as functions so the "revert to default" preview always includes a live sample of
// the shared layout without needing to store the wrapped HTML redundantly.
const DEFAULT_BODIES: Record<EmailTemplateType, { subject: string; body: string }> = {
    test: {
        subject: 'Uptinger SMTP test email',
        body: `<h2 style="margin:0 0 12px;color:#f5f7fa;font-size:18px;">SMTP configuration works ✅</h2>
<p style="margin:0 0 8px;">This is a test email from your <strong>{{org_name}}</strong> organization settings.</p>
<p style="margin:0;">If you received this at <strong>{{recipient_email}}</strong>, your SMTP configuration is working correctly.</p>`,
    },
    down: {
        subject: '🔴 {{monitor_name}} is DOWN',
        body: `<h2 style="margin:0 0 12px;color:#f87171;font-size:18px;">${'{{monitor_name}}'} is down</h2>
<p style="margin:0 0 8px;"><strong>{{monitor_name}}</strong> went down for <strong>{{org_name}}</strong>.</p>
<p style="margin:0 0 8px;color:#94a3b8;">${'{{status_message}}'}</p>
${button('View Monitor', '{{action_url}}', '#f87171')}`,
    },
    recovery: {
        subject: '✅ {{monitor_name}} has RECOVERED',
        body: `<h2 style="margin:0 0 12px;color:#4ade80;font-size:18px;">${'{{monitor_name}}'} is back online</h2>
<p style="margin:0 0 8px;"><strong>{{monitor_name}}</strong> has recovered and is back online for <strong>{{org_name}}</strong>.</p>
${button('View Monitor', '{{action_url}}', '#4ade80')}`,
    },
    paused: {
        subject: '⏸️ {{monitor_name}} was paused',
        body: `<h2 style="margin:0 0 12px;color:#facc15;font-size:18px;">${'{{monitor_name}}'} paused</h2>
<p style="margin:0 0 8px;"><strong>{{monitor_name}}</strong> was manually paused by <strong>{{actor_email}}</strong>.</p>
${button('View Monitor', '{{action_url}}', '#facc15')}`,
    },
    forgot_password: {
        subject: 'Reset your {{org_name}} password',
        body: `<h2 style="margin:0 0 12px;color:#f5f7fa;font-size:18px;">Reset your password</h2>
<p style="margin:0 0 8px;">Hi {{user_name}}, we received a request to reset your password for <strong>{{org_name}}</strong>.</p>
${button('Reset Password', '{{action_url}}')}
<p style="margin:12px 0 0;color:#64748b;font-size:12px;">This link expires in {{expires_in}}. If you didn't request this, you can safely ignore this email.</p>`,
    },
    invite: {
        subject: `You've been invited to join {{org_name}} on ${APP_NAME}`,
        body: `<h2 style="margin:0 0 12px;color:#f5f7fa;font-size:18px;">You're invited 🎉</h2>
<p style="margin:0 0 8px;">Hi {{user_name}}, <strong>{{inviter_email}}</strong> invited you to join <strong>{{org_name}}</strong> on ${APP_NAME}.</p>
${button('Set Up Your Account', '{{action_url}}')}
<p style="margin:12px 0 0;color:#64748b;font-size:12px;">This link expires in {{expires_in}}.</p>`,
    },
};

export function getDefaultTemplate(type: EmailTemplateType): { subject: string; html: string } {
    const def = DEFAULT_BODIES[type];
    return { subject: def.subject, html: wrapEmailLayout(def.body) };
}

export const SAMPLE_VARS: Record<EmailTemplateType, Record<string, string>> = {
    test: { org_name: 'Acme Inc', recipient_email: 'you@example.com' },
    down: { monitor_name: 'api.example.com', org_name: 'Acme Inc', status_message: 'Connection timed out after 3 retries.', action_url: `${getAppUrl()}/dashboard` },
    recovery: { monitor_name: 'api.example.com', org_name: 'Acme Inc', action_url: `${getAppUrl()}/dashboard` },
    paused: { monitor_name: 'api.example.com', org_name: 'Acme Inc', actor_email: 'admin@example.com', action_url: `${getAppUrl()}/dashboard` },
    forgot_password: { user_name: 'Jamie', org_name: 'Acme Inc', action_url: `${getAppUrl()}/auth/reset-password?token=sample`, expires_in: '1 hour' },
    invite: { user_name: 'Jamie', org_name: 'Acme Inc', inviter_email: 'admin@example.com', action_url: `${getAppUrl()}/auth/reset-password?token=sample`, expires_in: '24 hours' },
};
