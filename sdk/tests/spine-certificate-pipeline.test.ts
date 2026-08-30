// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-certificate-pipeline.test.ts
 * @brief   The promise reaching the runtime from the only place it may come
 *          from, and leaving when it is withdrawn.
 *
 * @details A deferred world pose is a permission somebody granted, so the grant
 *          has to live where the project keeps its decisions — the importer
 *          block an asset's `.meta` carries. What the runtime holds is a
 *          PROJECTION of that, rebuilt from it, never a store of its own: a
 *          contract deleted from the metadata that went on authorising a skip
 *          would be the worst kind of stale, because what it authorises is
 *          geometry not being drawn.
 */
import { describe, it, expect } from 'vitest';
import { Assets } from '../src/asset/Assets';
import { AssetRegistry } from '../src/asset/AssetRegistry';
import { Catalog } from '../src/asset/Catalog';
import type { Backend } from '../src/platform/backend';
import type { ESEngineModule } from '../src/wasm';
import { spineImportSettingsFrom } from '../src/asset/spineImportSettings';
import { SpineCertificates, projectSpineCertificates } from '../src/spine/spineCertificates';
import { spinePairKey } from '../src/spine/prepareSpine';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import { fakeSpineModule, fakeSpineEra } from './helpers/fakeSpineModule';
import type { Entity } from '../src/types';

const RECT = { x: -120, y: -80, width: 240, height: 180 };
const SKEL = 'hero/hero.skel';
const ATLAS = 'hero/hero.atlas';

