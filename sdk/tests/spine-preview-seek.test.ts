// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    spine-preview-seek.test.ts — one time, one pose.
 *
 * @details A scrub is only worth anything if going back to a time shows what it
 *          showed before, and a spine pose is the result of a RUN: `play` resets
 *          nothing, so a bone the next animation does not key keeps whatever the
 *          last pose left it at. Replaying from wherever the skeleton happens to
 *          be therefore gives a different pose depending on where you had been —
 *          which the editor found as a scrub whose pixels would not repeat.
 *
 *          The witness is a scrub's own shape — the SAME animation, visited at
 *          another time in between. That is where the leak actually shows: a
 *          walk replayed from wherever the last walk ended is not the walk. A
 *          cross-animation witness passes without the reset for some bones,
 *          which is how a criterion written that way would have missed it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR, hasSideModule } from './helpers/loadWasm';
import { SpineModuleController } from '../src/spine/SpineController';
import { wrapSpineModule, type SpineWasmModule } from '../src/spine/SpineModuleLoader';
import { SpineRuntime } from '../src/spine/SpineRuntime';
import type { SpineEraBinding } from '../src/spine/prepareSpine';
import type { MeshBatchVisitor } from '../src/skeletal/meshBatches';

const FIXTURES = resolve(__dirname, '../benchmarks/fixtures/spine');
const SKEL = resolve(FIXTURES, 'spineboy-38/spineboy-pro.skel');
const ATLAS = resolve(FIXTURES, 'spineboy-38/spineboy.atlas');
const HAS = hasSideModule('spine38') && existsSync(SKEL);

let controller: SpineModuleController;
let rawModule: SpineWasmModule;
let skelHandle = -1;

beforeAll(async () => {
    if (!HAS) return;
    const factory = (await import(resolve(WASM_DIR, 'spine38.js'))).default as
        (opts: unknown) => Promise<SpineWasmModule>;
    const bytes = readFileSync(resolve(WASM_DIR, 'spine38.wasm'));
    const module = await factory({
        instantiateWasm(imports: WebAssembly.Imports, cb: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
            void WebAssembly.instantiate(bytes, imports).then((r) => cb(r.instance, r.module));
            return {};
        },
    });
    rawModule = module;
    controller = new SpineModuleController(module, wrapSpineModule(module));
    skelHandle = controller.loadSkeleton(new Uint8Array(readFileSync(SKEL)),
                                         readFileSync(ATLAS, 'utf-8'), true);
    // The same page the preview's era binds. Without one the walk yields no
    // batches, and an empty digest compares equal to another empty digest.
    for (let i = 0, pages = controller.getAtlasPageCount(skelHandle); i < pages; i++) {
        controller.setAtlasPageTexture(skelHandle, i, 1, 2048, 2048);
    }
});

/** The pose as bone positions — what a picture of it is made of. */
function pose(instanceId: number, bones: string[]): string {
    return bones.map((name) => {
        const p = controller.getBonePosition(instanceId, name);
        const r = controller.getBoneRotation(instanceId, name);
        return p ? `${name}:${p.x.toFixed(4)},${p.y.toFixed(4)},${r.toFixed(4)}` : `${name}:none`;
    }).join('|');
}

/** An era for a preview instance. A page has to be bound or the walk yields no
 *  batches at all, and "no geometry" would read as "the same geometry". */
function previewEra(): SpineEraBinding {
    return {
        id: 'preview#1',
        pair: { skeleton: 'hero.skel', atlas: 'hero.atlas' },
        culling: { kind: 'unknown' },
        value: {
            skelData: new Uint8Array(readFileSync(SKEL)),
            atlasText: readFileSync(ATLAS, 'utf-8'), isBinary: true,
            textures: new Map([['spineboy.png', { glId: 1, w: 2048, h: 2048 }]]),
        },
        retain: () => ({ release: () => {} }),
    };
}

/** A replay, the way a preview seeks: setup pose, then run to `time`. */
function replay(instanceId: number, animation: string, time: number): void {
    controller.setToSetupPose(instanceId);
    controller.play(instanceId, animation, false);
    if (time > 0) controller.advanceAndApply(instanceId, time);
    controller.materializeWorldPose(instanceId, 0);
}

