import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { logError } from './sdk';

interface Props {
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
}

// Catches render-tree errors React's own error boundaries are designed for — these
// are typically recoverable (a bad prop, a null-check miss), unlike the unhandled JS
// exceptions globalCrashHandler reports, so they're logged as non-fatal.
export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        try {
            logError(error, false);
        } catch {
            // Never let reporting itself crash the boundary.
        }
    }

    handleRetry = () => this.setState({ hasError: false });

    render() {
        if (this.state.hasError) {
            return (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>Something went wrong</Text>
                    <Text style={{ fontSize: 13, color: '#666', marginBottom: 16, textAlign: 'center' }}>
                        The error has been reported. You can try again.
                    </Text>
                    <TouchableOpacity onPress={this.handleRetry} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#111', borderRadius: 10 }}>
                        <Text style={{ color: '#fff', fontWeight: '700' }}>Try Again</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        return this.props.children;
    }
}
