// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  pose.ts — the `pose` step: a body held in a pose, for a picture or a prop that never moves.
 *
 *        A character in a game keeps her bones and takes her pose from a clip. This is the same clip's first moment
 *        pressed into the surface, by the same weights, so a still and a game agree and a pose is an edit to some angles
 *        rather than to a drawing.
 */
import { HUMANOID_TAGS } from './humanoid';
import { poseClip, type PoseParams } from '../../../sdk/src/image/figureSkeleton';

export { poseJoints, poseFrames, type PoseParams } from '../../../sdk/src/image/figureSkeleton';
import { compact, type PolyMesh } from './polyMesh';
import { computeWornWeights, posedPositions, type SkinWeights } from './rig';

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
