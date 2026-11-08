// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { MeshChannel, MeshChannelType } from 'esengine';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { importGltfMeshes } from '../src/assets/gltfImport';
import type { ImportedMesh } from '../src/assets/modelImport';
import { dracoTriangle } from './fixtures/gltfFixtures.mjs';

interface SourceSet { joints: number[]; weights: number[] }
interface Accessor {
    bufferView?: number; componentType: number; count: number; type: string; normalized?: boolean;
    sparse?: { count: number; indices: { bufferView: number; componentType: number }; values: { bufferView: number } };
}

function fixture(sets: SourceSet[], weightType = 5126, jointType = 5123) {
    const parts: Buffer[] = [];
    const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
    const accessors: Accessor[] = [];
    let byteOffset = 0;
    const add = (values: number[], componentType: number, type: string, normalized = false) => {
        const pad = (4 - byteOffset % 4) % 4;
        parts.push(Buffer.alloc(pad));
        byteOffset += pad;
        const data = componentType === 5121 ? new Uint8Array(values)
            : componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
        bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength });
        parts.push(Buffer.from(data.buffer));
        byteOffset += data.byteLength;
        accessors.push({ bufferView: bufferViews.length - 1, componentType, count: 3, type, normalized });
        return accessors.length - 1;
    };
    const attributes: Record<string, number> = { POSITION: add([0, 0, 0, 1, 0, 0, 0, 1, 0], 5126, 'VEC3') };
    for (const [i, set] of sets.entries()) {
        attributes[`JOINTS_${i}`] = add(Array.from({ length: 3 }, () => set.joints).flat(), jointType, 'VEC4');
        attributes[`WEIGHTS_${i}`] = add(Array.from({ length: 3 }, () => set.weights).flat(), weightType, 'VEC4', weightType !== 5126);
    }
    const bytes = Buffer.concat(parts);
    return {
        asset: { version: '2.0' },
        buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
        bufferViews, accessors,
        meshes: [{ primitives: [{ attributes }] }],
        nodes: [{ name: 'Rig', children: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
            ...Array.from({ length: 8 }, (_, i) => ({ name: `Joint${i}` })), { name: 'Body', mesh: 0, skin: 0 }],
        skins: [{ joints: [1, 2, 3, 4, 5, 6, 7, 8] }], scenes: [{ nodes: [0] }], scene: 0,
    };
}

const encode = (doc: object) => new TextEncoder().encode(JSON.stringify(doc));
const normalSet = { joints: [0, 1, 0, 0], weights: [0.75, 0.25, 0, 0] };
const eightWeights = [
    { joints: [0, 1, 2, 3], weights: [0.05, 0.1, 0.15, 0.2] },
    { joints: [4, 5, 6, 7], weights: [0.3, 0.12, 0.05, 0.03] },
];

function influences(mesh: ImportedMesh, vertex = 0) {
    const joints = mesh.data.channels.find(c => c.semantic === MeshChannel.Joints)!;
    const weights = mesh.data.channels.find(c => c.semantic === MeshChannel.Weights)!;
    expect(joints).toMatchObject({ components: 4, type: MeshChannelType.UInt16 });
    expect(weights).toMatchObject({ components: 4, type: MeshChannelType.Float32 });
    const view = new DataView(mesh.data.vertices.buffer, mesh.data.vertices.byteOffset);
    const base = vertex * mesh.data.vertexStride;
    return Array.from({ length: 4 }, (_, c) => ({
        joint: view.getUint16(base + joints.offset + c * 2, true),
        weight: view.getFloat32(base + weights.offset + c * 4, true),
    }));
}

function expectRigidTranslation(mesh: ImportedMesh) {
    const position = mesh.data.channels.find(c => c.semantic === MeshChannel.Position)!;
    const view = new DataView(mesh.data.vertices.buffer, mesh.data.vertices.byteOffset);
    for (let v = 0; v < mesh.vertexCount; v++) {
        const skin = influences(mesh, v);
        for (const [axis, translation] of [17, -24, 8].entries()) {
            const p = view.getFloat32(v * mesh.data.vertexStride + position.offset + axis * 4, true);
            const posed = skin.reduce((sum, influence) => sum + influence.weight * (p + translation), 0);
            expect(posed).toBeCloseTo(p + translation, 5);
        }
    }
}

async function expectStatic(doc: object, warning: RegExp) {
    const result = await importGltfMeshes(encode(doc), 'skin');
    expect(result.meshes).toHaveLength(1);
    const mesh = result.meshes[0]!;
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.triangleCount).toBe(1);
    expect(mesh.data.channels.some(c => c.semantic === MeshChannel.Joints || c.semantic === MeshChannel.Weights)).toBe(false);
    expect(mesh.skinJoints).toBeUndefined();
    expect(mesh.data.inverseBindMatrices).toBeUndefined();
    expect(result.warnings.some(w => warning.test(w) && w.includes('imported static'))).toBe(true);
}