function assetsWith(entries: Array<{ path: string; importer?: Record<string, unknown> }>): Assets {
    const backend = {
        resolveUrl: (p: string) => p,
        fetchText: async () => '',
        fetchBinary: async () => new ArrayBuffer(0),
    } as unknown as Backend;
    const assets = new Assets({
        backend,
        module: { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule,
        // A skeleton's atlas is a catalog dependency, which is what a cook
        // records for it — the same place `acquireSpine` looks.
        catalog: Catalog.fromJson({
            entries: { [SKEL]: { path: SKEL, deps: [ATLAS] } } as never,
        } as never),
    });
    const registry = new AssetRegistry();
    registry.loadManifest({
        version: '1.0',
        entries: entries.map((e, i) => ({
            uuid: `0000000${i}-0000-4000-8000-000000000000`,
            path: e.path, type: 'spine', importer: e.importer,
        })),
    });
    assets.setAssetRegistry(registry);
    return assets;
}

describe('a promise reaches the runtime from the project, and leaves with it', () => {
    it('the block carries a rectangle and nothing about where it came from', () => {
        expect(spineImportSettingsFrom({ cullingBounds: RECT })).toEqual({ cullingBounds: RECT });
        expect(spineImportSettingsFrom({})).toBeUndefined();
        expect(spineImportSettingsFrom(null)).toBeUndefined();
        // Half a rectangle is not a contract, and neither is one of no area:
        // "nothing is ever drawn" is not a promise anybody means to make.
        expect(spineImportSettingsFrom({ cullingBounds: { x: 0, y: 0, width: 10 } })).toBeUndefined();
        expect(spineImportSettingsFrom({ cullingBounds: { ...RECT, width: 0 } })).toBeUndefined();
    });

    it('metadata on the skeleton certifies the pair it forms', () => {
        const assets = assetsWith([{ path: SKEL, importer: { cullingBounds: RECT } }]);
        const envelope = assets.spineCertificates.envelopeFor(spinePairKey(SKEL, ATLAS));
        expect(envelope.kind).toBe('certified');
        if (envelope.kind !== 'certified') throw new Error('not certified');
        expect(envelope.bounds).toEqual({ minX: -120, minY: -80, maxX: 120, maxY: 100 });
    });

    it('a project that promised nothing certifies nothing', () => {
        const assets = assetsWith([{ path: SKEL }]);
        expect(assets.spineCertificates.envelopeFor(spinePairKey(SKEL, ATLAS)).kind).toBe('unknown');
    });

    it('withdrawing the contract withdraws the permission', () => {
        // The one that matters: what a stale certificate authorises is geometry
        // not being drawn, so the projection is rebuilt rather than added to.
        const certificates = new SpineCertificates();
        const atlasOf = (): string => ATLAS;
        projectSpineCertificates(certificates, [{ path: SKEL, importer: { cullingBounds: RECT } }], atlasOf);
        expect(certificates.envelopeFor(spinePairKey(SKEL, ATLAS)).kind).toBe('certified');

        projectSpineCertificates(certificates, [{ path: SKEL }], atlasOf);
        expect(certificates.envelopeFor(spinePairKey(SKEL, ATLAS)).kind,
            'a deleted contract went on authorising a skip').toBe('unknown');
    });

    it('a manifest that arrives after the registry is not missed', () => {
        // Attaching a registry and loading its manifest are two moments, and
        // which order a host does them in is the host's business. A projection
        // built once at the first would be empty for the whole run.
        const backend = {
            resolveUrl: (p: string) => p,
            fetchText: async () => '',
            fetchBinary: async () => new ArrayBuffer(0),
        } as unknown as Backend;
        const assets = new Assets({
            backend,
            module: { _malloc: () => 0, _free: () => {} } as unknown as ESEngineModule,
            catalog: Catalog.fromJson({
                entries: { [SKEL]: { path: SKEL, deps: [ATLAS] } } as never,
            } as never),
        });
        const registry = new AssetRegistry();
        assets.setAssetRegistry(registry);
        expect(assets.spineCertificates.envelopeFor(spinePairKey(SKEL, ATLAS)).kind).toBe('unknown');

        registry.loadManifest({
            version: '1.0',
            entries: [{
                uuid: '00000000-0000-4000-8000-000000000000',
                path: SKEL, type: 'spine', importer: { cullingBounds: RECT },
            }],
        });
        expect(assets.spineCertificates.envelopeFor(spinePairKey(SKEL, ATLAS)).kind,
            'the projection was built once and never looked again').toBe('certified');
    });

    it('the promise is about the pair, so another atlas inherits nothing', () => {
        const certificates = new SpineCertificates();
        projectSpineCertificates(certificates,
            [{ path: SKEL, importer: { cullingBounds: RECT } }], () => ATLAS);

        expect(certificates.envelopeFor(spinePairKey(SKEL, ATLAS)).kind).toBe('certified');
        expect(certificates.envelopeFor(spinePairKey(SKEL, 'winter/winter.atlas')).kind,
            'a promise about one atlas was read for another').toBe('unknown');
    });

    it('the promise does not care which generation of the bytes is loaded', () => {
        const assets = assetsWith([{ path: SKEL, importer: { cullingBounds: RECT } }]);
        const key = spinePairKey(SKEL, ATLAS);
        for (const generation of [17, 18, 19]) {
            expect(assets.spineCertificates.envelopeFor(key).kind,
                `generation ${generation} lost the promise`).toBe('certified');
        }
    });

    it('the contract is what turns the effect on, and off again', () => {
        // End to end, through the runtime that acts on it: a certified stateless
        // skeleton nobody can see costs an advance, and the same asset without
        // the contract costs everything it did before.
        const offscreen = (() => {
            const heap = new Uint32Array(64);
            return {
                renderer_submitSkeletalBatchByEntity: () => {},
                renderer_entityVisibleToCamera: (
                    _r: unknown, _e: number, _l: number,
                    _a: number, _b: number, _c: number, _d: number, out: number,
                ) => { heap[out >> 2] = 0; },
                _malloc: () => 4, _free: () => {},
                HEAPU8: new Uint8Array(heap.buffer), HEAPU32: heap,
            } as never;
        })();

        const run = (importer: Record<string, unknown> | undefined): {
            world: number; extract: number;
        } => {
            const assets = assetsWith([{ path: SKEL, importer }]);
            const envelope = assets.spineCertificates.envelopeFor(spinePairKey(SKEL, ATLAS));
            const fake = fakeSpineModule();
            const runtime = new SpineRuntime('3.8', fake.module);
            runtime.loadEntity(1 as Entity, fakeSpineEra('era#1', new Uint8Array([1]), envelope));
            runtime.setAnimation(1 as Entity, 'walk', true);
            runtime.observe(true);
            runtime.updateAll(1 / 60);
            runtime.extractAndSubmitMeshes(offscreen, {} as never);
            const m = runtime.metrics()!;
            const counts = {
                world: m.pose.worldMaterializations, extract: m.pose.meshExtractions,
            };
            runtime.dispose();
            return counts;
        };

        expect(run({ cullingBounds: RECT }), 'the contract did not reach the effect')
            .toEqual({ world: 0, extract: 0 });
        expect(run(undefined), 'an asset without a contract stopped behaving as it did')
            .toEqual({ world: 1, extract: 1 });
    });
});
