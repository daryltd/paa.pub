import type { SyncTransport, StateOperation } from '../types.ts';
export declare class WebSocketTransport implements SyncTransport {
    private _url;
    private _protocols;
    private _ws;
    private _handler;
    private _queue;
    private _connected;
    private _intentionalClose;
    private _reconnectDelay;
    private _maxReconnectDelay;
    private _reconnectTimer;
    constructor(url: string, protocols?: string | string[]);
    send(op: StateOperation): void;
    onReceive(handler: (op: StateOperation) => void): void;
    connect(): Promise<void>;
    private _doConnect;
    private _flushQueue;
    private _scheduleReconnect;
    disconnect(): void;
}
