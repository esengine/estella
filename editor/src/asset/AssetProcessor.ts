import type { AssetNode } from './AssetNode';
import type { NativeFS } from '../types/NativeFS';

export interface AssetProcessor<T = unknown> {
    readonly type: string;
    readonly extensions: string[];
    process(node: AssetNode<T>, projectDir: string, fs: NativeFS): Promise<T>;
    release?(data: T): void;
}
