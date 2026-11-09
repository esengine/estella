// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rigBake.ts
 * @brief   What a scene draws of a rig: its `.esmesh`, and the skin that same geometry takes in a preview.
 *
 * @details One mesh, the parts laid down in draw order: a blended mesh draws in index order, so that order IS how a limb goes behind
 *          the body, and the whole character is one draw. Joint i of the mesh is bone i of the rig, so what binds it is the order of the bones.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { rigVertex } from './rigMesh';
import { checkRig, rigBoneWorlds, type RigBoneWorld, type RigSource } from './rigSource';

/** Turns a rig into mesh data, refusing one {@link checkRig} refuses or that has no bones to follow. @experimental */
export function bakeRig(rig: RigSource): MeshData {
    const problems = checkRig(rig);
    if (rig.bones.length === 0) problems.push('it has no bones');
    for (const part of rig.parts) {
        if (part.weights.some(w => w.length === 0)) problems.push(`part "${part.name}" has vertices that follow no bone`);
    }
    if (problems.length > 0) throw new Error(`this rig cannot be baked: ${problems.join('; ')}`);

    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Joints, components: 4, type: MeshChannelType.UInt16 },
        { semantic: MeshChannel.Weights, components: 4, type: MeshChannelType.Float32 },
    ]);
    const offsetOf = (semantic: number): number => channels.find(c => c.semantic === semantic)!.offset;
    const positionAt = offsetOf(MeshChannel.Position), uvAt = offsetOf(MeshChannel.TexCoord0);
    const jointsAt = offsetOf(MeshChannel.Joints), weightsAt = offsetOf(MeshChannel.Weights);

    const vertexCount = rig.parts.reduce((total, p) => total + p.vertices.length / 2, 0);
    const bytes = new Uint8Array(vertexCount * vertexStride), view = new DataView(bytes.buffer);
    const indices: number[] = [], partBase = new Map<string, number>();
    const min: [number, number, number] = [Infinity, Infinity, 0], max: [number, number, number] = [-Infinity, -Infinity, 0];
    let base = 0;
    for (const part of rig.parts) {
        partBase.set(part.name, base);
        for (let v = 0; v < part.vertices.length / 2; v++) {
            const at = (base + v) * vertexStride, p = rigVertex(rig, part, v), w = part.weights[v]!;
            view.setFloat32(at + positionAt, p.x, true);
            view.setFloat32(at + positionAt + 4, p.y, true);
            view.setFloat32(at + uvAt, (part.rect.x + part.vertices[v * 2]!) / rig.textureWidth, true);
            // A texture's v runs up the image: row 0 of the file is v = 1.
            view.setFloat32(at + uvAt + 4, 1 - (part.rect.y + part.vertices[v * 2 + 1]!) / rig.textureHeight, true);
            let sum = 0;
            for (let i = 1; i < w.length; i += 2) sum += w[i]!;
            for (let i = 0; i < w.length; i += 2) {
                view.setUint16(at + jointsAt + i, w[i]!, true);
                view.setFloat32(at + weightsAt + i * 2, sum > 0 ? w[i + 1]! / sum : 0, true);
            }
            min[0] = Math.min(min[0], p.x); min[1] = Math.min(min[1], p.y);
            max[0] = Math.max(max[0], p.x); max[1] = Math.max(max[1], p.y);
        }
        for (const t of part.triangles) indices.push(base + t);
        base += part.vertices.length / 2;
    }

    const inverseBindMatrices = new Float32Array(rig.bones.length * 16);
    rigBoneWorlds(rig.bones).forEach((w, i) => {
        const c = Math.cos(w.rotation), s = Math.sin(w.rotation);
        inverseBindMatrices.set([c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, -(c * w.x + s * w.y), s * w.x - c * w.y, 0, 1], i * 16);
    });

    const mesh: MeshData = {
        channels, vertexStride, vertexCount, vertices: bytes, indices: new Uint32Array(indices),
        aabbMin: vertexCount > 0 ? min : [0, 0, 0], aabbMax: vertexCount > 0 ? max : [0, 0, 0], inverseBindMatrices,
    };
    if (rig.deforms.length > 0) {
        const deltas = new Float32Array(rig.deforms.length * vertexCount * 3);
        rig.deforms.forEach((deform, target) => {
            for (const [name, offsets] of Object.entries(deform.offsets)) {
                const start = partBase.get(name)!;
                for (let i = 0; i < offsets.length; i += 3) {
                    const at = (target * vertexCount + start + offsets[i]!) * 3;
                    deltas[at] = offsets[i + 1]!;
                    deltas[at + 1] = offsets[i + 2]!;
                }
            }
        });
        mesh.morph = { names: rig.deforms.map(d => d.name), hasNormals: false, deltas };
        // A shape can reach past the rest pose, and the box is what the mesh is culled by. All of them at once is the most it can be.
        let reach = 0;
        rig.deforms.forEach((_, target) => {
            let most = 0;
            for (let v = 0; v < vertexCount; v++) {
                const at = (target * vertexCount + v) * 3;
                most = Math.max(most, Math.abs(deltas[at]!), Math.abs(deltas[at + 1]!));
            }
            reach += most;
        });
        mesh.aabbMin = [mesh.aabbMin[0] - reach, mesh.aabbMin[1] - reach, 0];
        mesh.aabbMax = [mesh.aabbMax[0] + reach, mesh.aabbMax[1] + reach, 0];
    }
    return mesh;
}

/**
 * Where every vertex of one part lands, flat `[x, y, ...]` in rig space, by the same sum the shader does: deform first, then skin.
 * What an authoring view draws, so what it shows is what the game will.
 * @experimental
 */
export function skinRigPart(rig: RigSource, partIndex: number, posed: readonly RigBoneWorld[], deformWeights?: ArrayLike<number>): Float32Array {
    const part = rig.parts[partIndex]!, bind = rigBoneWorlds(rig.bones), count = part.vertices.length / 2;
    const offset = new Float32Array(count * 2);
    rig.deforms.forEach((deform, d) => {
        const weight = deformWeights?.[d] ?? 0, offsets = deform.offsets[part.name];
        if (!weight || !offsets) return;
        for (let i = 0; i < offsets.length; i += 3) {
            offset[offsets[i]! * 2]! += offsets[i + 1]! * weight;
            offset[offsets[i]! * 2 + 1]! += offsets[i + 2]! * weight;
        }
    });
    const out = new Float32Array(count * 2);
    for (let v = 0; v < count; v++) {
        const at = rigVertex(rig, part, v), w = part.weights[v]!;
        const px = at.x + offset[v * 2]!, py = at.y + offset[v * 2 + 1]!;
        if (w.length === 0) { out[v * 2] = px; out[v * 2 + 1] = py; continue; }
        let x = 0, y = 0, sum = 0;
        for (let i = 0; i < w.length; i += 2) {
            const from = bind[w[i]!]!, to = posed[w[i]!]!, weight = w[i + 1]!;
            const dx = px - from.x, dy = py - from.y, turn = to.rotation - from.rotation, c = Math.cos(turn), s = Math.sin(turn);
            x += (to.x + c * dx - s * dy) * weight;
            y += (to.y + s * dx + c * dy) * weight;
            sum += weight;
        }
        out[v * 2] = sum > 0 ? x / sum : px;
        out[v * 2 + 1] = sum > 0 ? y / sum : py;
    }
    return out;
}
