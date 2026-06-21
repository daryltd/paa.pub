import type { StorePlugin } from '../types.ts';
export interface PersistenceOptions {
    key?: string;
}
export declare function persistencePlugin(options?: PersistenceOptions): StorePlugin;
