// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    strayJoints.ts
 * @brief   Vertices left bound to a joint nothing moves, given the binding of the vertices beside them.
 *
 * @details Some exporters add a joint beside the skeleton that no clip animates (one names it `neutral_bone`) and leave
 *          a few vertices bound wholly to it. In the bind pose nothing shows; once the character moves, those vertices
 *          stay where the joint is while the triangles they belong to go with the body, and each becomes a sliver
 *          drawn across the screen. A model whose clips animate the rest of its skin and never that joint is such a
 *          case: its vertices are bound the way the vertices sharing a triangle with them are.
 *
 *          Only a few: a joint that holds much of the mesh is a part of the model that simply does not move in these
 *          clips (a prop, a weapon at rest), and is left as it is.
 */

import { MeshChannel, MeshChannelType } from 'esengine';
import type { ImportedMesh, ImportedNode } from './modelImport';

/** The most of a mesh's vertices a stray joint may hold and still be taken for one. */
const STRAY_SHARE = 0.01;

interface Track { childPath?: string }

/** Every node's name by its source index. */
function namesByIndex(nodes: readonly ImportedNode[], out = new Map<number, string>()): Map<number, string> {
    for (const node of nodes) {
        out.set(node.index, node.name);
        namesByIndex(node.children, out);
    }
    return out;
}

/** Which nodes have children, by source index. */
function parents(nodes: readonly ImportedNode[], out = new Set<number>()): Set<number> {
    for (const node of nodes) {
        if (node.children.length) out.add(node.index);
        parents(node.children, out);
    }
    return out;
}

/**
 * Rebind the vertices of `meshes` held wholly by a stray joint, and say what was done. A joint is stray when the clips
 * animate other joints of the skin and never it, it has nothing under it, and it holds no more than a hundredth of
 * the mesh. Clips are the imported animation documents.
 */
export function rebindStrayVertices(
    meshes: ImportedMesh[], nodes: readonly ImportedNode[], documents: readonly Record<string, unknown>[],
): string[] {
    if (documents.length === 0) return [];
    const animated = new Set<string>();
    for (const document of documents) {
        for (const track of (document.tracks ?? []) as Track[]) {
            const path = track.childPath ?? '';
            if (path) animated.add(path.slice(path.lastIndexOf('/') + 1));
        }
    }
    const names = namesByIndex(nodes);
    const branching = parents(nodes);
    const notes: string[] = [];
    for (const mesh of meshes) {
        const joints = mesh.skinJoints;
        if (!joints?.length) continue;
        if (!joints.some((j) => animated.has(names.get(j) ?? ''))) continue;
        const stray = new Set<number>();
        joints.forEach((node, slot) => {
            if (!animated.has(names.get(node) ?? '') && !branching.has(node)) stray.add(slot);
        });
        if (stray.size === 0) continue;

        const data = mesh.data;
        const jc = data.channels.find((c) => c.semantic === MeshChannel.Joints);
        const wc = data.channels.find((c) => c.semantic === MeshChannel.Weights);
        if (!jc || !wc || jc.type !== MeshChannelType.UInt16 || wc.type !== MeshChannelType.Float32) continue;
        const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
        const at = (v: number, c: { offset: number }, k: number, size: number) => v * data.vertexStride + c.offset + k * size;
        const strayShare = (v: number): number => {
            let held = 0, total = 0;
            for (let k = 0; k < 4; k++) {
                const w = view.getFloat32(at(v, wc, k, 4), true);
                total += w;
                if (stray.has(view.getUint16(at(v, jc, k, 2), true))) held += w;
            }
            return total > 0 ? held / total : 0;
        };

        const lost: number[] = [];
        for (let v = 0; v < data.vertexCount; v++) if (strayShare(v) > 0.5) lost.push(v);
        if (lost.length === 0 || lost.length > data.vertexCount * STRAY_SHARE) continue;

        // A neighbour by triangle that is bound to the skeleton, for each lost vertex; failing that, the vertex nearest it.
        const lostSet = new Set(lost);
        const neighbour = new Map<number, number>();
        const ix = data.indices;
        for (let t = 0; t + 2 < ix.length; t += 3) {
            for (let e = 0; e < 3; e++) {
                const v = ix[t + e]!;
                if (!lostSet.has(v) || neighbour.has(v)) continue;
                for (let o = 1; o < 3; o++) {
                    const u = ix[t + (e + o) % 3]!;
                    if (!lostSet.has(u)) { neighbour.set(v, u); break; }
                }
            }
        }
        const pc = data.channels.find((c) => c.semantic === MeshChannel.Position)!;
        const position = (v: number): [number, number, number] =>
            [0, 1, 2].map((k) => view.getFloat32(at(v, pc, k, 4), true)) as [number, number, number];
        for (const v of lost) {
            if (neighbour.has(v)) continue;
            const p = position(v);
            let best = -1, bestDistance = Infinity;
            for (let u = 0; u < data.vertexCount; u++) {
                if (lostSet.has(u)) continue;
                const q = position(u);
                const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
                if (d < bestDistance) { bestDistance = d; best = u; }
            }
            if (best >= 0) neighbour.set(v, best);
        }
        let moved = 0;
        for (const v of lost) {
            const u = neighbour.get(v);
            if (u === undefined) continue;
            for (let k = 0; k < 4; k++) {
                view.setUint16(at(v, jc, k, 2), view.getUint16(at(u, jc, k, 2), true), true);
                view.setFloat32(at(v, wc, k, 4), view.getFloat32(at(u, wc, k, 4), true), true);
            }
            moved++;
        }
        const strayNames = [...stray].map((slot) => names.get(joints[slot]!) ?? `joint ${slot}`).join(', ');
        notes.push(`${mesh.name}: ${moved} vertices were bound to ${strayNames}, which no clip moves; bound as their neighbours are`);
    }
    return notes;
}