describe.skipIf(!HAS)('seeking to a time twice', () => {
    const BONES = ['root', 'hip', 'gun', 'head', 'front-foot-tip', 'rear-upper-arm', 'torso'];

    it('shows the same pose — the scrub\'s own shape, one animation', () => {
        const id = controller.createInstance(skelHandle);

        replay(id, 'walk', 0.4);
        const first = pose(id, BONES);
        replay(id, 'walk', 0.9);
        const later = pose(id, BONES);
        replay(id, 'walk', 0.4);

        expect(later, 'the two times pose the skeleton identically — this fixture '
            + 'cannot witness anything').not.toBe(first);
        expect(pose(id, BONES), 'one time gave two poses').toBe(first);
        controller.destroyInstance(id);
    });

    it('holds across a visit to another animation too', () => {
        const id = controller.createInstance(skelHandle);
        replay(id, 'walk', 0.4);
        const first = pose(id, BONES);
        replay(id, 'jump', 0.9);
        replay(id, 'walk', 0.4);
        expect(pose(id, BONES), 'another animation left something behind').toBe(first);
        controller.destroyInstance(id);
    });

    it('is the reset that makes it so, not the replay', () => {
        // Without the setup pose the same three steps disagree. Stated so the
        // criterion cannot be "passed" by deleting the reset and hoping — and
        // because this is the exact sequence the editor's scrub failed on.
        const id = controller.createInstance(skelHandle);
        const noReset = (animation: string, time: number): void => {
            controller.play(id, animation, false);
            if (time > 0) controller.advanceAndApply(id, time);
            controller.materializeWorldPose(id, 0);
        };
        noReset('walk', 0.4);
        const first = pose(id, BONES);
        noReset('walk', 0.9);
        noReset('walk', 0.4);
        expect(pose(id, BONES), 'replaying without the reset already agreed — '
            + 'the reset is then unnecessary and this criterion is empty').not.toBe(first);
        controller.destroyInstance(id);
    });

    it('holds for the preview instance itself, in the geometry it hands over', () => {
        // The path the pixels take: openPreview → replay → the world-pose demand
        // → the batch walk. The controller criteria above do not reach it, and
        // the reset living in the wrong place would leave them all green.
        const runtime = new SpineRuntime('3.8', rawModule);
        const preview = runtime.openPreview(previewEra())!;
        expect(preview, 'the preview instance did not open').toBeTruthy();

        // EVERY byte of every batch. A sampled digest missed the leak entirely:
        // the criterion passed with the reset deleted, which is a criterion that
        // does not check the thing it is named after.
        const geometry = (): { digest: number; bytes: number } => {
            let digest = 2166136261;
            let bytes = 0;
            preview.forEachMeshBatch((vertBytes) => {
                for (let i = 0; i < vertBytes.length; i++) {
                    digest = Math.imul(digest ^ vertBytes[i], 16777619);
                }
                bytes += vertBytes.length;
            });
            return { digest: digest >>> 0, bytes };
        };
        const seek = (animation: string, time: number): void => {
            preview.play(animation);
            if (time > 0) preview.advance(time);
        };

        seek('walk', 0.4);
        const first = geometry();
        seek('walk', 0.9);
        const later = geometry();
        seek('walk', 0.4);

        expect(first.bytes, 'the preview handed over no geometry').toBeGreaterThan(0);
        expect(later.digest, 'two times produced identical geometry').not.toBe(first.digest);
        expect(geometry().digest, 'one time gave two sets of geometry').toBe(first.digest);
        preview.dispose();
        runtime.dispose();
    });

    it('hands over the geometry a scene entity would, not a stale-world one', () => {
        // Determinism does NOT witness the world-pose debt: skipping it is wrong
        // the same way every time, so a replay criterion stays green. Agreement
        // catches it — a preview posed another way draws another thing.
        const runtime = new SpineRuntime('3.8', rawModule);
        const preview = runtime.openPreview(previewEra())!;
        const direct = controller.createInstance(skelHandle);

        const digestOf = (walk: (cb: MeshBatchVisitor) => void): string => {
            let hash = 2166136261;
            walk((vertBytes) => {
                for (let i = 0; i < vertBytes.length; i++) {
                    hash = Math.imul(hash ^ vertBytes[i], 16777619);
                }
            });
            return String(hash >>> 0);
        };

        preview.play('walk');
        preview.advance(0.4);
        // The scene's own sequence: advance the local pose, then settle the debt
        // before anything reads world-space geometry.
        controller.setToSetupPose(direct);
        controller.play(direct, 'walk', false);
        controller.advanceAndApply(direct, 0.4);
        controller.materializeWorldPose(direct, 0.4);
        // The dt this carries only does anything from 4.2 up, where a skeleton's
        // physics advances with the clock; on this 3.8 fixture it is ignored, so
        // nothing here witnesses the preview accumulating it.

        expect(digestOf((cb) => preview.forEachMeshBatch(cb)),
               'the preview drew a pose the scene path would not have drawn')
            .toBe(digestOf((cb) => controller.forEachMeshBatch(direct, cb)));

        controller.destroyInstance(direct);
        preview.dispose();
        runtime.dispose();
    });

    it('leaves nothing running, so a seek is a pose and not a playback', () => {
        const id = controller.createInstance(skelHandle);
        replay(id, 'walk', 0.4);
        const at = pose(id, ['gun']);
        // The tracks are cleared by the reset and the animation is unlooped, so
        // materializing again must not move it.
        controller.materializeWorldPose(id, 0);
        expect(pose(id, ['gun'])).toBe(at);
        controller.destroyInstance(id);
    });
});
