// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rootMotionExtract.ts
 * @brief   Turn the travel a clip keeps in its skeleton's top joint into a root track.
 *
 * @details The engine reads where a character GOES from a clip's root track: the position the clip states for the
 *          entity it plays on. Many rigs have no such track. A walk exported from them walks its hips away from the
 *          model's origin and snaps back at the loop, because the hips are the top of the skeleton and there is nothing
 *          above them to carry the travel.
 *
 *          This splits such a clip in two. What the top joint covers over the ground from the clip's first key to its
 *          last becomes a root track that covers it at one steady rate; the joint keeps the rest, which is its bob and
 *          sway about that steady line. The two add up to exactly the motion the clip had, so a foot that was planted
 *          stays planted, and a character moved by the root track at that rate does not slide.
 *
 *          A steady rate, and not the joint's own curve, because the joint is a pelvis and not a root: it swings from
 *          side to side and surges with every step, and a capsule that did the same would shake the camera riding it.
 *
 *          The root track is written in the model's own units and the root's own axes, before the root's scale: the
 *          animator applies the rig's rotation and scale when it reads it, so an instance scaled in a scene covers
 *          ground in proportion.
 */

import type { ImportedNode } from './modelImport';

interface Key { time: number; value: number; inTangent: number; outTangent: number; interpolation: string }
interface Channel { property: string; keyframes: Key[] }
interface Track { type: string; name?: string; childPath?: string; component?: string; channels?: Channel[] }

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

function rotate(q: Quat, v: Vec3): Vec3 {
    const [x, y, z, w] = q;
    const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
    return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
    ];
}
const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** The nodes from the prefab's root down to the one `childPath` names, the root first; null when a name is not there. */
function chainTo(nodes: readonly ImportedNode[], childPath: string): ImportedNode[] | null {
    // One source root IS the prefab's root; several hang under a holder the import adds, which has no transform of its own.
    const single = nodes.length === 1 && nodes[0] ? nodes[0] : null;
    const chain: ImportedNode[] = single ? [single] : [];
    let level: readonly ImportedNode[] = single ? single.children : nodes;
    for (const name of childPath.split('/')) {
        const next = level.find((n) => n.name === name);
        if (!next) return null;
        chain.push(next);
        level = next.children;
    }
    return chain;
}

const positionChannels = (track: Track): (Channel | undefined)[] =>
    ['position.x', 'position.y', 'position.z'].map((p) => track.channels?.find((c) => c.property === p));

const movesTransform = (track: Track): boolean => track.type === 'property' && track.component === 'Transform';

/** What an extraction did to one clip, for the import's report. */
export interface RootMotionExtraction {
    /** The joint the travel was taken from. */
    joint: string;
    /** How far the clip travels over the ground, in the model's own units. */
    distance: number;
    /** Seconds it takes to. */
    seconds: number;
}

/**
 * Move the ground travel of `document`'s top joint onto a root track. Changes the document in place and says what it
 * did, or returns a sentence saying why it left the clip as it was (null when the clip simply goes nowhere).
 */
