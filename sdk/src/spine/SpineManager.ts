// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { EngineApi } from '../ecs/bridge/engineApi';
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';
import type { SkeletalMaterialOf } from '../skeletal/submitMeshes';
import type { RawSpineEvent, ConstraintList, TransformMixData, PathMixData } from './SpineController';
import type { SpineModuleFactory } from './SpineModuleLoader';
import { SpineRuntime } from './SpineRuntime';
import type { SpineEraBinding } from './prepareSpine';
import type { SpineClipBudget } from './spineMetrics';
import { spineSceneDiagnostics } from './spineSceneDiagnostics';
import type { SpineSceneDiagnostics, SpinePreviewInstance } from './spineSceneDiagnostics';
import type { SpineCullingEnvelope } from './spineBounds';
import { log } from '../util/logger';

import type { SpineVersion } from '../sideModules/registry';

export type { SpineVersion };

/**
 * Which runtime reads a given skeleton's version string, newest prefix first. A
 * release Estella vendors no runtime for maps onto the one that reads its format:
 * 3.7 and older data loads on the 3.8 runtime. Anything unmatched is a version we
 * cannot honestly claim to play, so detection fails rather than guessing.
 */
const VERSION_PREFIXES: ReadonlyArray<readonly [string, SpineVersion]> = [
    ['4.3', '4.3'],
    ['4.2', '4.2'],
    ['4.1', '4.1'],
    ['3.', '3.8'],
    ['2.1', '2.1'],
];

function runtimeFor(reported: string): SpineVersion | null {
    for (const [prefix, version] of VERSION_PREFIXES) {
        if (reported.startsWith(prefix)) return version;
    }
    return null;
}

export class SpineManager {
    private coreModule_: NonNullable<EngineApi>;
    private factories_: Map<SpineVersion, SpineModuleFactory>;
    private runtimes_: Map<SpineVersion, SpineRuntime> = new Map();
    private loadingRuntimes_: Map<SpineVersion, Promise<SpineRuntime | null>> = new Map();
    /** Which runtime poses each entity. The authority for that is HERE: a
     *  runtime can only see its own entities, so one handed an entity another is
     *  posing cannot retire the binding it replaces. */
    private bindings_: Map<Entity, SpineRuntime> = new Map();
    /** So a runtime loaded after `observe(true)` reports too. */
    private observing_ = false;

    constructor(
        /** Whichever engine core is present (see ecs/engineApi.ts). */
        coreModule: NonNullable<EngineApi>,
        moduleFactories: Map<SpineVersion, SpineModuleFactory>,
    ) {
        this.coreModule_ = coreModule;
        this.factories_ = moduleFactories;
    }

    static detectVersion(data: Uint8Array): SpineVersion | null {
        const ver4x = tryRead4xVersion(data);
        if (ver4x) return ver4x;
        return tryRead3xVersion(data);
    }

