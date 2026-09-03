# Uptinger Mobile Monitoring SDK

Reference implementation for reporting crash/event/session data to an Uptinger `mobile`
type monitor from a React Native / Expo app: device id generation, a disk-persisted
batched event queue flushed on app open/close, a global crash handler, an error boundary,
and automatic screen-view tracking.

Not published as an installable package — copy this folder into your app's project as-is
(or renamed, e.g. `monitoring/`) and wire it in.

See [`../docs/mobile-monitor-integration.md`](../docs/mobile-monitor-integration.md) for
the full integration guide, including the raw REST API (for non-Expo/non-RN apps) and
step-by-step setup for this SDK.
