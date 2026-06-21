import type { SyncTransport, StateOperation } from '../types.ts';
export interface SolidTransportOptions {
    fetch?: typeof globalThis.fetch;
    notificationsUrl?: string;
}
export declare class SolidTransport implements SyncTransport {
    private _resourceUrl;
    private _fetch;
    private _notificationsUrl;
    private _eventSource;
    private _handler;
    private _lastKnownState;
    private _pendingWrites;
    private _writeScheduled;
    private _connected;
    constructor(resourceUrl: string, options?: SolidTransportOptions);
    send(op: StateOperation): void;
    onReceive(handler: (op: StateOperation) => void): void;
    connect(): Promise<void>;
    disconnect(): void;
    private _flushWrites;
    private _handleNotification;
    private _discoverNotifications;
}
