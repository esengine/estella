// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pose.ts — the `pose` step: a body held in a pose, for a picture or a prop that never moves.
 *
 *        A character in a game keeps her bones and takes her pose from a clip. This is the same clip's first moment
 *        pressed into the surface, by the same weights, so a still and a game agree and a pose is an edit to some angles
 *        rather than to a drawing.
 */
import { HUMANOID_TAGS, humanoidJoints, type HumanoidBuild } from './humanoid';
import { compact, type PolyMesh, type Vec3 } from './polyMesh';
import { computeWornWeights, jointPositions, posedPositions, resolveJoints, type AnimationSource, type AnimationTrack, type RigJoint, type SkinWeights } from './rig';

export interface PoseParams {
    /** The bones of a humanoid of this build; true for the default one. */
    humanoid: HumanoidBuild | true;
    /** joint name to [x, y, z] degrees from its rest, X then Y then Z. */
    rotate?: Readonly<Record<string, readonly number[]>>;
    /** joint name to [x, y, z] from where it rests: `hips` lowers a sitting body. */
    move?: Readonly<Record<string, readonly number[]>>;
    /** joint name to where it must be, in the model's own space: a hand on a bow, a foot on the ground. The two bones above it turn to put it there; `pole` is the way the middle one bends. */
    reach?: Readonly<Record<string, { at: readonly number[]; pole?: readonly number[] }>>;
    /** The whole mesh rides on this one joint, whole: hair cards, which have no skin between them for weights to spread over. */
    rigid?: string;
}

/** A pose as the clip that holds it, on the bones it is for. */
function poseClip(p: PoseParams): { joints: RigJoint[]; animation: AnimationSource } {
    if (p.humanoid === undefined) throw new Error('`humanoid` says whose bones: true, or the build it was given');
    const joints: RigJoint[] = resolveJoints({ joints: humanoidJoints(p.humanoid === true ? {} : p.humanoid) });
    const names = new Set(joints.map((j) => j.name));
    const known = (name: string): void => {
        if (!names.has(name)) throw new Error(`no joint "${name}"; there are ${[...names].join(', ')}`);
    };
    const tracks = new Map<string, { rotate?: number[][]; move?: number[][]; reach?: number[][]; pole?: readonly number[] }>();
    for (const [name, r] of Object.entries(p.rotate ?? {})) {
        known(name);
        if (r.length !== 3) throw new Error(`rotate of "${name}" must be [x, y, z] degrees`);
        tracks.set(name, { rotate: [[0, r[0]!, r[1]!, r[2]!]] });
    }
    for (const [name, m] of Object.entries(p.move ?? {})) {
        known(name);
        if (m.length !== 3) throw new Error(`move of "${name}" must be [x, y, z]`);
        tracks.set(name, { ...tracks.get(name), move: [[0, m[0]!, m[1]!, m[2]!]] });
    }
    for (const [name, r] of Object.entries(p.reach ?? {})) {
        known(name);
        if (r.at?.length !== 3) throw new Error(`reach of "${name}" needs at: [x, y, z]`);
        tracks.set(name, { ...tracks.get(name), reach: [[0, r.at[0]!, r.at[1]!, r.at[2]!]], ...(r.pole ? { pole: r.pole } : {}) });
    }
    return { joints, animation: { name: 'pose', duration: 1, loop: false, tracks: [...tracks].map(([joint, t]) => ({ joint, ...t })) as AnimationTrack[] } };
}

/** Where each joint is in a pose, without the seconds a surface takes. */
export function poseJoints(p: PoseParams): Record<string, Vec3> {
    const { joints, animation } = poseClip(p);
    return jointPositions(joints, animation, 0);
}

export function poseStep(mesh: PolyMesh, p: PoseParams): PolyMesh {
    const { joints, animation } = poseClip(p);
    if (mesh.positions.length === 0) throw new Error('there is nothing yet to pose');
    let skin: SkinWeights;
    if (p.rigid !== undefined) {
        const j = joints.findIndex((q) => q.name === p.rigid);
        if (j < 0) throw new Error(`no joint "${p.rigid}"; there are ${joints.map((q) => q.name).join(', ')}`);
        const count = mesh.positions.length;
        const jointsOut = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
        for (let v = 0; v < count; v++) { jointsOut[v * 4] = j; weights[v * 4] = 1; }
        skin = { joints: jointsOut, weights, dominant: [] };
    } else {
        skin = computeWornWeights(mesh, joints, new Set(HUMANOID_TAGS));
    }
    return compact({ positions: posedPositions(mesh, joints, skin, animation, 0), faces: mesh.faces });
}
