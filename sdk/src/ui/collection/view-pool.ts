/**
 * @file    view-pool.ts
 * @brief   Entity recycler for virtualized lists.
 *
 * A ViewPool keeps idle item entities around instead of despawning them,
 * so scrolling through a 10 000-row list only ever has ~(viewport items)
 * active. When an item scrolls off-screen, it is released back to the
 * pool; when a new item scrolls on, one is acquired from the pool (or a
 * fresh one is created).
 *
 * Visibility is toggled through an injected `setVisible` hook; this keeps
 * ViewPool decoupled from the UIRenderer component shape.
 */

import type { Entity } from '../../types';
import type { World } from '../../world';

/**
 * Factory + binder pair for a single item type. Registered per type
 * (e.g. `'default'`, `'header'`, `'footer'`).
 */
export interface ViewPoolTemplate<TData = unknown> {
    /**
     * Create a new entity when the pool has no free instances.
     * Attach any child entities / components needed to render one item.
     */
    factory: (world: World, parent: Entity) => Entity;
    /**
     * Apply data to an entity just acquired from the pool (or freshly
     * created). Called every time the item is bound, so binders must be
     * idempotent — do not rely on prior state.
     */
    binder: (entity: Entity, data: TData, index: number) => void;
}

export interface ViewPoolOptions {
    world: World;
    /**
     * Hook called on acquire/release to toggle item visibility. Default:
     * noop (ViewPool tracks free/used state without touching the entity).
     *
     * Typical implementation toggles `UIRenderer.enabled` on the entity
     * and its UI-visible descendants. Passed as a hook so ViewPool does
     * not depend on the UI primitives.
     */
    setVisible?: (world: World, entity: Entity, visible: boolean) => void;
}

/**
 * Pool of reusable item entities, keyed by item type.
 *
 * @example
 * ```ts
 * const pool = new ViewPool({
 *   world,
 *   setVisible: (w, e, v) => setEntityEnabled(w, e, v),
 * });
 *
 * pool.setTemplate('default', {
 *   factory: (w, parent) => createRow(w, { parent, height: 40 }),
 *   binder: (row, data: Player, i) => setText(row.meta.name, data.name),
 * });
 *
 * // when an item scrolls on-screen:
 * const entity = pool.acquire('default', contentEntity);
 * pool.bind('default', entity, players[i], i);
 *
 * // when it scrolls off:
 * pool.release('default', entity);
 * ```
 */
export class ViewPool {
    private readonly world_: World;
    private readonly setVisible_: (
        world: World,
        entity: Entity,
        visible: boolean,
    ) => void;
    private readonly templates_ = new Map<string, ViewPoolTemplate<unknown>>();
    private readonly free_ = new Map<string, Entity[]>();
    private unsubscribeDespawn_: (() => void) | null = null;
    private disposed_ = false;

    constructor(opts: ViewPoolOptions) {
        this.world_ = opts.world;
        this.setVisible_ = opts.setVisible ?? (() => {});

        // Auto-evict pooled entities that are despawned externally (e.g.
        // via cascading despawn from a parent). Without this, the pool
        // would hold dangling IDs that later acquire() would return.
        this.unsubscribeDespawn_ = this.world_.onDespawn((entity) => {
            for (const pool of this.free_.values()) {
                const idx = pool.indexOf(entity);
                if (idx !== -1) pool.splice(idx, 1);
            }
        });
    }

    /**
     * Register a template for an item type. Must be called before
     * `acquire` / `warmup` for that type.
     */
    setTemplate<TData>(itemType: string, template: ViewPoolTemplate<TData>): void {
        this.assertLive_();
        this.templates_.set(itemType, template as ViewPoolTemplate<unknown>);
        if (!this.free_.has(itemType)) this.free_.set(itemType, []);
    }

    /** True if a template has been registered for `itemType`. */
    hasTemplate(itemType: string): boolean {
        return this.templates_.has(itemType);
    }

    /**
     * Get an entity for display. Pops from the pool if available,
     * otherwise invokes the factory. The returned entity is visible.
     */
    acquire(itemType: string, parent: Entity): Entity {
        this.assertLive_();
        const template = this.templates_.get(itemType);
        if (!template) {
            throw new Error(
                `[ViewPool] No template registered for item type "${itemType}".`,
            );
        }

        const pool = this.free_.get(itemType)!;
        let entity: Entity;
        if (pool.length > 0) {
            entity = pool.pop() as Entity;
            this.setVisible_(this.world_, entity, true);
        } else {
            entity = template.factory(this.world_, parent);
            // Newly created entities are assumed visible by their factory.
        }
        return entity;
    }

    /**
     * Bind data to an entity via the registered template's binder.
     * Usually called right after `acquire`.
     */
    bind<TData>(itemType: string, entity: Entity, data: TData, index: number): void {
        this.assertLive_();
        const template = this.templates_.get(itemType);
        if (!template) {
            throw new Error(
                `[ViewPool] No template registered for item type "${itemType}".`,
            );
        }
        (template as ViewPoolTemplate<TData>).binder(entity, data, index);
    }

    /**
     * Return an entity to the pool. The entity is hidden (via `setVisible`)
     * but not despawned. No-op if the entity has already been despawned.
     */
    release(itemType: string, entity: Entity): void {
        this.assertLive_();
        if (!this.world_.valid(entity)) return;
        this.setVisible_(this.world_, entity, false);

        let pool = this.free_.get(itemType);
        if (!pool) {
            pool = [];
            this.free_.set(itemType, pool);
        }
        pool.push(entity);
    }

    /**
     * Pre-create N entities of a type and park them in the pool (hidden).
     * Useful to avoid first-frame allocation spikes.
     */
    warmup(itemType: string, count: number, parent: Entity): void {
        this.assertLive_();
        const template = this.templates_.get(itemType);
        if (!template) {
            throw new Error(
                `[ViewPool] No template registered for item type "${itemType}".`,
            );
        }
        let pool = this.free_.get(itemType);
        if (!pool) {
            pool = [];
            this.free_.set(itemType, pool);
        }
        for (let i = 0; i < count; i++) {
            const entity = template.factory(this.world_, parent);
            this.setVisible_(this.world_, entity, false);
            pool.push(entity);
        }
    }

    /** Number of currently-free entities of the given type. */
    freeCount(itemType: string): number {
        return this.free_.get(itemType)?.length ?? 0;
    }

    /**
     * Release resources: unsubscribe from world events and clear
     * internal tables. Does NOT despawn pooled entities (their lifetime
     * is tied to whatever parent they are attached to).
     */
    dispose(): void {
        if (this.disposed_) return;
        this.disposed_ = true;
        this.unsubscribeDespawn_?.();
        this.unsubscribeDespawn_ = null;
        this.templates_.clear();
        this.free_.clear();
    }

    private assertLive_(): void {
        if (this.disposed_) {
            throw new Error('[ViewPool] Operation on disposed pool.');
        }
    }
}
