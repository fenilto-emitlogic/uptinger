# Mobile App Monitor — Integration Guide

The `mobile` monitor type is a passive monitor: instead of Uptinger polling your app, your
app pushes crash reports, custom events, and session/usage data to Uptinger in batches. It
powers crash analytics, event tracking, and usage/adoption stats (DAU/WAU/MAU, crash-free
rate, version/OS adoption) — no live/real-time tracking, just periodic batched pushes.

This guide is for integrating *any* mobile app. Sections 1-4 cover the raw API — usable from
any platform. If you want a working SDK instead of hand-rolling requests, [`mobile-monitoring/`](../mobile-monitoring)
in this repo ships a full reference implementation (device id, batching queue, crash handler,
session and screen-view tracking) that you can copy into another React Native/Expo app — see §5-6.

## 1. Create a monitor

In the Uptinger dashboard, add a new monitor of type **Mobile App** (under the Passive
category). No hostname or URL is needed. After saving, click **Ingest URL & Token** on the
monitor's detail page (or use the prompt shown right after creation) to get:

- **Ingest URL**: `https://<your-uptinger-host>/api/mobile/<monitor_id>/ingest`
- **Token**: a bearer credential — treat it like a secret. Anyone with it can post events to
  this monitor. Regenerate it any time from `POST /api/monitors/:id/mobile-token/regenerate`
  if it leaks.

## 2. Send a batch

`POST` to the ingest URL with `Authorization: Bearer <token>` and a JSON body:

```json
{
  "device_id": "a stable per-install id you generate once and persist",
  "session_id": "optional, groups events within one app session",
  "app_version": "1.4.0",
  "build_number": "142",
  "os_name": "ios",
  "os_version": "17.4",
  "device_model": "iPhone15,2",
  "events": [
    { "type": "session_start" },
    { "type": "custom", "name": "screen_view", "props": { "screen": "Home" } },
    {
      "type": "crash",
      "name": "TypeError: cannot read property 'x' of undefined",
      "stack_trace": "TypeError: ...\n  at Foo.bar (index.js:42)\n  at ...",
      "fatal": true
    }
  ]
}
```

Event `type` is one of: `crash`, `error`, `custom`, `session_start`, `session_end`.
- `crash`/`error` — `name` becomes the issue title, `stack_trace` groups repeat crashes
  into one issue (crash-free rate and the crash list are derived from these).
- `custom` — `name` is required; `props` is an arbitrary JSON object (event properties).
- `session_start`/`session_end` — mark session boundaries; used for DAU/WAU/MAU, sessions
  count, and crash-free rate (crashes are correlated to the `session_id` they occurred in).

### Minimal curl example

```bash
curl -X POST "https://your-uptinger-host/api/mobile/123/ingest" \
  -H "Authorization: Bearer YOUR_MOBILE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "test-device-1",
    "session_id": "test-session-1",
    "app_version": "1.0.0",
    "os_name": "android",
    "os_version": "14",
    "events": [
      { "type": "session_start" },
      { "type": "custom", "name": "login_success" }
    ]
  }'
```

### Plain JS/fetch example (no framework required)

```js
async function sendUptingerEvents(events) {
  await fetch("https://your-uptinger-host/api/mobile/123/ingest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer YOUR_MOBILE_TOKEN"
    },
    body: JSON.stringify({
      device_id: getOrCreateDeviceId(),
      app_version: "1.0.0",
      events
    })
  });
}
```

### React Native global crash handler (hand-rolled, no SDK)

```js
import { ErrorUtils } from 'react-native';

const originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  sendUptingerEvents([{
    type: 'crash',
    name: error.message,
    stack_trace: error.stack,
    fatal: isFatal
  }]).catch(() => {}); // best-effort — never let reporting crash the crash handler
  originalHandler(error, isFatal);
});
```

## 3. Payload limits

Batches are capped so a misbehaving client can't grow the database unbounded:

| Field | Limit |
|---|---|
| Events per batch | 50 |
| `stack_trace` length | 8,000 characters |
| `props` (JSON, stringified) | 2,000 characters |
| Other string fields (`device_id`, `app_version`, `os_version`, `device_model`, event `name`, etc.) | 256 characters |
| Requests per monitor | 30 per 60 seconds (rate limited by monitor id) |

Oversized batches/fields are truncated, not rejected — except a batch with zero valid events,
which returns `400`. An invalid or missing token returns `401`.

