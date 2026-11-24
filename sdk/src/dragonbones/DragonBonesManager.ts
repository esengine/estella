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
import type { SkeletalBoneTree, SkeletalBounds } from '../skeletal/types';
import { DragonBonesModuleController } from './DragonBonesController';
import { log } from '../util/logger';
import { releaseAtlasOwner, releaseAllAtlasOwners } from './atlasOwnership';

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
    private bindingRevision_ = 0;
    private lifetime_ = 0;
    /** @internal Identifies pending work belonging to the current set of armatures. */
    get bindingLifetime(): number { return this.lifetime_; }
    /** @internal Changes when the set of armatures eligible to draw can change. */
    get bindingRevision(): number { return this.bindingRevision_; }
    private readonly skeletons_ = new Map<string, { handle: number; refcount: number }>();
    private readonly unkeyedSkeletons_ = new Map<number, number>();

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
        else this.unkeyedSkeletons_.set(handle, 0);
        return handle;
    }

    /** Bind the uploaded atlas page; safe after instances exist. */
    setAtlasTexture(skeletonHandle: number, textureId: number): void {
        this.controller_.setAtlasTexture(skeletonHandle, textureId);
    }

    getArmatures(skeletonHandle: number): string[] {
        return this.controller_.getArmatures(skeletonHandle);
    }

    /** @internal Retire a scene load that produced no armature instances. */
    discardUnboundSkeleton(assetKey: string): void {
        const shared = this.skeletons_.get(assetKey);
        if (!shared || shared.refcount !== 0) return;
        this.controller_.unloadSkeleton(shared.handle);
        this.skeletons_.delete(assetKey);
        releaseAtlasOwner(this, shared.handle);
    }

    // — Entities —————————————————————————————————————————————————————————————

    /** Replace an armature only after its new instance and ownership are valid. */
    addEntity(entity: Entity, skeletonHandle: number, options: DragonBonesEntityOptions): boolean {
        const previous = this.entities_.get(entity);
        const shared = options.assetKey === undefined ? undefined : this.skeletons_.get(options.assetKey);
        if (options.assetKey !== undefined && (!shared || shared.handle !== skeletonHandle)) return false;
        if (options.assetKey === undefined && [...this.skeletons_.values()].some(s => s.handle === skeletonHandle)) return false;
        if (previous?.skeletonHandle === skeletonHandle && previous.assetKey !== options.assetKey) return false;
        const instanceId = this.controller_.createInstance(skeletonHandle, options.armature);
        if (instanceId < 0) return false;
        if (shared) shared.refcount++;
        else this.unkeyedSkeletons_.set(skeletonHandle, (this.unkeyedSkeletons_.get(skeletonHandle) ?? 0) + 1);
        if (previous) {
            this.controller_.destroyInstance(previous.instanceId);
            this.releaseSkeleton_(previous);
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
        ++this.bindingRevision_;

        if (options.animation) this.controller_.play(instanceId, options.animation, options.loop ?? true);
        return true;
    }

    removeEntity(entity: Entity): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        this.controller_.destroyInstance(info.instanceId);
        this.releaseSkeleton_(info);
        this.entities_.delete(entity);
        ++this.bindingRevision_;
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
        if (this.disabled_.has(entity) === !enabled) return;
        ++this.bindingRevision_;
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

    /** The posed bones of this entity's armature and how it places them; null if not loaded. @experimental */
    boneTree(entity: Entity): SkeletalBoneTree | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        const bones = this.controller_.getBoneTree(info.instanceId);
        return bones ? { bones, scale: info.skeletonScale, flipX: info.flipX, flipY: info.flipY } : null;
    }

    getBounds(entity: Entity): SkeletalBounds | null {
        const info = this.entities_.get(entity);
        return info ? this.controller_.getBounds(info.instanceId) : null;
    }

    // — Frame ————————————————————————————————————————————————————————————————

    /** Freeze inactive entities without changing their manual enable state. */
    updateAnimations(dt: number, isActive?: (entity: Entity) => boolean): void {
        for (const [entity, info] of this.entities_) {
            if (this.disabled_.has(entity) || (isActive && !isActive(entity))) continue;
            // Paused armatures fall through to submitMeshes, which still draws the
            // pose they are holding.
            if (!info.playing) continue;
            this.controller_.update(info.instanceId, dt);
        }
    }

    /** Skip extraction for entities the activity predicate excludes. */
    submitMeshes(core: SkeletalSubmitCore, registry: unknown, materialOf?: SkeletalMaterialOf, isActive?: (entity: Entity) => boolean): void {
        for (const [entity, info] of this.entities_) {
            if (this.disabled_.has(entity) || (isActive && !isActive(entity))) continue;
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
        ++this.lifetime_;
        for (const info of this.entities_.values()) {
            this.controller_.destroyInstance(info.instanceId);
        }
        for (const shared of this.skeletons_.values()) {
            this.controller_.unloadSkeleton(shared.handle);
        }
        for (const handle of this.unkeyedSkeletons_.keys()) this.controller_.unloadSkeleton(handle);
        releaseAllAtlasOwners(this);
        if (this.entities_.size) ++this.bindingRevision_;
        this.entities_.clear();
        this.disabled_.clear();
        this.skeletons_.clear();
        this.unkeyedSkeletons_.clear();
    }

    /** One reference gone; a shared skeleton unloads when the last one does. */
    private releaseSkeleton_(info: EntityInfo): void {
        if (info.assetKey === undefined) {
            const refs = (this.unkeyedSkeletons_.get(info.skeletonHandle) ?? 1) - 1;
            if (refs > 0) this.unkeyedSkeletons_.set(info.skeletonHandle, refs);
            else {
                this.controller_.unloadSkeleton(info.skeletonHandle);
                releaseAtlasOwner(this, info.skeletonHandle);
                this.unkeyedSkeletons_.delete(info.skeletonHandle);
            }
            return;
        }
        const shared = this.skeletons_.get(info.assetKey);
        if (!shared) return;
        if (--shared.refcount <= 0) {
            this.controller_.unloadSkeleton(shared.handle);
            releaseAtlasOwner(this, shared.handle);
            this.skeletons_.delete(info.assetKey);
        }
    }
}
