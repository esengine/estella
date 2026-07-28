// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The DragonBones side module against a real file. The point of these is the
// geometry: the adapter compiles whether or not its arithmetic is right, and the
// two places it can be wrong quietly — which space a weighted mesh is posed in,
// and whether the pivot is applied before the matrix — both look like a bad export
// rather than like a bug. So the assertions are about numbers, not about success.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WASM_DIR } from './helpers/loadWasm';

const DB_JS = resolve(WASM_DIR, 'dragonbones.js');
const DB_WASM = resolve(WASM_DIR, 'dragonbones.wasm');
const ASSET_DIR = resolve(__dirname, 'assets/dragonbones');
const SKE = resolve(ASSET_DIR, 'DragonBoy_ske.json');
const TEX = resolve(ASSET_DIR, 'DragonBoy_tex.json');
const HAS_ASSETS = existsSync(DB_WASM) && existsSync(SKE);

interface DbModule {
    ccall(name: string, ret: string | null, sig: string[], args: unknown[]): never;
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    HEAPU8: Uint8Array;
    HEAPF32: Float32Array;
    HEAPU32: Uint32Array;
    HEAP32: Int32Array;
}

describe.skipIf(!HAS_ASSETS)('DragonBones side module', () => {
    let M: DbModule;
    const call = <T>(name: string, ret: string | null, sig: string[], args: unknown[]): T =>
        M.ccall(name, ret, sig, args) as unknown as T;

    /// Copy a buffer into the module's heap; the parsers want bytes it owns.
    const put = (buf: Uint8Array): number => {
        const ptr = M._malloc(buf.length);
        M.HEAPU8.set(buf, ptr);
        return ptr;
    };

    beforeAll(async () => {
        const factory = (await import(DB_JS)).default as (a: { wasmBinary: Uint8Array }) => Promise<DbModule>;
        M = await factory({ wasmBinary: new Uint8Array(readFileSync(DB_WASM)) });
    });

    const load = (): number => {
        const ske = new Uint8Array(readFileSync(SKE));
        const tex = new Uint8Array(readFileSync(TEX));
        return call<number>('db_loadSkeleton', 'number', ['number', 'number', 'number', 'number'], [
            put(ske), ske.length, put(tex), tex.length,
        ]);
    };

    it('reads a file, and names the armatures inside it', () => {
        const handle = load();
        expect(handle, call<string>('db_getLastError', 'string', [], [])).toBeGreaterThanOrEqual(0);
        // A DragonBones file is a project, not a skeleton — hence the list.
        expect(JSON.parse(call<string>('db_getArmatures', 'string', ['number'], [handle]))).toEqual(['Dragon']);
        expect(call<string>('db_getAtlasImageName', 'string', ['number'], [handle])).toBe('DragonBoy_tex.png');
        call('db_unloadSkeleton', null, ['number'], [handle]);
    });

    it('refuses unreadable data instead of building half an armature', () => {
        const junk = new Uint8Array([1, 2, 3, 4]);
        const handle = call<number>('db_loadSkeleton', 'number', ['number', 'number', 'number', 'number'], [
            put(junk), junk.length, put(junk), junk.length,
        ]);
        expect(handle).toBeLessThan(0);
        expect(call<string>('db_getLastError', 'string', [], [])).not.toBe('');
    });

    it('lists the animations the file declares', () => {
        const handle = load();
        const instance = call<number>('db_createInstance', 'number', ['number', 'string'], [handle, 'Dragon']);
        expect(instance).toBeGreaterThanOrEqual(0);
        expect(JSON.parse(call<string>('db_getAnimations', 'string', ['number'], [instance])).sort())
            .toEqual(['fall', 'jump', 'stand', 'walk']);
        call('db_destroyInstance', null, ['number'], [instance]);
        call('db_unloadSkeleton', null, ['number'], [handle]);
    });

    it('poses triangles once a texture is bound, and none before', () => {
        const handle = load();
        const instance = call<number>('db_createInstance', 'number', ['number', 'string'], [handle, 'Dragon']);
        call('db_playAnimation', 'number', ['number', 'string', 'number'], [instance, 'walk', 0]);

        // A slot with no texture has nothing to draw — and must say so rather than
        // emitting geometry that samples whatever id 0 happens to be.
        call('db_update', null, ['number', 'number'], [instance, 1 / 60]);
        expect(call<number>('db_getMeshBatchCount', 'number', ['number'], [instance])).toBe(0);

        call('db_setAtlasTexture', null, ['number', 'number'], [handle, 7]);
        for (let i = 0; i < 10; i++) call('db_update', null, ['number', 'number'], [instance, 1 / 60]);

        const batches = call<number>('db_getMeshBatchCount', 'number', ['number'], [instance]);
        expect(batches).toBeGreaterThan(0);

        let vertices = 0;
        let indices = 0;
        for (let b = 0; b < batches; b++) {
            vertices += call<number>('db_getMeshBatchVertexCount', 'number', ['number', 'number'], [instance, b]);
            indices += call<number>('db_getMeshBatchIndexCount', 'number', ['number', 'number'], [instance, b]);
        }
        expect(vertices).toBeGreaterThan(0);
        expect(indices % 3).toBe(0);

        call('db_destroyInstance', null, ['number'], [instance]);
        call('db_unloadSkeleton', null, ['number'], [handle]);
    });

    it('produces finite positions and in-range uvs', () => {
        const handle = load();
        call('db_setAtlasTexture', null, ['number', 'number'], [handle, 7]);
        const instance = call<number>('db_createInstance', 'number', ['number', 'string'], [handle, 'Dragon']);
        call('db_playAnimation', 'number', ['number', 'string', 'number'], [instance, 'walk', 0]);
        for (let i = 0; i < 10; i++) call('db_update', null, ['number', 'number'], [instance, 1 / 60]);

        const vertexCount = call<number>('db_getMeshBatchVertexCount', 'number', ['number', 'number'], [instance, 0]);
        const indexCount = call<number>('db_getMeshBatchIndexCount', 'number', ['number', 'number'], [instance, 0]);
        const vp = M._malloc(vertexCount * 8 * 4);
        const ip = M._malloc(indexCount * 2);
        const tp = M._malloc(4);
        const bp = M._malloc(4);
        call('db_getMeshBatchData', null, ['number', 'number', 'number', 'number', 'number', 'number'], [
            instance, 0, vp, ip, tp, bp,
        ]);

        expect(M.HEAPU32[tp >> 2]).toBe(7);
        const v = new Float32Array(M.HEAPF32.buffer, vp, vertexCount * 8);
        for (let i = 0; i < vertexCount; i++) {
            expect(Number.isFinite(v[i * 8])).toBe(true);
            expect(Number.isFinite(v[i * 8 + 1])).toBe(true);
            // Normalized against the atlas page, so a uv outside this means the
            // page size was wrong or a rotated region was unpacked the wrong way.
            expect(v[i * 8 + 2]).toBeGreaterThanOrEqual(0);
            expect(v[i * 8 + 2]).toBeLessThanOrEqual(1);
            expect(v[i * 8 + 3]).toBeGreaterThanOrEqual(0);
            expect(v[i * 8 + 3]).toBeLessThanOrEqual(1);
        }

        call('db_destroyInstance', null, ['number'], [instance]);
        call('db_unloadSkeleton', null, ['number'], [handle]);
    });

    it('survives an animation being retired — a crossfade, then the state going away', () => {
        // The runtime hands a finished animation state back through
        // `_armature->_dragonBones->bufferObject(state)`, and BaseFactory leaves
        // that pointer null unless an integration sets one. Nothing here failed
        // when it was null: on wasm the null dereference lands in readable low
        // memory, so this test passed against the broken build too — it took an
        // arm64 SIGSEGV to see it. Kept because the wasm build is where the code
        // is edited, and a leak (the buffer never drains) is the quiet half of the
        // same bug.
        const handle = load();
        call('db_setAtlasTexture', null, ['number', 'number'], [handle, 7]);
        const instance = call<number>('db_createInstance', 'number', ['number', 'string'], [handle, 'Dragon']);
        call('db_playAnimation', 'number', ['number', 'string', 'number'], [instance, 'stand', 0]);

        // Cross-fade repeatedly and run past each fade, so states really do retire
        // rather than just being queued behind one another.
        for (const name of ['walk', 'jump', 'fall', 'stand', 'walk']) {
            call('db_fadeInAnimation', 'number', ['number', 'string', 'number', 'number'], [instance, name, 0.2, 0]);
            for (let i = 0; i < 30; i++) call('db_update', null, ['number', 'number'], [instance, 1 / 60]);
        }

        // Still posing afterwards: a recycled state that was handed back twice, or
        // one still in use, shows up here as no geometry rather than as a throw.
        expect(call<number>('db_getMeshBatchCount', 'number', ['number'], [instance])).toBeGreaterThan(0);

        call('db_destroyInstance', null, ['number'], [instance]);
        call('db_unloadSkeleton', null, ['number'], [handle]);
    });

    it('stands the character up, rather than posing it in the authoring tool\'s axes', () => {
        // DragonBones poses y-DOWN and the engine's world is y-up, so the adapter
        // flips. Nothing else catches it: every other assertion here is about
        // magnitude or finiteness, and an upside-down armature satisfies all of
        // them — it took a screenshot to notice, which is exactly why this exists.
        //
        // The test is DragonBoy's head against his feet. The head slot sits at the
        // TOP of a standing character, so its vertices must have the greater y.
        const handle = load();
        call('db_setAtlasTexture', null, ['number', 'number'], [handle, 7]);
        const instance = call<number>('db_createInstance', 'number', ['number', 'string'], [handle, 'Dragon']);
        call('db_playAnimation', 'number', ['number', 'string', 'number'], [instance, 'stand', 0]);
        call('db_update', null, ['number', 'number'], [instance, 1 / 60]);

        // Every posed vertex, across every batch — the split into batches is a
        // texture/blend detail and says nothing about where a part is.
        let minY = Infinity, maxY = -Infinity;
        const batches = call<number>('db_getMeshBatchCount', 'number', ['number'], [instance]);
        expect(batches).toBeGreaterThan(0);
        for (let b = 0; b < batches; b++) {
            const vertexCount = call<number>('db_getMeshBatchVertexCount', 'number', ['number', 'number'], [instance, b]);
            const indexCount = call<number>('db_getMeshBatchIndexCount', 'number', ['number', 'number'], [instance, b]);
            const vp = M._malloc(vertexCount * 8 * 4);
            const ip = M._malloc(indexCount * 2);
            const tp = M._malloc(4);
            const bp = M._malloc(4);
            call('db_getMeshBatchData', null, ['number', 'number', 'number', 'number', 'number', 'number'], [
                instance, b, vp, ip, tp, bp,
            ]);
            const v = new Float32Array(M.HEAPF32.buffer, vp, vertexCount * 8);
            for (let i = 0; i < vertexCount; i++) {
                const y = v[i * 8 + 1];
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            M._free(vp); M._free(ip); M._free(tp); M._free(bp);
        }

        // The armature's origin is at the feet, so a right-way-up DragonBoy
        // reaches much further above it than below.
        expect(maxY).toBeGreaterThan(0);
        expect(maxY).toBeGreaterThan(Math.abs(minY));

        call('db_destroyInstance', null, ['number'], [instance]);
        call('db_unloadSkeleton', null, ['number'], [handle]);
    });

    it('moves the character as it walks, and keeps it a character-sized thing', () => {
        const handle = load();
        call('db_setAtlasTexture', null, ['number', 'number'], [handle, 7]);
        const instance = call<number>('db_createInstance', 'number', ['number', 'string'], [handle, 'Dragon']);
        call('db_playAnimation', 'number', ['number', 'string', 'number'], [instance, 'walk', 0]);

        const bounds = (): [number, number, number, number] => {
            const p = [M._malloc(4), M._malloc(4), M._malloc(4), M._malloc(4)];
            call('db_getBounds', null, ['number', 'number', 'number', 'number', 'number'], [instance, ...p]);
            const read = (ptr: number) => new Float32Array(M.HEAPF32.buffer, ptr, 1)[0];
            return [read(p[0]), read(p[1]), read(p[2]), read(p[3])];
        };

        call('db_update', null, ['number', 'number'], [instance, 1 / 60]);
        const first = bounds();
        for (let i = 0; i < 20; i++) call('db_update', null, ['number', 'number'], [instance, 1 / 60]);
        const later = bounds();

        // Roughly DragonBoy-sized. A weighted mesh posed in the wrong space lands
        // hundreds of units away and blows this up; a pivot applied after the
        // matrix instead of before collapses it.
        expect(later[2]).toBeGreaterThan(10);
        expect(later[2]).toBeLessThan(2000);
        expect(later[3]).toBeGreaterThan(10);
        expect(later[3]).toBeLessThan(2000);
        // And it is an animation, not a still.
        expect(first).not.toEqual(later);

        call('db_destroyInstance', null, ['number'], [instance]);
        call('db_unloadSkeleton', null, ['number'], [handle]);
    });
});
