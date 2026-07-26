import nodemailer from 'nodemailer';
import { smtpModel } from '../models/smtp.model.js';

export async function sendMail(orgId: number, opts: { to: string | string[]; subject: string; html: string }): Promise<void> {
    const settings = smtpModel.findByOrg(orgId);
    if (!settings || !settings.is_active || !settings.host || !settings.from_email) {
        throw new Error('SMTP is not configured for this organization.');
    }

    const transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port || 587,
        secure: settings.encryption === 'ssl',
        requireTLS: settings.encryption === 'starttls',
        auth: settings.username ? { user: settings.username, pass: settings.password || '' } : undefined,
    });

    await transporter.sendMail({
        from: settings.from_name ? `"${settings.from_name}" <${settings.from_email}>` : settings.from_email,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
    });
}
