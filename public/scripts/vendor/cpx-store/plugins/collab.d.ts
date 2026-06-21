import type { StorePlugin, SyncTransport, StateOperation } from '../types.ts';
export interface ConflictResolver {
    resolve(local: StateOperation, remote: StateOperation): StateOperation;
}
export interface CollabOptions {
    transport: SyncTransport;
    clientId?: string;
    resolver?: ConflictResolver;
}
export declare function collabPlugin(options: CollabOptions): StorePlugin;
