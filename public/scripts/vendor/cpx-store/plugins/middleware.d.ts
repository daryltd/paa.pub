import type { StorePlugin, MiddlewareEntry } from '../types.ts';
export declare function middlewarePlugin(entries: (MiddlewareEntry | MiddlewareEntry['fn'])[]): StorePlugin;
