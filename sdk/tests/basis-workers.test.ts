// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  KTX2 transcoding on workers answers what the main thread answers.
 *
 * Node has no Worker, so this runs the generated worker script in-process behind
 * a stand-in that does what a browser does to it: `importScripts` of the real
 * basis glue, the real wasm, and structured-cloned messages both ways. What a
 * browser adds — a separate thread — is exercised by the Bistro boot on the box.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WASM_DIR, hasSideModule, loadSideModule } from './helpers/loadWasm';
import { basisTranscoderFor, createWorkerBasisTranscoder } from '../src/asset/basisWorkers';
import { transcoderFromModule, type BasisWasmModule } from '../src/asset/basisTranscoder';
import { CompressedTextureFormat, type TranscodeResult } from '../src/asset/compressed';
import type { SideModuleHost, SideModuleSource } from '../src/sideModules/host';
import { log } from '../src/util/logger';

const ROOT = path.resolve(__dirname, '../..');

const blobs = new Map<string, string>();
const saved = { Worker: globalThis.Worker, createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

class StandInWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    private readonly scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(d: unknown): void } & Record<string, unknown>;
    constructor(url: string) {
        const text = blobs.get(url);
        if (text === undefined) throw new Error(`no script at ${url}`);
        this.scope = {
            onmessage: null,
            location: { href: url },
            postMessage: (d: unknown) => setTimeout(() => this.onmessage?.({ data: structuredClone(d) }), 0),
        };
        const scope = this.scope;
        const importScripts = (u: string): void => {
            const code = blobs.get(u);
            if (code === undefined) throw new Error(`importScripts: nothing at ${u}`);
            // The glue tells where it runs by `globalThis`: a worker's has WorkerGlobalScope
            // and no `process`. Defined, not assigned: node's `process` is an accessor,
            // and assigning through the prototype clears the real one.
            const shadow = Object.create(globalThis, {
                process: { value: undefined }, WorkerGlobalScope: { value: class {} },
            });
            new Function('self', 'globalThis', 'importScripts',
                `${code}\n;self.ESBasisModule = typeof ESBasisModule === 'undefined' ? undefined : ESBasisModule;`,
            )(scope, shadow, importScripts);
        };
        new Function('self', 'importScripts', text)(scope, importScripts);
    }
    postMessage(d: unknown): void {
        setTimeout(() => this.scope.onmessage?.({ data: structuredClone(d) }), 0);
    }
    terminate(): void {}
}

beforeAll(() => {
    (globalThis as Record<string, unknown>).Worker = StandInWorker;
    let n = 0;
    URL.createObjectURL = (b: Blob) => {
        const url = `blob:stand-in/${n++}`;
        blobs.set(url, (b as unknown as { __text: string }).__text);
        return url;
    };
    URL.revokeObjectURL = () => {};
    // The scripts are handed over as text; keep a copy the stand-in can read synchronously.
    const RealBlob = Blob;
    (globalThis as Record<string, unknown>).Blob = class extends RealBlob {
        __text: string;
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) { super(parts, opts); this.__text = parts.map(String).join(''); }
    };
});
afterAll(() => {
    (globalThis as Record<string, unknown>).Worker = saved.Worker;
    URL.createObjectURL = saved.createObjectURL;
    URL.revokeObjectURL = saved.revokeObjectURL;
});

describe.skipIf(!hasSideModule('basis'))('KTX2 transcoding on workers', () => {
    let source: SideModuleSource;
    let main: ReturnType<typeof transcoderFromModule>;
    let ktx2: Uint8Array;

    beforeAll(async () => {
        const wasm = readFileSync(path.join(WASM_DIR, 'basis.wasm'));
        source = { glueText: readFileSync(path.join(WASM_DIR, 'basis.js'), 'utf8'), globalName: 'ESBasisModule',
                   wasmBytes: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer };
        main = transcoderFromModule(await loadSideModule<BasisWasmModule>('basis'));
        const encoder = await import(path.join(ROOT, 'build-tools/basis/encoder.mjs'));
        const rgba = new Uint8Array(64 * 64 * 4).map((_, i) => (i * 29) & 0xff);
        ktx2 = await encoder.encodeToKtx2({ type: encoder.ImageType.RGBA, data: rgba, width: 64, height: 64 }, { mode: 'uastc', mipmaps: true });
    });

    const same = (a: TranscodeResult | null, b: TranscodeResult | null) => {
        expect(a?.levels?.map((l) => [l.width, Buffer.from(l.data).toString('base64')]))
            .toEqual(b?.levels?.map((l) => [l.width, Buffer.from(l.data).toString('base64')]));
    };

    it('comes back with every level, byte for byte what the main thread makes', async () => {
        const workers = createWorkerBasisTranscoder(source, 2)!;
        same(await workers.transcode(ktx2, CompressedTextureFormat.ASTC_4x4),
             await main.transcode(ktx2, CompressedTextureFormat.ASTC_4x4));
        same(await workers.transcodeToRgba(ktx2), await main.transcodeToRgba(ktx2));
    });

    it('goes back to the main thread, once and for good, when the workers fail', async () => {
        const warn = vi.spyOn(log, 'warn');
        const host: SideModuleHost = {
            acquire: async () => (main as unknown as { mod: unknown }).mod as never,
            source: async () => ({ ...source, glueText: 'throw new Error("no glue")' }),
        };
        const t = (await basisTranscoderFor(host))!;
        same(await t.transcode(ktx2, CompressedTextureFormat.ASTC_4x4), await main.transcode(ktx2, CompressedTextureFormat.ASTC_4x4));
        await t.transcode(ktx2, CompressedTextureFormat.ASTC_4x4);
        expect(warn.mock.calls.filter((c) => String(c[1]).includes('main thread'))).toHaveLength(1);
        warn.mockRestore();
    });

    it('is made once per realm, however many loaders ask', async () => {
        const host: SideModuleHost = { acquire: async () => (main as unknown as { mod: unknown }).mod as never };
        expect(basisTranscoderFor(host)).toBe(basisTranscoderFor(host));
    });
});