    static detectVersionJson(json: string): SpineVersion | null {
        const m = json.match(/"spine"\s*:\s*"(\d+\.\d+)/);
        return m ? runtimeFor(m[1]) : null;
    }

    async loadEntity(
        entity: Entity,
        /** The prepared era and the right to keep it alive — indivisible, so a
         *  runtime can never be given one generation's id with another's claim. */
        era: SpineEraBinding,
        _registry: CppRegistry,
    ): Promise<SpineVersion | null> {
        const { skelData } = era.value;
        const version = typeof skelData === 'string'
            ? SpineManager.detectVersionJson(skelData)
            : SpineManager.detectVersion(skelData);

        if (!version) return null;

        // Every version loads into its per-version side-module backend; there is
        // no native runtime fallback. A missing factory for `version` fails the
        // load (logged below) — spine is strictly pay-for-use.
        const runtime = await this.ensureRuntime(version);
        if (!runtime) {
            log.error('spine', `Failed to create the runtime for version ${version}`);
            return null;
        }

        const previous = this.bindings_.get(entity);
        const ok = runtime.loadEntity(entity, era);
        if (!ok) {
            // Commit after success all the way up: the entity keeps the binding
            // it had, in whichever runtime that was.
            log.error('spine', `Failed to load entity ${entity} into the ${version} runtime`);
            return null;
        }
        // A move BETWEEN runtimes: the one it went to removed nothing, because
        // it never had this entity. Left behind, the old instance is posed and
        // submitted every frame and no despawn ever reaches it.
        if (previous && previous !== runtime) previous.removeEntity(entity);
        this.bindings_.set(entity, runtime);
        return version;
    }

    updateAnimations(dt: number): void {
        for (const runtime of this.runtimes_.values()) {
            runtime.updateAll(dt);
        }
    }

    submitMeshes(registry: CppRegistry, materialOf?: SkeletalMaterialOf): void {
        for (const runtime of this.runtimes_.values()) {
            runtime.extractAndSubmitMeshes(this.coreModule_, registry, materialOf);
        }
    }

    /** The entities that currently have a skeleton bound — what a per-frame pass
     *  over "everything spine draws" iterates, without asking the World. */
    boundEntities(): Iterable<Entity> {
        return this.bindings_.keys();
    }

    removeEntity(entity: Entity): void {
        this.bindings_.get(entity)?.removeEntity(entity);
        this.bindings_.delete(entity);
    }

    /**
     * Tear down every loaded runtime, freeing the native skeletons / atlases
     * each holds. Idempotent — clearing the maps makes a second call a no-op.
     * The ONE teardown door: `shutdown()` was a second name for this.
     */
    dispose(): void {
        for (const runtime of this.runtimes_.values()) {
            runtime.dispose();
        }
        this.runtimes_.clear();
        this.loadingRuntimes_.clear();
        this.bindings_.clear();
    }

    getEntityVersion(entity: Entity): SpineVersion | undefined {
        return this.bindings_.get(entity)?.version;
    }

    hasRuntime(version: SpineVersion): boolean {
        return this.runtimes_.has(version);
    }

    /**
     * Start or stop reporting what frames cost, on every runtime this app has
     * and every one it loads later. Off by default.
     */
    observe(on: boolean): void {
        this.observing_ = on;
        for (const runtime of this.runtimes_.values()) runtime.observe(on);
    }

    /**
     * Open a skeleton for an editor to pose itself, outside this manager's
     * bindings: it is never advanced by `updateAnimations` and never drawn by
     * `submitMeshes`. Null when the era's version has no runtime here.
     */
    async openPreview(era: SpineEraBinding): Promise<SpinePreviewInstance | null> {
        const { skelData } = era.value;
        const version = typeof skelData === 'string'
            ? SpineManager.detectVersionJson(skelData)
            : SpineManager.detectVersion(skelData);
        if (!version) return null;
        const runtime = await this.ensureRuntime(version);
        return runtime ? runtime.openPreview(era) : null;
    }

    /** Whether anything is counting. */
    get observing(): boolean {
        return this.observing_;
    }

    /**
     * Why this scene's spine costs what it does — the frame's numbers joined to
     * the per-asset reason each of them was paid. Derived on the spot from what
     * the runtimes already know; see spineSceneDiagnostics.
     */
    diagnostics(): SpineSceneDiagnostics {
        return spineSceneDiagnostics(this.runtimes_.values(), this.observing_);
    }

    setAnimation(entity: Entity, animation: string, loop: boolean): void {
        this.runtimeOf_(entity)?.setAnimation(entity, animation, loop);
    }

    setSkin(entity: Entity, skin: string): void {
        this.runtimeOf_(entity)?.setSkin(entity, skin);
    }

    setEntityProps(entity: Entity, props: {
        skeletonScale?: number; flipX?: boolean; flipY?: boolean; layer?: number;
        timeScale?: number; playing?: boolean; color?: { r: number; g: number; b: number; a: number };
    }): void {
        this.runtimeOf_(entity)?.setEntityProps(entity, props);
    }

    getBounds(entity: Entity): { x: number; y: number; width: number; height: number } | null {
        return this.runtimeOf_(entity)?.getBounds(entity) ?? null;
    }

    /**
     * What a scan of this entity's skeleton saw — an OBSERVATION, for authoring
     * to propose a culling contract from. Never an authority: see spineBounds.
     */
    observedBounds(entity: Entity, sampleStep?: number): SpineCullingEnvelope | null {
        return this.runtimeOf_(entity)?.observedBounds(entity, sampleStep) ?? null;
    }

    clipBudget(entity: Entity): SpineClipBudget | null {
        return this.runtimeOf_(entity)?.clipBudget(entity) ?? null;
    }

    getAnimations(entity: Entity): string[] {
        return this.runtimeOf_(entity)?.getAnimations(entity) ?? [];
    }

    getSkins(entity: Entity): string[] {
        return this.runtimeOf_(entity)?.getSkins(entity) ?? [];
    }

    setDefaultMix(entity: Entity, duration: number): void {
        const backend = this.runtimeOf_(entity);
        if (backend) backend.setDefaultMix(entity, duration);
    }

    setMixDuration(entity: Entity, fromAnim: string, toAnim: string, duration: number): void {
        const backend = this.runtimeOf_(entity);
        if (backend) backend.setMixDuration(entity, fromAnim, toAnim, duration);
    }

    setTrackAlpha(entity: Entity, track: number, alpha: number): void {
        const backend = this.runtimeOf_(entity);
        if (backend) backend.setTrackAlpha(entity, track, alpha);
    }

    setAttachment(entity: Entity, slotName: string, attachmentName: string): boolean {
        const backend = this.runtimeOf_(entity);
        if (!backend) return false;
        return backend.setAttachment(entity, slotName, attachmentName);
    }

    setIKTarget(entity: Entity, constraintName: string, targetX: number, targetY: number, mix: number): boolean {
        const backend = this.runtimeOf_(entity);
        if (!backend) return false;
        return backend.setIKTarget(entity, constraintName, targetX, targetY, mix);
    }

    setSlotColor(entity: Entity, slotName: string, r: number, g: number, b: number, a: number): boolean {
        const backend = this.runtimeOf_(entity);
        if (!backend) return false;
        return backend.setSlotColor(entity, slotName, r, g, b, a);
    }

    listConstraints(entity: Entity): ConstraintList | null {
        const backend = this.runtimeOf_(entity);
        if (backend) return backend.listConstraints(entity);
        return null;
    }

    getTransformConstraintMix(entity: Entity, name: string): TransformMixData | null {
        const backend = this.runtimeOf_(entity);
        if (backend) return backend.getTransformConstraintMix(entity, name);
        return null;
    }

    setTransformConstraintMix(entity: Entity, name: string, mix: TransformMixData): boolean {
        const backend = this.runtimeOf_(entity);
        if (backend) return backend.setTransformConstraintMix(entity, name, mix);
        return false;
    }

    getPathConstraintMix(entity: Entity, name: string): PathMixData | null {
        const backend = this.runtimeOf_(entity);
        if (backend) return backend.getPathConstraintMix(entity, name);
        return null;
    }

    setPathConstraintMix(entity: Entity, name: string, mix: PathMixData): boolean {
        const backend = this.runtimeOf_(entity);
        if (backend) return backend.setPathConstraintMix(entity, name, mix);
        return false;
    }

    /**
     * Take an entity out of the frame, or put it back: a disabled entity keeps its
     * instance but stops posing and drawing. Distinct from `playing: false`, which
     * freezes the pose and keeps showing it.
     *
     * Also driven by `SpineAnimation.enabled` — the plugin carries that field
     * across on its edges (skeletal/enableSync), so writing the component wins at
     * the moment it is written and this call holds between such writes.
     */
    setEnabled(entity: Entity, enabled: boolean): void {
        const backend = this.runtimeOf_(entity);
        if (backend) backend.setEnabled(entity, enabled);
    }

    enableEvents(entity: Entity): void {
        const backend = this.runtimeOf_(entity);
        if (backend) backend.enableEvents(entity);
    }

    collectAllEvents(): { entity: Entity; raw: RawSpineEvent }[] {
        const result: { entity: Entity; raw: RawSpineEvent }[] = [];
        for (const backend of this.runtimes_.values()) {
            const events = backend.collectAllEvents();
            for (const evt of events) {
                result.push(evt);
            }
        }
        return result;
    }

    hasInstance(entity: Entity): boolean {
        return this.bindings_.has(entity);
    }

    private runtimeOf_(entity: Entity): SpineRuntime | undefined {
        return this.bindings_.get(entity);
    }

    private async ensureRuntime(version: SpineVersion): Promise<SpineRuntime | null> {
        const existing = this.runtimes_.get(version);
        if (existing) return existing;

        const loading = this.loadingRuntimes_.get(version);
        if (loading) return loading;

        const factory = this.factories_.get(version);
        if (!factory) {
            log.warn('spine', `No module factory for version ${version}`);
            return null;
        }

        const promise = (async () => {
            try {
                const runtime = new SpineRuntime(version, await factory());
                if (this.observing_) runtime.observe(true);
                this.runtimes_.set(version, runtime);
                return runtime;
            } catch (e) {
                log.error('spine', `Failed to load WASM module for version ${version}`, e);
                return null;
            } finally {
                this.loadingRuntimes_.delete(version);
            }
        })();

        this.loadingRuntimes_.set(version, promise);
        return promise;
    }
}

function readVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
    let value = 0, shift = 0, bytesRead = 0;
    do {
        const b = data[offset + bytesRead++];
        value |= (b & 0x7F) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
    } while (shift < 35);
    return { value, bytesRead };
}

