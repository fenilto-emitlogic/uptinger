// Maps route pathnames to a stable, unique screen code for analytics events.
// Codes are independent of file/route names so renaming a route doesn't change
// historical event data — update this map when adding or renaming a screen.
//
// EXAMPLE CONTENT: the entries below are Uptinger's own mobile app's routes, included so
// this file works out of the box as a template — replace SCREEN_CODES (and
// DYNAMIC_SCREEN_CODES below) with your own app's routes/screen names.
const SCREEN_CODES: Record<string, string> = {
    '/home': 'home',
    '/dashboard': 'dashboard',
    '/profile': 'profile',
};

const DYNAMIC_SCREEN_CODES: Array<{ pattern: RegExp; code: string }> = [
    { pattern: /^\/item\/[^/]+$/, code: 'item_detail' },
];

// Returns the unique code for a given pathname, falling back to the pathname
// itself so unmapped/new screens still produce a distinct, non-empty code.
export function getScreenCode(pathname: string): string {
    if (SCREEN_CODES[pathname]) return SCREEN_CODES[pathname];

    const dynamicMatch = DYNAMIC_SCREEN_CODES.find(({ pattern }) => pattern.test(pathname));
    if (dynamicMatch) return dynamicMatch.code;

    return pathname;
}
