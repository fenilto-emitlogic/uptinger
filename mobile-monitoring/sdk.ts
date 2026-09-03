import * as Crypto from 'expo-crypto';
import { MonitoringConfig } from './mobileIngestClient';
import { configureQueue, enqueue, flush, setSessionId } from './eventQueue';

let currentSessionId: string | undefined;
let initialized = false;

export function initMonitoring(cfg: MonitoringConfig) {
    configureQueue(cfg);
    initialized = true;
}

export function isMonitoringConfigured(): boolean {
    return initialized;
}

export function startSession() {
    // Push anything still queued from before this session starts — covers the case
    // where the app was force-quit rather than gracefully backgrounded, so endSession()
    // never got to flush it. Uses whatever session context was still active at that
    // point, so those leftover events aren't mislabeled under the new session below.
    void flush();

    currentSessionId = Crypto.randomUUID();
    setSessionId(currentSessionId);
    enqueue({ type: 'session_start' });
    void flush(); // app just opened — push immediately rather than waiting for a timer
}

export function endSession() {
    if (!currentSessionId) return;
    enqueue({ type: 'session_end' });
    void flush(); // app is backgrounding/closing — push immediately, this may be the last chance
    currentSessionId = undefined;
    setSessionId(undefined);
}

export function logEvent(name: string, props?: Record<string, any>) {
    enqueue({ type: 'custom', name, props });
}

export function logError(error: Error, fatal = false) {
    enqueue({
        type: fatal ? 'crash' : 'error',
        name: error.message || error.name || 'Unknown error',
        stack_trace: error.stack,
        fatal
    });
}
