import crypto from 'crypto';

// Secret credentials (DB monitor passwords, SMTP passwords, connection strings) are
// encrypted at rest with AES-256-GCM and decrypted only in-memory when a check runs.
if (!process.env.ENCRYPTION_KEY) {
    console.error('[security] ENCRYPTION_KEY is not set. Set it in your environment before starting the server.');
    process.exit(1);
}
const RAW_KEY = process.env.ENCRYPTION_KEY;

// scrypt derives a fixed 32-byte key regardless of the raw secret's length/format.
const KEY = crypto.scryptSync(RAW_KEY, 'pinger-credentials', 32);

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';
const IV_LENGTH = 12; // 96-bit IV is the recommended size for GCM

// Encrypts plaintext to `enc:v1:<iv>:<authTag>:<ciphertext>` (all hex). Empty/undefined
// values pass through unchanged so optional fields don't get wrapped for nothing.
export function encrypt(plaintext: string | null | undefined): string {
    if (!plaintext) return plaintext || '';

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGO, KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

// Decrypts a value produced by encrypt(). Values without the enc:v1: prefix are
// returned as-is — this covers plaintext credentials saved before encryption was
// introduced, so old data keeps working until it's next saved (and re-encrypted).
export function decrypt(value: string | null | undefined): string {
    if (!value) return value || '';
    if (!value.startsWith(PREFIX)) return value;

    try {
        const [ivHex, authTagHex, ciphertextHex] = value.slice(PREFIX.length).split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const ciphertext = Buffer.from(ciphertextHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return plaintext.toString('utf8');
    } catch {
        return '';
    }
}

export function isEncrypted(value: string | null | undefined): boolean {
    return !!value && value.startsWith(PREFIX);
}

// Masked placeholder shown to the frontend in place of the real secret, so edit forms
// never round-trip plaintext credentials back to the browser.
export const MASKED_SECRET = '••••••••';