describe('glTF skin weight normalization', () => {
    it('keeps the strongest four across sets and preserves a rigid translation', async () => {
        const result = await importGltfMeshes(encode(fixture(eightWeights)), 'skin');
        const skin = influences(result.meshes[0]!);
        expect(skin.map(x => x.joint)).toEqual([4, 3, 2, 5]);
        for (const [i, w] of [0.3, 0.2, 0.15, 0.12].entries()) expect(skin[i]!.weight).toBeCloseTo(w / 0.77, 6);
        expectRigidTranslation(result.meshes[0]!);
        expect(result.warnings.some(w => /3 vertices exceed four.*23.00%/.test(w))).toBe(true);
    });

    it('reads a third set without reporting loss when only three joints contribute', async () => {
        const doc = fixture([
            { joints: [0, 0, 0, 0], weights: [0.25, 0, 0, 0] },
            { joints: [5, 0, 0, 0], weights: [0.25, 0, 0, 0] },
            { joints: [7, 0, 0, 0], weights: [0.5, 0, 0, 0] },
        ]);
        const result = await importGltfMeshes(encode(doc), 'skin');
        expect(influences(result.meshes[0]!)).toEqual([
            { joint: 0, weight: 0.25 }, { joint: 5, weight: 0.25 }, { joint: 7, weight: 0.5 }, { joint: 0, weight: 0 },
        ]);
        expect(result.warnings).toEqual([]);
        expectRigidTranslation(result.meshes[0]!);
    });

    it('merges duplicate joints before selecting the strongest four', async () => {
        const result = await importGltfMeshes(encode(fixture([
            { joints: [3, 1, 2, 0], weights: [0.1, 0.2, 0.2, 0.2] },
            { joints: [3, 4, 0, 0], weights: [0.2, 0.1, 0, 0] },
        ])), 'skin');
        const skin = influences(result.meshes[0]!);
        expect(skin.map(x => x.joint)).toEqual([3, 1, 2, 0]);
        expect(skin[0]!.weight).toBeCloseTo(1 / 3, 6);
        expect(result.warnings.some(w => /merged duplicate joint/.test(w))).toBe(true);
        expectRigidTranslation(result.meshes[0]!);
    });

    it('breaks equal-weight ties in source order', async () => {
        const result = await importGltfMeshes(encode(fixture([
            { joints: [7, 6, 5, 4], weights: [0.2, 0.2, 0.2, 0.2] },
            { joints: [3, 0, 0, 0], weights: [0.2, 0, 0, 0] },
        ])), 'skin');
        expect(influences(result.meshes[0]!).map(x => x.joint)).toEqual([7, 6, 5, 4]);
        expectRigidTranslation(result.meshes[0]!);
    });

    it.each([5126, 5121, 5123])('normalizes component type %i without shrinking the mesh', async weightType => {
        const weights = weightType === 5126 ? [0.3, 0.2, 0, 0]
            : weightType === 5121 ? [80, 174, 0, 0] : [10000, 50000, 0, 0];
        const result = await importGltfMeshes(encode(fixture([{ joints: [1, 6, 0, 0], weights }], weightType, 5121)), 'skin');
        const skin = influences(result.meshes[0]!);
        expect(skin[0]!.weight).toBeCloseTo(weights[0]! / (weights[0]! + weights[1]!), 6);
        expectRigidTranslation(result.meshes[0]!);
        expect(result.warnings.some(w => /normalized non-unit skin weights on 3 vertices/.test(w))).toBe(true);
    });

    it('zeroes unused joint indices so zero-weight shader fetches stay within the palette', async () => {
        const result = await importGltfMeshes(encode(fixture([
            { joints: [1, 65535, 400, 8], weights: [1, 0, 0, 0] },
        ])), 'skin');
        expect(influences(result.meshes[0]!)).toEqual([
            { joint: 1, weight: 1 }, { joint: 0, weight: 0 }, { joint: 0, weight: 0 }, { joint: 0, weight: 0 },
        ]);
    });

    it.each([NaN, Infinity, -0.1, 0])('preserves static geometry for unusable weight %s', async weight => {
        await expectStatic(fixture([{ joints: [0, 1, 0, 0], weights: [weight, 0, 0, 0] }]), /skin weight/);
    });

    it('preserves static geometry when a positive weight names an unbound joint', async () => {
        await expectStatic(fixture([{ joints: [8, 0, 0, 0], weights: [1, 0, 0, 0] }]), /outside the skin/);
    });

    it.each(['count', 'shape', 'joint type', 'weight type', 'joint normalization', 'weight normalization', 'missing accessor', 'missing bytes'])
    ('preserves static geometry for invalid %s', async failure => {
        const doc = fixture([normalSet]);
        if (failure === 'count') doc.accessors[2]!.count = 2;
        if (failure === 'shape') doc.accessors[2]!.type = 'VEC3';
        if (failure === 'joint type') doc.accessors[1]!.componentType = 5126;
        if (failure === 'weight type') doc.accessors[2]!.componentType = 5122;
        if (failure === 'joint normalization') doc.accessors[1]!.normalized = true;
        if (failure === 'weight normalization') doc.accessors[2]!.componentType = 5121;
        if (failure === 'missing accessor') doc.meshes[0]!.primitives[0]!.attributes.WEIGHTS_0 = 99;
        if (failure === 'missing bytes') doc.bufferViews[2]!.byteLength = 4;
        await expectStatic(doc, /invalid skin/);
    });

    it.each(['unpaired', 'gap', 'leading zero'])('does not silently omit a %s additional set', async failure => {
        const doc = fixture(eightWeights);
        const attributes = doc.meshes[0]!.primitives[0]!.attributes;
        if (failure !== 'unpaired') {
            const suffix = failure === 'gap' ? '2' : '01';
            attributes[`JOINTS_${suffix}`] = attributes.JOINTS_1!;
            attributes[`WEIGHTS_${suffix}`] = attributes.WEIGHTS_1!;
            delete attributes.JOINTS_1;
        }
        delete attributes.WEIGHTS_1;
        await expectStatic(doc, /paired/);
    });

    it('uses sparse values in additional weight sets', async () => {
        const doc = fixture(eightWeights);
        const expected = await importGltfMeshes(encode(doc), 'skin');
        const indexView = doc.bufferViews.length;
        doc.buffers.push({ byteLength: 3, uri: 'data:application/octet-stream;base64,AAEC' });
        doc.bufferViews.push({ buffer: 1, byteOffset: 0, byteLength: 3 });
        const acc = doc.accessors[4]!;
        acc.sparse = { count: 3, indices: { bufferView: indexView, componentType: 5121 }, values: { bufferView: acc.bufferView! } };
        delete acc.bufferView;
        const result = await importGltfMeshes(encode(doc), 'skin');
        expect(result.meshes[0]!.data.vertices).toEqual(expected.meshes[0]!.data.vertices);
        expectRigidTranslation(result.meshes[0]!);
    });

    it('uses the same reduction for meshopt-compressed skin attributes', async () => {
        const doc = fixture(eightWeights);
        const expected = await importGltfMeshes(encode(doc), 'skin');
        const bytes = Buffer.from(doc.buffers[0]!.uri.split(',')[1]!, 'base64');
        await MeshoptEncoder.ready;
        const bufferViews = doc.bufferViews.map(view => {
            const stride = view.byteLength / 3;
            const encoded = MeshoptEncoder.encodeVertexBuffer(bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength), 3, stride);
            const buffer = doc.buffers.length;
            doc.buffers.push({ byteLength: encoded.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(encoded).toString('base64')}` });
            return { ...view, extensions: { EXT_meshopt_compression: {
                buffer, byteOffset: 0, byteLength: encoded.byteLength, byteStride: stride, count: 3, mode: 'ATTRIBUTES',
            } } };
        });
        const result = await importGltfMeshes(encode({ ...doc, bufferViews, extensionsRequired: ['EXT_meshopt_compression'] }), 'skin');
        expect(result.meshes[0]!.data.vertices).toEqual(expected.meshes[0]!.data.vertices);
        expectRigidTranslation(result.meshes[0]!);
    });

    it.each([false, true])('reads Draco geometry with additional uncompressed skin sets: %s', async mixed => {
        const plain = fixture(eightWeights);
        const extra: Record<string, { componentType: number; values: number[] }> = {};
        for (const [i, set] of eightWeights.entries()) {
            if (mixed && i === 1) continue;
            extra[`JOINTS_${i}`] = { componentType: 5123, values: Array.from({ length: 3 }, () => set.joints).flat() };
            extra[`WEIGHTS_${i}`] = { componentType: 5126, values: Array.from({ length: 3 }, () => set.weights).flat() };
        }
        const packed = JSON.parse(new TextDecoder().decode(await dracoTriangle(extra))) as ReturnType<typeof fixture>;
        const doc = { ...plain, ...packed, nodes: plain.nodes, skins: plain.skins, scenes: plain.scenes };
        if (mixed) {
            const buffer = doc.buffers.length;
            doc.buffers.push(plain.buffers[0]!);
            for (const name of ['JOINTS_1', 'WEIGHTS_1']) {
                const source = plain.accessors[plain.meshes[0]!.primitives[0]!.attributes[name]!]!;
                doc.meshes[0]!.primitives[0]!.attributes[name] = doc.accessors.length;
                doc.accessors.push({ ...source, bufferView: doc.bufferViews.length });
                doc.bufferViews.push({ ...plain.bufferViews[source.bufferView!]!, buffer });
            }
        }
        const result = await importGltfMeshes(encode(doc), 'skin');
        expect(result.meshes).toHaveLength(1);
        expect(influences(result.meshes[0]!).map(x => x.joint)).toEqual([4, 3, 2, 5]);
        expectRigidTranslation(result.meshes[0]!);
        expect(result.warnings.some(w => /imported static|skipped/.test(w))).toBe(false);
    });
});