/** 4.x binaries open with an 8-byte hash, then a length-prefixed version string. */
function tryRead4xVersion(data: Uint8Array): SpineVersion | null {
    if (data.length < 10) return null;
    let pos = 8;
    const { value: len, bytesRead } = readVarint(data, pos);
    pos += bytesRead;
    if (len <= 1 || pos + len - 1 > data.length) return null;
    const ver = new TextDecoder().decode(data.subarray(pos, pos + len - 1));
    return ver.startsWith('4.') ? runtimeFor(ver) : null;
}

/** 3.x and 2.1 both length-prefix the hash, so the version string sits just after it. */
function tryRead3xVersion(data: Uint8Array): SpineVersion | null {
    if (data.length < 4) return null;
    let pos = 0;
    const { value: hashLen, bytesRead: hb } = readVarint(data, pos);
    pos += hb;
    if (hashLen > 0) pos += hashLen - 1;
    if (pos >= data.length) return null;
    const { value: verLen, bytesRead: vb } = readVarint(data, pos);
    pos += vb;
    if (verLen <= 1 || pos + verLen - 1 > data.length) return null;
    const ver = new TextDecoder().decode(data.subarray(pos, pos + verLen - 1));
    return (ver.startsWith('3.') || ver.startsWith('2.')) ? runtimeFor(ver) : null;
}