## 4. What you get on the dashboard

The monitor's detail page shows a Mobile Analytics card: DAU/WAU/MAU, crash-free rate,
a crash issues list (grouped/deduplicated by crash signature, with occurrence counts),
top custom events, app version adoption, and OS breakdown — all computed from a 7-day
window by default.

## 5. Reference implementation

[`mobile-monitoring/`](../mobile-monitoring) in this repo is a full example: device id
generation, a disk-persisted batched event queue flushed on app open/close (no wall-clock
timer — see §6), a global crash handler, an error boundary, automatic screen-view tracking
(with a `screenCodes.ts` template for stable per-screen codes), and session tracking. It's
the same code Uptinger's own mobile app runs in production against its own real usage, not
a synthetic snippet — copy it as a starting point rather than hand-rolling the
batching/queueing logic yourself.

It is **not** published as an installable package yet — reuse it by copying files, per §6.

## 6. Using the reference SDK in another mobile app

### Expo / React Native apps

1. Copy the [`mobile-monitoring/`](../mobile-monitoring) folder into the other app's project
   (rename it however you like, e.g. `monitoring/`).
2. Install its peer dependencies: `expo-crypto`, `expo-device`, `expo-application`,
   `expo-secure-store`, `expo-file-system` (persists the event queue to disk so nothing is
   lost between app open/close flushes), `expo-localization` (region/locale/timezone in the
   device context sent with every event). (A bare React Native app without Expo would swap
   these for RN-native equivalents — a device-info library, a Keychain-backed secure store, a
   UUID library, `react-native-fs`, `react-native-localize` — everything else has no Expo
   dependency.)
3. Initialize once, as early as possible (e.g. the app's root layout/entry component):
   ```ts
   import { initMonitoring } from './mobile-monitoring/sdk';
   import { installGlobalCrashHandler } from './mobile-monitoring/globalCrashHandler';

   initMonitoring({ serverUrl: 'https://your-uptinger-host', monitorId: 5, mobileToken: 'the-token' });
   installGlobalCrashHandler();
   ```
4. Wrap the app tree in `<ErrorBoundary>` (from `mobile-monitoring/ErrorBoundary.tsx`) to
   catch render-tree errors as non-fatal reports.
5. Call `startSession()` on cold start / foreground and `endSession()` on background, tied to
   React Native's `AppState`:
   ```ts
   import { AppState } from 'react-native';
   import { startSession, endSession } from './mobile-monitoring/sdk';

   startSession(); // call once at app startup, after initMonitoring()

   AppState.addEventListener('change', (nextState) => {
     if (nextState === 'active') startSession();
     else if (nextState === 'background' || nextState === 'inactive') endSession();
   });
   ```
   These two calls are also what triggers delivery: there is no wall-clock flush timer —
   `startSession()` flushes any leftover queue from before (in case the app was previously
   force-quit rather than backgrounded) and then flushes again after `session_start`;
   `endSession()` flushes on the way out. A fatal crash flushes immediately regardless of
   session state. This makes delivery predictable (data lands when the app opens or closes)
   rather than "sometime in the next N seconds".
6. For automatic screen-view events (rather than only manually-triggered ones), add a hook
   that watches route changes and calls `logEvent('screen_view', { screen })` on each one —
   see `mobile-monitoring/useScreenTracking.ts`, which does this with `usePathname()` from
   expo-router (pair it with `screenCodes.ts` for stable per-screen codes independent of the
   raw path). A non-Expo-Router app would wire the equivalent from its own navigation
   library's "current route" listener (e.g. React Navigation's `onStateChange`).
7. Anywhere else in the app: `logEvent(name, props?)` for custom events, `logError(error, fatal?)`
   for manually-caught errors.

### Any other platform (native iOS/Android, Flutter, etc.)

Skip the SDK entirely and integrate against the plain REST API described in §1-3 above —
generate/persist a device id, POST a batch on your own schedule, done. No Expo or React
Native dependency required.

**v1 limitations to be aware of:** no live/real-time tracking (data lands on the next app
open/close, not on a timer — see §6 above), no stack trace symbolication (minified/obfuscated
traces are stored as-is), no crash-spike alerting yet. The reference client-side queue persists
to disk on every event (not in-memory only), so a force-quit doesn't lose data — whatever
hadn't been flushed yet is picked up and sent on the next app open instead.
