// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ESEngineModule, CppRegistry } from '../wasm';
import type { Entity } from '../types';
import type { RawSpineEvent, ConstraintList, TransformMixData, PathMixData } from './SpineController';
import type { SpineModuleFactory } from './SpineModuleLoader';
import { wrapSpineModule } from './SpineModuleLoader';
import { SpineModuleController } from './SpineController';
import { ModuleBackend } from './ModuleBackend';
import { log } from '../logger';

export type SpineVersion = '3.8' | '4.1' | '4.2';

export class SpineManager {
    private coreModule_: ESEngineModule;
    private factories_: Map<SpineVersion, SpineModuleFactory>;
    private backends_: Map<SpineVersion, ModuleBackend> = new Map();
    private loadingBackends_: Map<SpineVersion, Promise<ModuleBackend | null>> = new Map();
    private entityVersions_: Map<Entity, SpineVersion> = new Map();

    constructor(
        coreModule: ESEngineModule,
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
        if (!m) return null;
        if (m[1].startsWith('4.2')) return '4.2';
        if (m[1].startsWith('4.1')) return '4.1';
        if (m[1].startsWith('3.')) return '3.8';
        return null;
    }

    async loadEntity(
        entity: Entity,
        skelData: Uint8Array | string,
        atlasText: string,
        textures: Map<string, { glId: number; w: number; h: number }>,
        _registry: CppRegistry,
        assetKey?: string,
    ): Promise<SpineVersion | null> {
        const version = typeof skelData === 'string'
            ? SpineManager.detectVersionJson(skelData)
            : SpineManager.detectVersion(skelData);

        if (!version) return null;

        // Every version loads into its per-version side-module backend; there is
        // no native runtime fallback. A missing factory for `version` fails the
        // load (logged below) — spine is strictly pay-for-use.
        const backend = await this.ensureBackend(version);
        if (!backend) {
            log.error('spine', `Failed to create backend for version ${version}`);
            return null;
        }

        const isBinary = skelData instanceof Uint8Array;
        const ok = backend.loadEntity(entity, skelData, atlasText, textures, isBinary, assetKey);
        if (!ok) {
            log.error('spine', `Failed to load entity ${entity} into backend ${version}`);
            return null;
        }
        this.entityVersions_.set(entity, version);
        return version;
    }

    updateAnimations(dt: number): void {
        for (const backend of this.backends_.values()) {
            backend.updateAll(dt);
        }
    }

    submitMeshes(registry: CppRegistry): void {
        for (const backend of this.backends_.values()) {
            backend.extractAndSubmitMeshes(this.coreModule_, registry);
        }
    }

    removeEntity(entity: Entity): void {
        const version = this.entityVersions_.get(entity);
        if (!version) {
            this.entityVersions_.delete(entity);
            return;
        }
        const backend = this.backends_.get(version);
        if (backend) {
            backend.removeEntity(entity);
        }
        this.entityVersions_.delete(entity);
    }

    /**
     * Tear down every loaded runtime backend, freeing the native skeletons /
     * atlases each holds. Idempotent — clearing the maps makes a second call a
     * no-op. Called from SpinePlugin.cleanup() on app teardown so spine wasm
     * resources don't leak across an engine re-init.
     */
    dispose(): void {
        for (const backend of this.backends_.values()) {
            backend.shutdown();
        }
        this.backends_.clear();
        this.loadingBackends_.clear();
        this.entityVersions_.clear();
    }

    getEntityVersion(entity: Entity): SpineVersion | undefined {
        return this.entityVersions_.get(entity);
    }

    hasModuleBackend(version: SpineVersion): boolean {
        return this.backends_.has(version);
    }

    getModuleBackend(version: SpineVersion): ModuleBackend | undefined {
        return this.backends_.get(version);
    }

    setAnimation(entity: Entity, animation: string, loop: boolean): void {
        const version = this.entityVersions_.get(entity);
        if (!version) return;
        const backend = this.backends_.get(version);
        if (backend) backend.setAnimation(entity, animation, loop);
    }

    setSkin(entity: Entity, skin: string): void {
        const version = this.entityVersions_.get(entity);
        if (!version) return;
        const backend = this.backends_.get(version);
        if (backend) backend.setSkin(entity, skin);
    }

    setEntityProps(entity: Entity, props: {
        skeletonScale?: number; flipX?: boolean; flipY?: boolean; layer?: number;
    }): void {
        const version = this.entityVersions_.get(entity);
        if (!version) return;
        const backend = this.backends_.get(version);
        if (backend) backend.setEntityProps(entity, props);
    }

    getBounds(entity: Entity): { x: number; y: number; width: number; height: number } | null {
        const version = this.entityVersions_.get(entity);
        if (!version) return null;
        const backend = this.backends_.get(version);
        if (backend) return backend.getBounds(entity);
        return null;
    }

    getAnimations(entity: Entity): string[] {
        const version = this.entityVersions_.get(entity);
        if (!version) return [];
        const backend = this.backends_.get(version);
        if (!backend) return [];
        return backend.getAnimations(entity);
    }

    getSkins(entity: Entity): string[] {
        const version = this.entityVersions_.get(entity);
        if (!version) return [];
        const backend = this.backends_.get(version);
        if (!backend) return [];
        return backend.getSkins(entity);
    }

