// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpineRuntime.ts
 * @brief   One loaded Spine version: what it holds, and what it poses.
 *
 * @details A runtime is a wasm module of one Spine version plus everything that
 *          lives inside it — the native skeletons it parsed, by ERA, and the
 *          instance each entity is posed by. Its ABI half is a private adapter
 *          (heap, scratch allocation, guarded calls); the two are one lifetime,
 *          which is why they are one object.
 *
 *          It does NOT decide which runtime an entity belongs to. That is the
 *          manager's: a runtime can only see its own entities, so one handed an
 *          entity another is posing has nothing to retire.
 */
import type { Entity } from '../types';
import type { CppRegistry } from '../wasm';
import type { EngineApi } from '../ecs/bridge/engineApi';
import { SpineModuleController } from './SpineController';
import type { RawSpineEvent, ConstraintList, TransformMixData, PathMixData } from './SpineController';
import { wrapSpineModule, type SpineWasmModule } from './SpineModuleLoader';
import type { SpineEraBinding, SpineEraClaim } from './prepareSpine';
import { beginSpineFrame, newSpineFrameMetrics, SpineTimeWindow,
         type SpineFrameMetrics } from './spineMetrics';
import type { SpineVersion } from '../sideModules/registry';
import { log } from '../util/logger';
import { submitEntityMeshes, type SkeletalMaterialOf } from '../skeletal/submitMeshes';

interface EntityInfo {
    skelHandle: number;
    instanceId: number;
    skeletonScale: number;
    flipX: boolean;
    flipY: boolean;
    layer: number;
    timeScale: number;
    playing: boolean;
    /** Which era of which asset. Entities sharing it share one loaded skeleton. */
    era: string;
}

/** One parsed skeleton, and the era it was parsed from. The claim is the
 *  residency's, not each entity's: the refcount already knows when the native
 *  object is no longer needed, and a claim per entity would say it twice. */
interface SkeletonResidency {
    skelHandle: number;
    refcount: number;
    claim: SpineEraClaim;
}

export class SpineRuntime {
    private controller_: SpineModuleController;
    private entities_: Map<Entity, EntityInfo> = new Map();
    private disabledEntities_: Set<Entity> = new Set();
    // era -> the one native skeleton every entity of that era is posed by.
    private skeletons_: Map<string, SkeletonResidency> = new Map();
    /** Null unless someone asked. The one field every probe is behind. */
    private metrics_: SpineFrameMetrics | null = null;
    private readonly poseWindow_ = new SpineTimeWindow();
    private readonly readbackWindow_ = new SpineTimeWindow();
    private readonly totalWindow_ = new SpineTimeWindow();

    /** One runtime per loaded module: the ABI adapter is made here rather than
     *  handed in, because nothing else has a reason to hold one. */
    constructor(readonly version: SpineVersion, module: SpineWasmModule) {
        this.controller_ = new SpineModuleController(module, wrapSpineModule(module));
    }

    get entityCount(): number {
        return this.entities_.size;
    }

    loadEntity(entity: Entity, era: SpineEraBinding): boolean {
        // Commit after success, like the preparation that produced the asset:
        // what this replaces keeps posing until the new binding exists, so a
        // skeleton that will not parse costs the entity nothing.
        const claimed = this.claimSkeleton_(era);
        if (claimed < 0) return false;
        const instanceId = this.controller_.createInstance(claimed);
        if (instanceId < 0) {
            log.error('spine', `Failed to create instance: ${this.controller_.getLastError()}`);
            this.releaseSkeleton_({ skelHandle: claimed, era: era.id } as EntityInfo);
            return false;
        }

        // Only now: the old instance and its claim on the era it was posing.
        // Re-binding to the SAME era claimed it again above, so the skeleton is
        // never unloaded and re-parsed underneath an entity that stays on it.
        this.removeEntity(entity);
        this.entities_.set(entity, {
            skelHandle: claimed, instanceId, era: era.id,
            skeletonScale: 1, flipX: false, flipY: false, layer: 0, timeScale: 1, playing: true,
        });
        return true;
    }

    /**
     * One claim on the era's native skeleton — the loaded one if this runtime has
     * it, else a fresh parse; -1 when the era cannot be joined or will not parse.
     * Retained BEFORE anything is parsed from it: what a native skeleton was made
     * of has to outlive it, and a page freed under it cannot be put back.
     */
    private claimSkeleton_(era: SpineEraBinding): number {
        const shared = this.skeletons_.get(era.id);
        if (shared) {
            shared.refcount++;
            return shared.skelHandle;
        }
        const claim = era.retain();
        if (!claim) {
            log.error('spine', `Spine era "${era.id}" can no longer be joined`);
            return -1;
        }
        const { skelData, atlasText, isBinary, textures } = era.value;
        const skelHandle = this.controller_.loadSkeleton(skelData, atlasText, isBinary);
        if (skelHandle < 0) {
            log.error('spine', `Failed to load skeleton: ${this.controller_.getLastError()}`);
            claim.release();
            return -1;
        }
        const pageCount = this.controller_.getAtlasPageCount(skelHandle);
        for (let i = 0; i < pageCount; i++) {
            const pageName = this.controller_.getAtlasPageTextureName(skelHandle, i);
            const tex = textures.get(pageName);
            if (tex) {
                this.controller_.setAtlasPageTexture(skelHandle, i, tex.glId, tex.w, tex.h);
            }
        }
        this.skeletons_.set(era.id, { skelHandle, refcount: 1, claim });
        return skelHandle;
    }

