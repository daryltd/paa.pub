export interface PatchOp {
    op: 'add' | 'remove' | 'replace';
    path: string;
    value?: unknown;
}
export declare function diffObjects(oldObj: Record<string, unknown>, newObj: Record<string, unknown>): PatchOp[];
export declare function applyPatch(obj: Record<string, unknown>, ops: PatchOp[]): Record<string, unknown>;
export declare function reversePatch(oldObj: Record<string, unknown>, ops: PatchOp[]): PatchOp[];
