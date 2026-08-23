// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dragonbones/DragonBonesManager.ts
 * @brief   Entities, their armature instances, and the skeletons they share.
 *
 * @details ONE class, where Spine has two. Its Manager exists to route an entity
 *          to the backend for ITS Spine version, because five vendored runtimes
 *          ship side by side. DragonBones' format is frozen and there is one
 *          runtime, so that routing layer would have nothing to route — mirroring
 *          the split here would be importing someone else's constraint.
 *
 *          Skeletons are shared and refcounted. Ten entities of the same armature
 *          parse the file once and hold one atlas between them; the last one out
 *          unloads it. An entity given no asset key gets its own, which is the
 *          honest fallback for a caller that cannot say when two are the same.
 */
import type { Entity } from '../types';
import { submitEntityMeshes, type SkeletalMaterialOf, type SkeletalSubmitCore } from '../skeletal/submitMeshes';
import type { SkeletalBounds } from '../skeletal/types';
import { DragonBonesModuleController } from './DragonBonesController';
import { log } from '../util/logger';

/** How one entity's armature is posed and drawn. */
interface EntityInfo {
    skeletonHandle: number;
    instanceId: number;
    skeletonScale: number;
    flipX: boolean;
    flipY: boolean;
    layer: number;
    timeScale: number;
    /**
     * False freezes the pose: the armature stops advancing but is still drawn.
     * Distinct from {@link DragonBonesManager.setEnabled}, which removes it from
     * the frame entirely — a paused character is still on screen.
     */
    playing: boolean;
    /** Set when the skeleton is shared; absent means this entity owns its own. */
    assetKey?: string;
}

export interface DragonBonesEntityOptions {
    armature: string;
    /** Identifies the loaded file, so entities of one asset share a skeleton. */
    assetKey?: string;
    skeletonScale?: number;
    flipX?: boolean;
    flipY?: boolean;
    layer?: number;
    animation?: string;
    loop?: boolean;
}

export class DragonBonesManager {
    private readonly controller_: DragonBonesModuleController;
    private readonly entities_ = new Map<Entity, EntityInfo>();
    private readonly disabled_ = new Set<Entity>();
    private readonly skeletons_ = new Map<string, { handle: number; refcount: number }>();

    constructor(controller: DragonBonesModuleController) {
        this.controller_ = controller;
    }

    get controller(): DragonBonesModuleController {
        return this.controller_;
    }

    // — Skeletons ————————————————————————————————————————————————————————————

    /**
     * Parse a file once per `assetKey`, or every time when none is given.
     * Returns -1 on failure, with the reason on the controller.
     */
    loadSkeleton(skeletonData: Uint8Array | string, atlasJson: string, assetKey?: string): number {
        if (assetKey !== undefined) {
            const shared = this.skeletons_.get(assetKey);
            if (shared) return shared.handle;
        }
        const handle = this.controller_.loadSkeleton(skeletonData, atlasJson);
        if (handle < 0) {
            log.warn('dragonbones', `loadSkeleton failed: ${this.controller_.getLastError()}`);
            return -1;
        }
        if (assetKey !== undefined) this.skeletons_.set(assetKey, { handle, refcount: 0 });
        return handle;
    }

    /** Bind the uploaded atlas page; safe after instances exist. */
    setAtlasTexture(skeletonHandle: number, textureId: number): void {
        this.controller_.setAtlasTexture(skeletonHandle, textureId);
    }

    getArmatures(skeletonHandle: number): string[] {
        return this.controller_.getArmatures(skeletonHandle);
    }

    // — Entities —————————————————————————————————————————————————————————————

    /** Attach an armature to `entity`. Replaces whatever it had. */
    addEntity(entity: Entity, skeletonHandle: number, options: DragonBonesEntityOptions): boolean {
        this.removeEntity(entity);

        const instanceId = this.controller_.createInstance(skeletonHandle, options.armature);
        if (instanceId < 0) return false;

        if (options.assetKey !== undefined) {
            const shared = this.skeletons_.get(options.assetKey);
            if (shared) shared.refcount++;
        }

        const info: EntityInfo = {
            skeletonHandle,
            instanceId,
            skeletonScale: options.skeletonScale ?? 1,
            flipX: options.flipX ?? false,
            flipY: options.flipY ?? false,
            layer: options.layer ?? 0,
            timeScale: 1,
            playing: true,
            assetKey: options.assetKey,
        };
        this.entities_.set(entity, info);

        if (options.animation) this.controller_.play(instanceId, options.animation, options.loop ?? true);
        return true;
    }