export function extractRootMotion(
    document: Record<string, unknown>, nodes: readonly ImportedNode[], follow: 'steady' | 'path' = 'steady',
): RootMotionExtraction | string | null {
    const tracks = document.tracks as Track[] | undefined;
    if (!Array.isArray(tracks)) return null;

    // A clip that already says where its root goes was authored with a root; there is nothing to take from the skeleton.
    const root = tracks.find((t) => movesTransform(t) && (t.childPath ?? '') === '');
    if (root && positionChannels(root).some((c) => c && c.keyframes.length > 1)) return null;

    // The shallowest joint that is moved, not only turned: the top of the skeleton.
    let joint: Track | null = null;
    let depth = Infinity;
    for (const track of tracks) {
        if (!movesTransform(track) || !track.childPath) continue;
        if (!positionChannels(track).every((c) => c && c.keyframes.length > 1)) continue;
        const d = track.childPath.split('/').length;
        if (d < depth) { joint = track; depth = d; }
    }
    if (!joint) return null;
    const path = joint.childPath!;
    const [cx, cy, cz] = positionChannels(joint) as [Channel, Channel, Channel];
    const count = Math.min(cx.keyframes.length, cy.keyframes.length, cz.keyframes.length);
    const first = cx.keyframes[0]!.time, last = cx.keyframes[count - 1]!.time;
    if (!(last > first)) return null;

    const chain = chainTo(nodes, path);
    if (!chain) return `no root motion taken: "${path}" is not a node of this model`;
    // Everything between the root and the joint has to stand still, or what the joint covers is not what the model covers.
    const above = chain.slice(0, -1);
    const rootNode = nodes.length === 1 ? above[0] : undefined;
    const between = rootNode ? above.slice(1) : above;
    let prefix = '';
    for (const node of between) {
        prefix = prefix ? `${prefix}/${node.name}` : node.name;
        if (tracks.some((t) => movesTransform(t) && t.childPath === prefix)) {
            return `no root motion taken: "${prefix}", above "${path}", is animated too`;
        }
    }

    // Joint space to the root's own space: through each standing node between them, the nearest first.
    const toRoot = (v: Vec3): Vec3 => {
        let out = v;
        for (let i = between.length - 1; i >= 0; i--) {
            const n = between[i]!;
            out = rotate(n.rotation, [out[0] * n.scale[0], out[1] * n.scale[1], out[2] * n.scale[2]]);
        }
        return out;
    };
    const fromRoot = (v: Vec3): Vec3 => {
        let out = v;
        for (const n of between) {
            const r = rotate(conjugate(n.rotation), out);
            out = [r[0] / (n.scale[0] || 1), r[1] / (n.scale[1] || 1), r[2] / (n.scale[2] || 1)];
        }
        return out;
    };

    const start: Vec3 = [cx.keyframes[0]!.value, cy.keyframes[0]!.value, cz.keyframes[0]!.value];
    const end: Vec3 = [cx.keyframes[count - 1]!.value, cy.keyframes[count - 1]!.value, cz.keyframes[count - 1]!.value];
    const net = toRoot([end[0] - start[0], end[1] - start[1], end[2] - start[2]]);
    // Over the ground only: up, as the root's own axes see it, stays with the joint (a jump is a pose, not a journey).
    const up: Vec3 = rootNode ? rotate(conjugate(rootNode.rotation), [0, 1, 0]) : [0, 1, 0];
    const rise = net[0] * up[0] + net[1] * up[1] + net[2] * up[2];
    const travel: Vec3 = [net[0] - up[0] * rise, net[1] - up[1] * rise, net[2] - up[2] * rise];
    const distance = Math.hypot(travel[0], travel[1], travel[2]);
    // A clip that ends where it began goes nowhere: an idle, or a walk exported on the spot.
    const reach = Math.hypot(...toRoot(start));
    if (distance <= 0.01 * Math.max(reach, 1e-6)) return null;

    if (follow === 'path') {
        // The root goes where the joint goes over the ground, key by key: a clip whose pace changes (one that brakes to
        // a stop) keeps its pace in the root, which is what playing it by the distance left to travel reads.
        const keys: [Key[], Key[], Key[]] = [[], [], []];
        for (let i = 0; i < count; i++) {
            const at = toRoot([
                cx.keyframes[i]!.value - start[0], cy.keyframes[i]!.value - start[1], cz.keyframes[i]!.value - start[2],
            ]);
            const h = at[0] * up[0] + at[1] * up[1] + at[2] * up[2];
            const ground: Vec3 = [at[0] - up[0] * h, at[1] - up[1] * h, at[2] - up[2] * h];
            const back = fromRoot(ground);
            cx.keyframes[i]!.value -= back[0];
            cy.keyframes[i]!.value -= back[1];
            cz.keyframes[i]!.value -= back[2];
            const time = cx.keyframes[i]!.time;
            for (let k = 0; k < 3; k++) keys[k].push({ time, value: ground[k]!, inTangent: 0, outTangent: 0, interpolation: 'linear' });
        }
        const pathChannels: Channel[] = [
            { property: 'position.x', keyframes: keys[0] },
            { property: 'position.y', keyframes: keys[1] },
            { property: 'position.z', keyframes: keys[2] },
        ];
        if (root) (root.channels ??= []).push(...pathChannels);
        else tracks.unshift({ type: 'property', name: 'Root Motion', childPath: '', component: 'Transform', channels: pathChannels });
        return { joint: path, distance, seconds: last - first };
    }

    const inJoint = fromRoot(travel);
    for (let i = 0; i < count; i++) {
        const done = (cx.keyframes[i]!.time - first) / (last - first);
        cx.keyframes[i]!.value -= inJoint[0] * done;
        cy.keyframes[i]!.value -= inJoint[1] * done;
        cz.keyframes[i]!.value -= inJoint[2] * done;
    }

    const ramp = (to: number): Key[] => [
        { time: first, value: 0, inTangent: 0, outTangent: 0, interpolation: 'linear' },
        { time: last, value: to, inTangent: 0, outTangent: 0, interpolation: 'linear' },
    ];
    const channels: Channel[] = [
        { property: 'position.x', keyframes: ramp(travel[0]) },
        { property: 'position.y', keyframes: ramp(travel[1]) },
        { property: 'position.z', keyframes: ramp(travel[2]) },
    ];
    if (root) (root.channels ??= []).push(...channels);
    else tracks.unshift({ type: 'property', name: 'Root Motion', childPath: '', component: 'Transform', channels });
    return { joint: path, distance, seconds: last - first };
}
