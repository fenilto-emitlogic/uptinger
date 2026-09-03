import { logError } from './sdk';

let installed = false;

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
    anyGlobal.ErrorUtils.setGlobalHandler((error: Error, isFatal: boolean) => {
        try {
            logError(error, isFatal);
        } catch {
            // Never let reporting itself crash the crash handler.
        }
        originalHandler(error, isFatal);
    });
}
