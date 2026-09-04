import { flush } from './eventQueue';
import { logError } from './sdk';

let installed = false;

// How long to give the crash report a chance to actually leave the device before moving
// on to the original handler. Bounded so a dead network/server doesn't hang the crash
// handler (and therefore the app's shutdown) indefinitely.
const FATAL_FLUSH_TIMEOUT_MS = 3000;

// Wraps React Native's global error handler so unhandled JS exceptions (outside of
// React's render tree — ErrorBoundary below only catches render errors) get reported
// as fatal crashes. Always chains to the original handler afterward to preserve
// existing behavior (red screen in dev, restart in prod) — this SDK observes, it
// doesn't replace, crash handling.
export function installGlobalCrashHandler() {
    if (installed) return;
    installed = true;

    const anyGlobal = global as any;
    if (!anyGlobal.ErrorUtils) return;

    const originalHandler = anyGlobal.ErrorUtils.getGlobalHandler();
    // Async: for a genuinely fatal error, the original handler can tear down the JS
    // context (the native crash/red-screen) — calling it before the queued network
    // request has any chance to run means the event only ever gets sent on next app
    // open, not now. Awaiting a bounded flush() first gives it a real shot at leaving
    // the device immediately, while still calling the original handler afterward either
    // way (this SDK observes crashes, it doesn't suppress the app's normal crash
    // behavior). RN itself doesn't await this callback's return value, but that's fine —
    // it's this function's own internal ordering that matters here, not RN's.
    anyGlobal.ErrorUtils.setGlobalHandler(async (error: Error, isFatal: boolean) => {
        try {
            logError(error, isFatal);
            if (isFatal) {
                await Promise.race([
                    flush(),
                    new Promise((resolve) => setTimeout(resolve, FATAL_FLUSH_TIMEOUT_MS)),
                ]);
            }
        } catch {
            // Never let reporting itself crash the crash handler.
        }
        originalHandler(error, isFatal);
    });
}
