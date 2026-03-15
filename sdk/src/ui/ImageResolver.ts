import type { Entity } from '../types';

export type ResolvedImage = ImageBitmap | HTMLImageElement;

export interface ImageResolver {
    resolve(src: string): ResolvedImage | null;
    readonly pendingEntities: Set<Entity>;
}

let globalResolver: ImageResolver | null = null;

export function setImageResolver(resolver: ImageResolver | null): void {
    globalResolver = resolver;
}

export function getImageResolver(): ImageResolver | null {
    return globalResolver;
}

type UrlMapper = (src: string) => string;

const RETRY_INTERVAL_MS = 3000;

export class DefaultImageResolver implements ImageResolver {
    readonly pendingEntities = new Set<Entity>();
    private cache_ = new Map<string, ResolvedImage>();
    private loading_ = new Set<string>();
    private failed_ = new Map<string, number>();
    private entitySrcMap_ = new Map<Entity, Set<string>>();
    private srcEntityMap_ = new Map<string, Set<Entity>>();
    private urlMapper_: UrlMapper;

    constructor(urlMapper: UrlMapper) {
        this.urlMapper_ = urlMapper;
    }

    resolve(src: string): ResolvedImage | null {
        return this.cache_.get(src) ?? null;
    }

    preload(src: string): void {
        if (this.cache_.has(src) || this.loading_.has(src)) return;
        const failedAt = this.failed_.get(src);
        if (failedAt !== undefined && Date.now() - failedAt < RETRY_INTERVAL_MS) return;
        this.loading_.add(src);
        this.failed_.delete(src);
        const url = this.urlMapper_(src);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            this.cache_.set(src, img);
            this.loading_.delete(src);
            this.failed_.delete(src);
            const entities = this.srcEntityMap_.get(src);
            if (entities) {
                for (const e of entities) this.pendingEntities.add(e);
            }
        };
        img.onerror = () => {
            this.loading_.delete(src);
            this.failed_.set(src, Date.now());
        };
        img.src = url;
    }

    trackEntity(entity: Entity, srcs: string[]): void {
        let oldSrcs = this.entitySrcMap_.get(entity);
        if (oldSrcs) {
            for (const s of oldSrcs) {
                this.srcEntityMap_.get(s)?.delete(entity);
            }
            oldSrcs.clear();
        } else {
            oldSrcs = new Set();
            this.entitySrcMap_.set(entity, oldSrcs);
        }
        for (const src of srcs) {
            oldSrcs.add(src);
            let entities = this.srcEntityMap_.get(src);
            if (!entities) {
                entities = new Set();
                this.srcEntityMap_.set(src, entities);
            }
            entities.add(entity);
            this.preload(src);
        }
    }

    invalidate(src: string): void {
        this.cache_.delete(src);
        this.loading_.delete(src);
        this.failed_.delete(src);
        const entities = this.srcEntityMap_.get(src);
        if (entities) {
            for (const e of entities) this.pendingEntities.add(e);
        }
    }

    invalidateAll(): void {
        const allEntities = new Set<Entity>();
        for (const entities of this.srcEntityMap_.values()) {
            for (const e of entities) allEntities.add(e);
        }
        this.cache_.clear();
        this.loading_.clear();
        this.failed_.clear();
        for (const e of allEntities) this.pendingEntities.add(e);
    }

    retryFailed(): void {
        if (this.failed_.size === 0) return;
        const now = Date.now();
        for (const [src, failedAt] of this.failed_) {
            if (now - failedAt >= RETRY_INTERVAL_MS) {
                this.preload(src);
            }
        }
    }

    untrackEntity(entity: Entity): void {
        const srcs = this.entitySrcMap_.get(entity);
        if (srcs) {
            for (const s of srcs) {
                this.srcEntityMap_.get(s)?.delete(entity);
            }
            this.entitySrcMap_.delete(entity);
        }
    }
}
