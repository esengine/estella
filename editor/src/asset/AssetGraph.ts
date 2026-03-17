import { AssetNode, type AssetHandle } from './AssetNode';
import type { AssetProcessor } from './AssetProcessor';
import type { NativeFS } from '../types/NativeFS';
import { normalizePath, getFileExtension, isTransientFile } from '../utils/path';

export type AssetGraphEventKind = 'create' | 'modify' | 'delete' | 'rename';

export interface AssetGraphEvent {
    kind: AssetGraphEventKind;
    path: string;
    oldPath?: string;
}

type GraphListener = (events: AssetGraphEvent[]) => void;

export class AssetGraph {
    private nodes_ = new Map<string, AssetNode>();
    private processors_ = new Map<string, AssetProcessor>();
    private extToProcessor_ = new Map<string, AssetProcessor>();
    private fs_: NativeFS | null = null;
    private projectDir_ = '';
    private unwatchFn_: (() => void) | null = null;
    private listeners_ = new Set<GraphListener>();
    private pendingProcess_ = new Set<AssetNode>();
    private processScheduled_ = false;

    getHandle<T = unknown>(path: string): AssetHandle<T> {
        const node = this.getOrCreateNode_<T>(path);
        if (node.status === 'unloaded' && this.fs_ && this.hasProcessor_(path)) {
            this.scheduleProcess_(node);
        }
        return node;
    }

    getNode<T = unknown>(path: string): AssetNode<T> | undefined {
        return this.nodes_.get(path) as AssetNode<T> | undefined;
    }

    registerProcessor(processor: AssetProcessor): void {
        this.processors_.set(processor.type, processor);
        for (const ext of processor.extensions) {
            const key = ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase();
            this.extToProcessor_.set(key, processor);
        }
    }

    onChange(listener: GraphListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    addDependency(from: AssetNode, to: AssetNode): void {
        from.dependencies.add(to);
        to.dependents.add(from);
    }

    removeDependency(from: AssetNode, to: AssetNode): void {
        from.dependencies.delete(to);
        to.dependents.delete(from);
    }

    async startWatching(projectDir: string, fs: NativeFS): Promise<void> {
        this.stopWatching();
        this.projectDir_ = projectDir;
        this.fs_ = fs;

        const assetsDir = `${projectDir}/assets`;
        const exists = await fs.exists(assetsDir);
        if (!exists) return;

        this.unwatchFn_ = await fs.watchDirectory(
            assetsDir,
            (event) => this.handleFsEvent_(event),
            { recursive: true },
        );
    }

    stopWatching(): void {
        if (this.unwatchFn_) {
            this.unwatchFn_();
            this.unwatchFn_ = null;
        }
    }

    onFileCreated(path: string): void {
        if (this.shouldIgnore_(path)) return;
        const node = this.getOrCreateNode_(path);
        this.scheduleProcess_(node);
        this.emitEvents_([{ kind: 'create', path }]);
    }

    onFileModified(path: string): void {
        if (this.shouldIgnore_(path)) return;
        const node = this.nodes_.get(path);
        if (node) {
            this.releaseNodeData_(node);
            node.invalidate();
            this.scheduleProcess_(node);
        }
        this.emitEvents_([{ kind: 'modify', path }]);
    }

    onFileDeleted(path: string): void {
        if (this.shouldIgnore_(path)) return;
        const node = this.nodes_.get(path);
        if (node) {
            this.releaseNodeData_(node);
            node.invalidate();
        }
        this.emitEvents_([{ kind: 'delete', path }]);
    }

    onFileRenamed(oldPath: string, newPath: string): void {
        if (this.shouldIgnore_(oldPath) && this.shouldIgnore_(newPath)) return;
        const node = this.nodes_.get(oldPath);
        if (node) {
            this.nodes_.delete(oldPath);
            node.path = newPath;
            this.nodes_.set(newPath, node);
            node.version++;
        }
        this.emitEvents_([{ kind: 'rename', path: newPath, oldPath }]);
    }

    releaseAll(): void {
        for (const node of this.nodes_.values()) {
            this.releaseNodeData_(node);
        }
        this.nodes_.clear();
    }

    private getOrCreateNode_<T>(path: string): AssetNode<T> {
        let node = this.nodes_.get(path);
        if (!node) {
            node = new AssetNode(path);
            this.nodes_.set(path, node);
        }
        return node as AssetNode<T>;
    }

    private shouldIgnore_(path: string): boolean {
        return path.endsWith('.meta') || isTransientFile(path);
    }

    private hasProcessor_(path: string): boolean {
        return this.extToProcessor_.has(getFileExtension(path));
    }

    private handleFsEvent_(event: { type: string; paths: string[] }): void {
        for (const absPath of event.paths) {
            const normalized = normalizePath(absPath);
            const relPath = this.toRelativePath_(normalized);
            if (!relPath || this.shouldIgnore_(relPath)) continue;

            switch (event.type) {
                case 'create':
                    this.onFileCreated(relPath);
                    break;
                case 'modify':
                    this.onFileModified(relPath);
                    break;
                case 'remove':
                    this.onFileDeleted(relPath);
                    break;
                default:
                    if (this.nodes_.has(relPath)) {
                        this.onFileModified(relPath);
                    } else {
                        this.onFileCreated(relPath);
                    }
                    break;
            }
        }
    }

    private toRelativePath_(absPath: string): string | null {
        const prefix = normalizePath(this.projectDir_) + '/';
        if (absPath.startsWith(prefix)) return absPath.slice(prefix.length);
        return null;
    }

    private scheduleProcess_(node: AssetNode): void {
        this.pendingProcess_.add(node);
        if (this.processScheduled_) return;
        this.processScheduled_ = true;
        queueMicrotask(() => this.flushProcess_());
    }

    private async flushProcess_(): Promise<void> {
        this.processScheduled_ = false;
        const batch = [...this.pendingProcess_];
        this.pendingProcess_.clear();

        const tasks = batch.map(async (node) => {
            const ext = getFileExtension(node.path);
            const processor = this.extToProcessor_.get(ext);
            if (!processor || !this.fs_) return;

            node.markLoading();
            try {
                const data = await processor.process(node, this.projectDir_, this.fs_);
                node.markLoaded(data);
            } catch {
                node.markFailed();
            }
        });
        await Promise.allSettled(tasks);
    }

    private releaseNodeData_(node: AssetNode): void {
        if (node.data == null) return;
        const ext = getFileExtension(node.path);
        const processor = this.extToProcessor_.get(ext);
        if (processor?.release) {
            processor.release(node.data);
        }
    }

    private emitEvents_(events: AssetGraphEvent[]): void {
        for (const listener of this.listeners_) {
            listener(events);
        }
    }
}
