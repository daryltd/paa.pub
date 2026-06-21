import type { SyncTransport, StateOperation } from '../types.ts';
export declare class BroadcastChannelTransport implements SyncTransport {
    private _channelName;
    private _channel;
    private _handler;
    constructor(channelName: string);
    send(op: StateOperation): void;
    onReceive(handler: (op: StateOperation) => void): void;
    connect(): Promise<void>;
    disconnect(): void;
}
