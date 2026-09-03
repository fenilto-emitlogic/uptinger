import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { getScreenCode } from './screenCodes';
import { logEvent } from './sdk';

// Reports a 'screen_view' custom event on every real navigation, once monitoring is
// configured. Uses expo-router's usePathname() — an app on a different navigation
// library (e.g. React Navigation) would wire the equivalent from its own "current
// route" listener (e.g. onStateChange) and call logEvent the same way.
export function useScreenTracking(enabled: boolean) {
    const pathname = usePathname();
    const lastPathname = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled) return;
        if (pathname === lastPathname.current) return;
        lastPathname.current = pathname;
        logEvent('screen_view', { screen: pathname, screen_code: getScreenCode(pathname) });
    }, [enabled, pathname]);
}