    removeEntity(entity: Entity): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        this.controller_.destroyInstance(info.instanceId);
        this.releaseSkeleton_(info);
        this.entities_.delete(entity);
        this.disabled_.delete(entity);
    }

    hasInstance(entity: Entity): boolean {
        return this.entities_.has(entity);
    }

    /** The entities that currently have an armature bound — what a per-frame pass
     *  over "everything DragonBones draws" iterates, without asking the World. */
    boundEntities(): Iterable<Entity> {
        return this.entities_.keys();
    }

    /**
     * A disabled entity keeps its instance but stops advancing and drawing.
     *
     * Also driven by `DragonBonesAnimation.enabled` — the plugin carries that field
     * across on its edges (skeletal/enableSync), so writing the component wins at
     * the moment it is written and this call holds between such writes.
     */
    setEnabled(entity: Entity, enabled: boolean): void {
        if (enabled) this.disabled_.delete(entity);
        else this.disabled_.add(entity);
    }

    setEntityProps(
        entity: Entity,
        props: Partial<Pick<EntityInfo, 'skeletonScale' | 'flipX' | 'flipY' | 'layer' | 'playing'>>
            & { timeScale?: number; color?: { r: number; g: number; b: number; a: number } },
    ): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        const { timeScale, color, ...rest } = props;
        Object.assign(info, rest);
        // Neither of these is a field to assign: the module owns the clock and the
        // tint, so it has to be told rather than remembered.
        if (timeScale !== undefined) this.setTimeScale(entity, timeScale);
        if (color) this.setColor(entity, color.r, color.g, color.b, color.a);
    }

    /**
     * Tint the whole armature. Multiplied onto each slot's authored colour, so
     * opaque white is not "no tint applied" but "the tint that changes nothing" —
     * which is why clearing the field in the editor restores the original rather
     * than leaving the last colour stuck.
     */
    setColor(entity: Entity, r: number, g: number, b: number, a: number): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setColor(info.instanceId, r, g, b, a);
    }

    // — Animation ————————————————————————————————————————————————————————————

    play(entity: Entity, animation: string, loop = true): boolean {
        const info = this.entities_.get(entity);
        return info ? this.controller_.play(info.instanceId, animation, loop) : false;
    }

    /** Crossfade in, which is where DragonBones puts what Spine keeps in a table. */
    fadeIn(entity: Entity, animation: string, fadeSeconds: number, loop = true): boolean {
        const info = this.entities_.get(entity);
        return info ? this.controller_.fadeIn(info.instanceId, animation, fadeSeconds, loop) : false;
    }

    stop(entity: Entity, animation = ''): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.stop(info.instanceId, animation);
    }

    setTimeScale(entity: Entity, scale: number): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        info.timeScale = scale;
        this.controller_.setTimeScale(info.instanceId, scale);
    }

    getAnimations(entity: Entity): string[] {
        const info = this.entities_.get(entity);
        return info ? this.controller_.getAnimations(info.instanceId) : [];
    }

    getBounds(entity: Entity): SkeletalBounds | null {
        const info = this.entities_.get(entity);
        return info ? this.controller_.getBounds(info.instanceId) : null;
    }

    // — Frame ————————————————————————————————————————————————————————————————

    updateAnimations(dt: number): void {
        for (const [entity, info] of this.entities_) {
            if (this.disabled_.has(entity)) continue;
            // Paused armatures fall through to submitMeshes, which still draws the
            // pose they are holding.
            if (!info.playing) continue;
            this.controller_.update(info.instanceId, dt);
        }
    }

    submitMeshes(core: SkeletalSubmitCore, registry: unknown, materialOf?: SkeletalMaterialOf): void {
        for (const [entity, info] of this.entities_) {
            if (this.disabled_.has(entity)) continue;
            // False means the core cannot take geometry at all, so asking again for
            // the next entity would only repeat the same check.
            const accepted = submitEntityMeshes(core, registry, entity, info, cb =>
                this.controller_.forEachMeshBatch(info.instanceId, cb), materialOf);
            if (!accepted) return;
        }
    }

    // — Teardown —————————————————————————————————————————————————————————————

    /** Drop every instance and skeleton. Idempotent, so a second call is a no-op. */
    dispose(): void {
        for (const info of this.entities_.values()) {
            this.controller_.destroyInstance(info.instanceId);
        }
        for (const shared of this.skeletons_.values()) {
            this.controller_.unloadSkeleton(shared.handle);
        }
        this.entities_.clear();
        this.disabled_.clear();
        this.skeletons_.clear();
    }

    /** One reference gone; a shared skeleton unloads when the last one does. */
    private releaseSkeleton_(info: EntityInfo): void {
        if (info.assetKey === undefined) {
            this.controller_.unloadSkeleton(info.skeletonHandle);
            return;
        }
        const shared = this.skeletons_.get(info.assetKey);
        if (!shared) return;
        if (--shared.refcount <= 0) {
            this.controller_.unloadSkeleton(shared.handle);
            this.skeletons_.delete(info.assetKey);
        }
    }
}
