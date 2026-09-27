// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A model's DDS images arrive as PNG, and maps whose pixels contradict their slot are called out.
 */
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { prepareModelImages } from '../src/assets/modelImages';
import { encodeRgbaPng } from '../src/assets/png';
import type { ImportedMaterial, ModelImportResult } from '../src/assets/modelImport';

/** An 8x8 uncompressed BGRA DDS, every texel `bgra`. */
function dds(bgra: number[]): Uint8Array {
    const head = new Uint8Array(128);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x20534444, true);
    v.setUint32(4, 124, true);
    v.setUint32(12, 8, true);
    v.setUint32(16, 8, true);
    v.setUint32(80, 0x41, true);
    v.setUint32(88, 32, true);
    v.setUint32(92, 0x00ff0000, true);
    return new Uint8Array([...head, ...new Array(64).fill(bgra).flat()]);
}

function png(pixel: (i: number) => number[]): Uint8Array {
    const rgba = new Uint8Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) rgba.set(pixel(i), i * 4);
    return encodeRgbaPng(8, 8, rgba);
}

function model(material: Partial<ImportedMaterial>, externalFiles: string[] = []): ModelImportResult {
    const mat = { index: 0, name: 'm', baseColor: [1, 1, 1, 1], opaque: true, cullBackfaces: true, ...material } as ImportedMaterial;
    return {
        meshes: [{ material: mat } as ModelImportResult['meshes'][number]],
        textures: [], externalFiles, nodes: [], animations: [], warnings: [],
    };
}

describe('preparing a model\'s images', () => {
    it('turns an external DDS into an embedded PNG, keeping its sampler settings', () => {
        const files: Record<string, Uint8Array> = { 'Textures/Wall.dds': dds([30, 20, 10, 255]) };
        const result = model({ baseColorTexture: { file: 'Textures/Wall.dds', external: true, settings: { wrapMode: 'clamp' } } },
            ['scene.bin', 'Textures/Wall.dds']);
        prepareModelImages(result, uri => files[uri] ?? null);

        expect(result.meshes[0]!.material!.baseColorTexture).toEqual({ file: 'Wall.png', external: false, settings: { wrapMode: 'clamp' } });
        expect(result.externalFiles).toEqual(['scene.bin']);
        const decoded = PNG.sync.read(Buffer.from(result.textures[0]!.bytes));
        expect([...decoded.data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    });

    it('drops an occlusion map that is zero everywhere, and says so', () => {
        const result = model({ occlusionTexture: { file: 'orm.png', external: true }, occlusionStrength: 1 });
        prepareModelImages(result, () => png(i => [0, 100 + i, 0, 255]));
        expect(result.meshes[0]!.material!.occlusionTexture).toBeUndefined();
        expect(result.meshes[0]!.material!.occlusionStrength).toBeUndefined();
        expect(result.warnings.join('\n')).toMatch(/occlusion map orm\.png is zero in every texel/);
    });

    it('keeps an occlusion map with any light in it', () => {
        const result = model({ occlusionTexture: { file: 'orm.png', external: true } });
        prepareModelImages(result, () => png(i => [i === 5 ? 1 : 0, 0, 0, 255]));
        expect(result.meshes[0]!.material!.occlusionTexture?.file).toBe('orm.png');
    });

    it('notices a map that is one colour, and still imports it', () => {
        const result = model({ metallicRoughnessTexture: { file: 'Spec.dds', external: true } });
        prepareModelImages(result, () => dds([0, 188, 0, 255]));
        expect(result.meshes[0]!.material!.metallicRoughnessTexture?.file).toBe('Spec.png');
        expect(result.warnings).toEqual(['Spec.dds is one colour (0, 188, 0, 255) across 8x8 — a material constant would say the same']);
    });

    it('reads an FBX base colour\'s alpha as a cutout, a see-through surface, or nothing', () => {
        const run = (alpha: (i: number) => number, alphaFromBaseColor = true) => {
            const result = model({ baseColorTexture: { file: 'leaf.png', external: true } });
            prepareModelImages(result, () => png(i => [90, 120, 40, alpha(i)]), { alphaFromBaseColor });
            const m = result.meshes[0]!.material!;
            return { cutoff: m.alphaCutoff, opaque: m.opaque };
        };
        expect(run(i => (i % 4 === 0 ? 0 : 255))).toEqual({ cutoff: 0.5, opaque: true });
        expect(run(() => 128)).toEqual({ cutoff: undefined, opaque: false });
        expect(run(() => 255)).toEqual({ cutoff: undefined, opaque: true });
        // A glTF says its alpha mode itself; an OPAQUE one ignores the channel.
        expect(run(i => (i % 4 === 0 ? 0 : 255), false)).toEqual({ cutoff: undefined, opaque: true });
    });

    it('skips a DDS it cannot read rather than referencing a file nothing loads', () => {
        const result = model({ normalTexture: { file: 'gone.dds', external: true } }, ['gone.dds']);
        prepareModelImages(result, () => null);
        expect(result.meshes[0]!.material!.normalTexture).toBeUndefined();
        expect(result.warnings.join('\n')).toMatch(/gone\.dds could not be read/);
    });
});
