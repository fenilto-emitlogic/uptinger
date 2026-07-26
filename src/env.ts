import dotenv from 'dotenv';

// Must be the first import in server.ts — other modules (crypto.utils, jwt.utils)
// read process.env at import time, before their own module body runs, so dotenv
// has to be configured before those imports are evaluated, not just before main() runs.
dotenv.config();
