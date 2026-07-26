import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10; // Standard cost factor

// Hash password before saving to DB
export async function hashPassword(plainPassword: string): Promise<string> {
    return await bcrypt.hash(plainPassword, SALT_ROUNDS);
}

// Verify password during login
export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hashedPassword);
}