    setEntityProps(entity: Entity, props: {
        skeletonScale?: number; flipX?: boolean; flipY?: boolean; layer?: number;
        timeScale?: number; playing?: boolean; color?: { r: number; g: number; b: number; a: number };
    }): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        if (props.skeletonScale !== undefined) info.skeletonScale = props.skeletonScale;
        if (props.flipX !== undefined) info.flipX = props.flipX;
        if (props.flipY !== undefined) info.flipY = props.flipY;
        if (props.layer !== undefined) info.layer = props.layer;
        if (props.timeScale !== undefined) info.timeScale = props.timeScale;
        if (props.playing !== undefined) info.playing = props.playing;
        // Whole-skeleton tint applied straight to skeleton->color (persists there until
        // changed; re-applied on every sync so a reload/rebuild restores it).
        if (props.color) this.controller_.setSkeletonColor(info.instanceId, props.color.r, props.color.g, props.color.b, props.color.a);
    }

    setAnimation(entity: Entity, animation: string, loop: boolean): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.play(info.instanceId, animation, loop);
    }

    setSkin(entity: Entity, skin: string): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setSkin(info.instanceId, skin);
    }

    getBounds(entity: Entity): { x: number; y: number; width: number; height: number } | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.getBounds(info.instanceId);
    }

    getAnimations(entity: Entity): string[] {
        const info = this.entities_.get(entity);
        if (!info) return [];
        return this.controller_.getAnimations(info.instanceId);
    }

    getSkins(entity: Entity): string[] {
        const info = this.entities_.get(entity);
        if (!info) return [];
        return this.controller_.getSkins(info.instanceId);
    }

    // NOTE: mix durations live on the skeleton's AnimationStateData (C++ takes a
    // skeletonHandle), so these apply to EVERY entity sharing this asset, not just
    // `entity`. Crossfade timing is an asset-level property here — pass an entity
    // only to resolve which asset. (True per-instance mix would need a C++ change.)
    setDefaultMix(entity: Entity, duration: number): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setDefaultMix(info.skelHandle, duration);
    }

    setMixDuration(entity: Entity, fromAnim: string, toAnim: string, duration: number): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setMixDuration(info.skelHandle, fromAnim, toAnim, duration);
    }

    setTrackAlpha(entity: Entity, track: number, alpha: number): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.setTrackAlpha(info.instanceId, track, alpha);
    }

    setAttachment(entity: Entity, slotName: string, attachmentName: string): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setAttachment(info.instanceId, slotName, attachmentName);
    }

    setIKTarget(entity: Entity, constraintName: string, targetX: number, targetY: number, mix: number): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setIKTarget(info.instanceId, constraintName, targetX, targetY, mix);
    }

    setSlotColor(entity: Entity, slotName: string, r: number, g: number, b: number, a: number): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setSlotColor(info.instanceId, slotName, r, g, b, a);
    }

    listConstraints(entity: Entity): ConstraintList | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.listConstraints(info.instanceId);
    }

    getTransformConstraintMix(entity: Entity, name: string): TransformMixData | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.getTransformConstraintMix(info.instanceId, name);
    }

    setTransformConstraintMix(entity: Entity, name: string, mix: TransformMixData): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setTransformConstraintMix(info.instanceId, name, mix);
    }

    getPathConstraintMix(entity: Entity, name: string): PathMixData | null {
        const info = this.entities_.get(entity);
        if (!info) return null;
        return this.controller_.getPathConstraintMix(info.instanceId, name);
    }

    setPathConstraintMix(entity: Entity, name: string, mix: PathMixData): boolean {
        const info = this.entities_.get(entity);
        if (!info) return false;
        return this.controller_.setPathConstraintMix(info.instanceId, name, mix);
    }

    setEnabled(entity: Entity, enabled: boolean): void {
        if (enabled) {
            this.disabledEntities_.delete(entity);
        } else {
            this.disabledEntities_.add(entity);
        }
    }

    enableEvents(entity: Entity): void {
        const info = this.entities_.get(entity);
        if (info) this.controller_.enableEvents(info.instanceId);
    }

    collectAllEvents(): { entity: Entity; raw: RawSpineEvent }[] {
        const result: { entity: Entity; raw: RawSpineEvent }[] = [];
        for (const [entity, info] of this.entities_) {
            const events = this.controller_.collectEvents(info.instanceId);
            for (const raw of events) {
                result.push({ entity, raw });
            }
        }
        return result;
    }

    updateAll(dt: number): void {
        const m = this.metrics_;
        if (m) beginSpineFrame(m);
        const started = m ? performance.now() : 0;
        for (const [entity, info] of this.entities_) {
            // Disabled means out of the frame entirely, so it costs no posing
            // either — the same meaning the DragonBones manager gives it.
            if (this.disabledEntities_.has(entity)) continue;
            // playing=false freezes the pose (skip advance, still submitted);
            // timeScale scales the advance (update() takes an arbitrary dt).
            if (info.playing) this.controller_.update(info.instanceId, dt * info.timeScale);
            if (m) m.abi.pose++;
        }
        if (!m) return;
        m.time.pose = performance.now() - started;
        m.entities = this.entities_.size;
        m.residencies = this.skeletons_.size;
        this.poseWindow_.push(m.time.pose);
    }

    /** @param core whichever engine core is present (see ecs/engineApi.ts) — the
     *  batches cross through its heap, which is wasm linear memory on the web and the
     *  host arena on a device. */
    extractAndSubmitMeshes(core: NonNullable<EngineApi>, registry: CppRegistry,
                           materialOf?: SkeletalMaterialOf): void {
        const m = this.metrics_;
        const started = m ? performance.now() : 0;
        for (const [entity, info] of this.entities_) {
            if (this.disabledEntities_.has(entity)) continue;
            // Shared with every skeletal runtime (skeletal/submitMeshes): the core's
            // entry point takes geometry and a transform, and knows nothing about
            // what posed them. A false means the core cannot take geometry at all,
            // so there is no point asking again for the next entity.
            const accepted = submitEntityMeshes(core, registry, entity, info, cb =>
                this.controller_.forEachMeshBatch(info.instanceId, cb, m ?? undefined),
                                                materialOf, m ?? undefined);
            if (!accepted) return;
        }
        if (!m) return;
        // ONE clock pair for the whole pass. What it is made of — discovering
        // batches, extracting them, copying them across — is counted rather than
        // timed here; see benchmarks/spine-readback-phases for the split.
        m.time.readback = performance.now() - started;
        m.time.total = m.time.pose + m.time.readback;
        this.readbackWindow_.push(m.time.readback);
        this.totalWindow_.push(m.time.total);
    }

    /**
     * Start or stop reporting what each frame costs. Off by default and off is
     * free: every counter and both clock reads are behind this one field, so a
     * runtime nobody is watching pays a branch per entity and nothing else.
     */
    observe(on: boolean): void {
        this.metrics_ = on ? (this.metrics_ ?? newSpineFrameMetrics()) : null;
    }

    /** The LIVE frame record — the same object every frame, so reading it costs
     *  nothing and holding it shows the next frame. Null when not observing. */
    metrics(): SpineFrameMetrics | null {
        return this.metrics_;
    }

    /** The last 120 frames of each timed phase. A mean hides the frame that
     *  missed; these say whether one did. */
    windows(): { pose: SpineTimeWindow; readback: SpineTimeWindow; total: SpineTimeWindow } {
        return { pose: this.poseWindow_, readback: this.readbackWindow_, total: this.totalWindow_ };
    }

    removeEntity(entity: Entity): void {
        const info = this.entities_.get(entity);
        if (!info) return;
        this.controller_.destroyInstance(info.instanceId);
        this.releaseSkeleton_(info);
        this.entities_.delete(entity);
        this.disabledEntities_.delete(entity);
    }

    /** Drop one reference to an entity's skeleton. At zero the NATIVE object
     *  goes first and the era it was parsed from after it — the order ownership
     *  says, not the order today's unload happens to tolerate. */
    private releaseSkeleton_(info: EntityInfo): void {
        const shared = this.skeletons_.get(info.era);
        if (!shared) return;
        if (--shared.refcount > 0) return;
        this.controller_.unloadSkeleton(shared.skelHandle);
        this.skeletons_.delete(info.era);
        shared.claim.release();
    }

    /** Give back everything this runtime holds, in the order it holds it:
     *  instances, then the native skeletons, then the eras they came from. */
    dispose(): void {
        for (const info of this.entities_.values()) {
            this.controller_.destroyInstance(info.instanceId);
        }
        for (const residency of this.skeletons_.values()) {
            this.controller_.unloadSkeleton(residency.skelHandle);
            residency.claim.release();
        }
        this.entities_.clear();
        this.disabledEntities_.clear();
        this.skeletons_.clear();
    }
}
