import type { Entity } from 'esengine';
import type { ImageResolver, ResolvedImage } from 'esengine';
import type { AssetGraph } from './AssetGraph';
import type { AssetHandle } from './AssetNode';

export class GraphImageResolver implements ImageResolver {
    readonly pendingEntities = new Set<Entity>();
    private graph_: AssetGraph;
    private entityHandles_ = new Map<Entity, Array<{ src: string; unsub: () => void }>>();

    constructor(graph: AssetGraph) {
        this.graph_ = graph;
    }

    resolve(src: string): ResolvedImage | null {
        const path = this.srcToPath_(src);
        const handle = this.graph_.getHandle<HTMLImageElement>(path);
        if (handle.status === 'loaded' && handle.data) return handle.data;
        return null;
    }

    trackEntity(entity: Entity, srcs: string[]): void {
        this.untrackEntity(entity);
        const handles: Array<{ src: string; unsub: () => void }> = [];
        for (const src of srcs) {
            const path = this.srcToPath_(src);
            const handle = this.graph_.getHandle<HTMLImageElement>(path);
            const unsub = handle.onChange(() => {
                this.pendingEntities.add(entity);
            });
            handles.push({ src, unsub });
        }
        this.entityHandles_.set(entity, handles);
    }

    untrackEntity(entity: Entity): void {
        const existing = this.entityHandles_.get(entity);
        if (existing) {
            for (const h of existing) h.unsub();
            this.entityHandles_.delete(entity);
        }
    }

    private srcToPath_(src: string): string {
        if (src.includes('/') || src.includes('.')) return src;
        return `assets/textures/${src}.png`;
    }
}
