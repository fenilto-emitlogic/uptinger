import { File, Paths } from 'expo-file-system';
import { MonitoringConfig, pushEventBatch, QueuedEvent } from './mobileIngestClient';

const MAX_QUEUE_SIZE = 200; // drop oldest beyond this so a runaway event source can't leak memory

// Persisted alongside the in-memory queue so events survive a JS reload or a
// background flush that got killed mid-flight — without this, either would silently
// drop whatever hadn't reached the server yet. This is what lets flush() stay tied to
// app open/close (see sdk.ts's startSession/endSession) rather than firing a network
// request per screen view/event: a screen view sits safely on disk the moment it's
// logged, and only actually goes over the network at the next session boundary — no
// per-navigation network/battery cost.
const QUEUE_FILE = new File(Paths.document, 'uptinger-monitoring-queue.json');

let queue: QueuedEvent[] = [];
let config: MonitoringConfig | null = null;
let sessionId: string | undefined;

function persistQueue() {
    try {
        QUEUE_FILE.write(JSON.stringify(queue));
    } catch (err) {
        if (__DEV__) console.warn('[uptinger-monitoring] failed to persist queue:', err);
    }
}

// File.write() is synchronous and blocks the JS thread — calling persistQueue() on
// every single enqueue() (e.g. a screen_view on every navigation) means re-serializing
// and re-writing the whole growing queue on every screen transition, which gets
// noticeably slower as the queue approaches MAX_QUEUE_SIZE over a long session and can
// stall the JS thread badly enough to look like a freeze/crash. Debounce it instead:
// the in-memory queue is always current, so a short delay before the write actually
// hits disk costs nothing except a slightly larger loss window on a hard kill (already
// true of any interval-based persistence), while collapsing bursts of rapid enqueues
// (fast navigation, custom events) into a single write.
const PERSIST_DEBOUNCE_MS = 1000;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        persistQueue();
    }, PERSIST_DEBOUNCE_MS);
}

function loadPersistedQueue(): QueuedEvent[] {
    try {
        if (!QUEUE_FILE.exists) return [];
        const parsed = JSON.parse(QUEUE_FILE.textSync());
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        if (__DEV__) console.warn('[uptinger-monitoring] failed to load persisted queue:', err);
        return [];
    }
}

export function configureQueue(cfg: MonitoringConfig) {
    config = cfg;
    // Anything left on disk from a previous run (killed before it could flush) goes to
    // the front of the queue so it's sent ahead of whatever happens in this session.
    const persisted = loadPersistedQueue();
    if (persisted.length > 0) {
        queue = [...persisted, ...queue];
        if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
        persistQueue();
    }
    if (__DEV__) console.log('[uptinger-monitoring] configured', { serverUrl: cfg.serverUrl, monitorId: cfg.monitorId, restoredEvents: persisted.length });
}

export function setSessionId(id: string | undefined) {
    sessionId = id;
}

export function enqueue(event: QueuedEvent) {
    queue.push(event);
    if (queue.length > MAX_QUEUE_SIZE) {
        queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
    }
    // Fatal crashes get a synchronous, immediate persist + best-effort flush — the app
    // may not survive long enough for a debounced write, let alone the next
    // session-boundary flush (app open/close). Everything else (screen views, custom
    // events) is far higher-volume (one per navigation) and can tolerate sitting in
    // memory for a moment before the debounced write lands — see schedulePersist().
    if (event.type === 'crash') {
        persistQueue();
        void flush();
    } else {
        schedulePersist();
    }
}

export async function flush(): Promise<void> {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
        // A debounced write may still be pending for events enqueued in the last
        // PERSIST_DEBOUNCE_MS — write them now (a single, infrequent flush-time write,
        // not one per enqueue) so the on-disk copy is guaranteed current before the
        // network request below, same durability guarantee as the old synchronous-every-
        // enqueue behavior.
        persistQueue();
    }
    if (!config) {
        if (__DEV__ && queue.length > 0) console.warn('[uptinger-monitoring] flush skipped: not configured yet, events queued:', queue.length);
        return;
    }
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    // Deliberately not persisting the now-empty in-memory queue yet — the on-disk copy
    // still holds `batch` until the request actually succeeds below. If the app is
    // killed mid-request (the common case for a background flush), the persisted batch
    // is still there to retry on next launch instead of being lost.
    try {
        await pushEventBatch(config, sessionId, batch);
        persistQueue();
        if (__DEV__) console.log('[uptinger-monitoring] flushed', batch.length, 'event(s) to', config.serverUrl);
    } catch (err: any) {
        // Best-effort delivery: put the batch back at the front of the queue (and
        // re-persist it) so it's retried on the next flush trigger instead of being
        // dropped on a flaky connection or transient server error.
        queue = [...batch, ...queue];
        if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
        persistQueue();
        if (__DEV__) console.warn('[uptinger-monitoring] flush failed:', err?.response?.status, err?.response?.data ?? err?.message ?? err);
    }
}
