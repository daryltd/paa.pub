import type { StorePlugin, HistoryStrategy } from '../types.ts';
export interface HistoryOptions {
    maxHistory?: number;
    defaultStrategy?: HistoryStrategy;
    strategies?: Record<string, HistoryStrategy>;
    checkpointInterval?: number;
}
export declare function historyPlugin(options?: HistoryOptions): StorePlugin;
