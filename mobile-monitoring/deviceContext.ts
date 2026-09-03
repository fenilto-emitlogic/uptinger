import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const DEVICE_ID_KEY = 'uptinger_mobile_device_id';

let cachedDeviceId: string | null = null;

// A stable per-install id, generated once and persisted — this is what the server
// uses to compute DAU/WAU/MAU (COUNT DISTINCT device_id), so it must survive app
// restarts but doesn't need to survive a reinstall (SecureStore data is cleared then,
// which is the correct behavior: a reinstall is a "new" install for adoption stats).
export async function getOrCreateDeviceId(): Promise<string> {
    if (cachedDeviceId) return cachedDeviceId;

    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (existing) {
        cachedDeviceId = existing;
        return existing;
    }

    const id = Crypto.randomUUID();
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    cachedDeviceId = id;
    return id;
}

export interface DeviceContext {
    app_version?: string;
    build_number?: string;
    os_name?: string;
    os_version?: string;
    device_model?: string;
    region?: string;
    locale?: string;
    timezone?: string;
}

export function getDeviceContext(): DeviceContext {
    // getLocales()/getCalendars() return the device's ranked list of locales/calendars —
    // only the first (the user's active preference) is relevant here, same as how a
    // single os_version/device_model is reported rather than every possibility.
    const [primaryLocale] = Localization.getLocales();
    const [primaryCalendar] = Localization.getCalendars();

    return {
        app_version: Application.nativeApplicationVersion ?? undefined,
        build_number: Application.nativeBuildVersion ?? undefined,
        os_name: Platform.OS,
        os_version: Device.osVersion ?? undefined,
        device_model: Device.modelName ?? undefined,
        region: primaryLocale?.regionCode ?? undefined,
        locale: primaryLocale?.languageTag ?? undefined,
        timezone: primaryCalendar?.timeZone ?? undefined
    };
}
