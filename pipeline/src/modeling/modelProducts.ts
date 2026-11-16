// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  modelProducts.ts — what a bake leaves for whoever writes its files, as plain numbers and bytes.
 *
 *        A baked model holds its polygons, and a dense one is millions of small arrays: nothing to hand from one
 *        thread to another. What a writer needs of it is far less (the mesh as the bytes of its file, the maps, the
 *        joints' names and places), and that crosses a thread in one copy.
 */
import { encodeMesh } from '../../../sdk/src/asset/meshFormat';
import type { HairMaps } from './hair';
import type { BakedModel, ModelReport } from './modelBake';
import type { NormalMap } from './normalBake';
import type { Vec3 } from './polyMesh';
import type { RigJoint, RigSpring } from './rig';
import type { TreeBark } from './tree';

export interface ModelProducts {
    report: ModelReport;
    /** The `.esmesh` file's bytes. */
    mesh: Uint8Array;
    /** Present where the source has a normalBake. Its report and warnings are already in `report`. */
    normal: NormalMap | null;
    rig?: { joints: RigJoint[]; springs?: readonly RigSpring[] };
    /** The names of the source's shapes, in the order the mesh holds them. */
    shapes?: string[];
    hair?: { maps: HairMaps; chainRoots?: number[] };
    leaves?: boolean;
    bark?: TreeBark;
    /** A fractured model's pieces: each one's `.esmesh` bytes, and where its middle is in the model. */
    shards?: { center: Vec3; mesh: Uint8Array }[];
}

/** @p normal is the map baked from @p baked, where it has detail to bake. */
export function modelProductsOf(baked: BakedModel, normal: NormalMap | null): ModelProducts {
    if (normal) {
        baked.report.normalBake = normal.report;
        baked.report.warnings.push(...normal.warnings);
    }
    return {
        report: baked.report,
        mesh: encodeMesh(baked.data),
        normal,
        ...(baked.rig ? { rig: { joints: baked.rig.joints, ...(baked.rig.springs ? { springs: baked.rig.springs } : {}) } } : {}),
        ...(baked.shapes ? { shapes: baked.shapes.names } : {}),
        ...(baked.hair ? { hair: baked.hair } : {}),
        ...(baked.leaves ? { leaves: true } : {}),
        ...(baked.bark ? { bark: baked.bark } : {}),
        ...(baked.shards ? { shards: baked.shards.map((shard) => ({ center: shard.center, mesh: encodeMesh(shard.data) })) } : {}),
    };
}
