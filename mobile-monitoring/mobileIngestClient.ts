import axios from 'axios';
import { getDeviceContext, getOrCreateDeviceId } from './deviceContext';

export interface MonitoringConfig {
    serverUrl: string;
    monitorId: number;
    mobileToken: string;
}

export type MobileEventType = 'crash' | 'error' | 'custom' | 'session_start' | 'session_end';

export interface QueuedEvent {
    type: MobileEventType;
    name?: string;
    props?: Record<string, any>;
    stack_trace?: string;
    fatal?: boolean;
    client_timestamp?: string;
}

// Deliberately NOT your app's own authenticated API client, if it has one — ingest is
// monitor-scoped via a separate bearer credential (the mobile_token from the dashboard's
// "Ingest URL & Token" button), not user session auth. See ../docs/mobile-monitor-integration.md
// for the wire format this posts.
export async function pushEventBatch(config: MonitoringConfig, sessionId: string | undefined, events: QueuedEvent[]): Promise<void> {
    if (events.length === 0) return;

    const deviceId = await getOrCreateDeviceId();
    const device = getDeviceContext();

    await axios.post(
        `${config.serverUrl.replace(/\/$/, '')}/api/mobile/${config.monitorId}/ingest`,
        {
            device_id: deviceId,
            session_id: sessionId,
            ...device,
            events
        },
        {
            headers: { Authorization: `Bearer ${config.mobileToken}` },
            timeout: 10000
        }
    );
}
