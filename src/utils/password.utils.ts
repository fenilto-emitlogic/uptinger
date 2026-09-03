import bcrypt from 'bcrypt';
import crypto from 'crypto';

const SALT_ROUNDS = 10; // Standard cost factor

// Generates a random, human-typeable temporary password (e.g. for invites and admin resets).
// Avoids visually ambiguous characters (0/O, 1/l/I) so it's easy to read off a screen.
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
export function generateTempPassword(length = 12): string {
    let out = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        out += TEMP_PASSWORD_CHARS[bytes[i] % TEMP_PASSWORD_CHARS.length];
    }
    return out;
}

// Hash password before saving to DB
export async function hashPassword(plainPassword: string): Promise<string> {
    return await bcrypt.hash(plainPassword, SALT_ROUNDS);
}

// Verify password during login
export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hashedPassword);
}