    setDefaultMix(entity: Entity, duration: number): void {
        const backend = this.getEntityBackend_(entity);
        if (backend) backend.setDefaultMix(entity, duration);
    }

    setMixDuration(entity: Entity, fromAnim: string, toAnim: string, duration: number): void {
        const backend = this.getEntityBackend_(entity);
        if (backend) backend.setMixDuration(entity, fromAnim, toAnim, duration);
    }

    setTrackAlpha(entity: Entity, track: number, alpha: number): void {
        const backend = this.getEntityBackend_(entity);
        if (backend) backend.setTrackAlpha(entity, track, alpha);
    }

    setAttachment(entity: Entity, slotName: string, attachmentName: string): boolean {
        const backend = this.getEntityBackend_(entity);
        if (!backend) return false;
        return backend.setAttachment(entity, slotName, attachmentName);
    }

    setIKTarget(entity: Entity, constraintName: string, targetX: number, targetY: number, mix: number): boolean {
        const backend = this.getEntityBackend_(entity);
        if (!backend) return false;
        return backend.setIKTarget(entity, constraintName, targetX, targetY, mix);
    }

    setSlotColor(entity: Entity, slotName: string, r: number, g: number, b: number, a: number): boolean {
        const backend = this.getEntityBackend_(entity);
        if (!backend) return false;
        return backend.setSlotColor(entity, slotName, r, g, b, a);
    }

    listConstraints(entity: Entity): ConstraintList | null {
        const backend = this.getEntityBackend_(entity);
        if (backend) return backend.listConstraints(entity);
        return null;
    }

    getTransformConstraintMix(entity: Entity, name: string): TransformMixData | null {
        const backend = this.getEntityBackend_(entity);
        if (backend) return backend.getTransformConstraintMix(entity, name);
        return null;
    }

    setTransformConstraintMix(entity: Entity, name: string, mix: TransformMixData): boolean {
        const backend = this.getEntityBackend_(entity);
        if (backend) return backend.setTransformConstraintMix(entity, name, mix);
        return false;
    }

    getPathConstraintMix(entity: Entity, name: string): PathMixData | null {
        const backend = this.getEntityBackend_(entity);
        if (backend) return backend.getPathConstraintMix(entity, name);
        return null;
    }

    setPathConstraintMix(entity: Entity, name: string, mix: PathMixData): boolean {
        const backend = this.getEntityBackend_(entity);
        if (backend) return backend.setPathConstraintMix(entity, name, mix);
        return false;
    }

    setEnabled(entity: Entity, enabled: boolean): void {
        const backend = this.getEntityBackend_(entity);
        if (backend) backend.setEnabled(entity, enabled);
    }

    enableEvents(entity: Entity): void {
        const backend = this.getEntityBackend_(entity);
        if (backend) backend.enableEvents(entity);
    }

    collectAllEvents(): { entity: Entity; raw: RawSpineEvent }[] {
        const result: { entity: Entity; raw: RawSpineEvent }[] = [];
        for (const backend of this.backends_.values()) {
            const events = backend.collectAllEvents();
            for (const evt of events) {
                result.push(evt);
            }
        }
        return result;
    }

    hasInstance(entity: Entity): boolean {
        return this.entityVersions_.has(entity);
    }

    shutdown(): void {
        for (const backend of this.backends_.values()) {
            backend.shutdown();
        }
        this.backends_.clear();
        this.loadingBackends_.clear();
        this.entityVersions_.clear();
    }

    private getEntityBackend_(entity: Entity): ModuleBackend | undefined {
        const version = this.entityVersions_.get(entity);
        if (!version) return undefined;
        return this.backends_.get(version);
    }

    private async ensureBackend(version: SpineVersion): Promise<ModuleBackend | null> {
        const existing = this.backends_.get(version);
        if (existing) return existing;

        const loading = this.loadingBackends_.get(version);
        if (loading) return loading;

        const factory = this.factories_.get(version);
        if (!factory) {
            log.warn('spine', `No module factory for version ${version}`);
            return null;
        }

        const promise = (async () => {
            try {
                const raw = await factory();
                const api = wrapSpineModule(raw);
                const controller = new SpineModuleController(raw, api);
                const backend = new ModuleBackend(controller);
                this.backends_.set(version, backend);
                return backend;
            } catch (e) {
                log.error('spine', `Failed to load WASM module for version ${version}`, e);
                return null;
            } finally {
                this.loadingBackends_.delete(version);
            }
        })();

        this.loadingBackends_.set(version, promise);
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

function tryRead4xVersion(data: Uint8Array): SpineVersion | null {
    if (data.length < 10) return null;
    let pos = 8;
    const { value: len, bytesRead } = readVarint(data, pos);
    pos += bytesRead;
    if (len <= 1 || pos + len - 1 > data.length) return null;
    const ver = new TextDecoder().decode(data.subarray(pos, pos + len - 1));
    if (ver.startsWith('4.2')) return '4.2';
    if (ver.startsWith('4.1')) return '4.1';
    return null;
}

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
    if (ver.startsWith('3.')) return '3.8';
    return null;
}
