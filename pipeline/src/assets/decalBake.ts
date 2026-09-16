// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Decal bake: the surfaces under a projector become one mesh asset.
 *
 * The same shape as the lightmap bake beside it — the computation is the SDK's
 * and this reads the files it needs. What comes out is ordinary geometry, so
 * nothing downstream of it has to know a decal was involved.
 */
import { readFileSync } from 'node:fs';
import {
    bakeDecalMesh, receiverFromMesh, decodeMesh, encodeMesh, builtinMeshTemplate,
    type DecalReceiver, type MeshData,
} from 'esengine';

/** One placed object the projector may print on. */
export interface DecalBakeSurface {
    /** Absolute path of the `.esmesh` it draws, or '' when {@link builtinRef} names it. */
    meshFile: string;
    /** `builtin:<id>` for stock geometry, which is built from code. */
    builtinRef?: string;
    /** How it is named where a warning has to be readable. */
    label: string;
    /** Column-major 4x4 world transform. */
    transform: number[];
}

export interface DecalBakeInput {
    /** Column-major 4x4 world transform of the projector. Its unit cube is the box. */
    projector: number[];
    surfaces: DecalBakeSurface[];
    /** How squarely a surface must face the projector. @see DEFAULT_FACING_COSINE */
    facing?: number;
}

export interface DecalBakeResult {
    /** The decal's geometry in the projector's space, or null when it covers nothing. */
    mesh: MeshData | null;
    /** Encoded `.esmesh` bytes for {@link mesh}, or null with it. */
    bytes: Uint8Array | null;
    /** How many surfaces contributed, and what could not be read. */
    received: number;
    warnings: string[];
}

/** Stock geometry, built once per ref rather than per surface that names it. */
function builtinGeometry(ref: string, cache: Map<string, MeshData | null>): MeshData | null {
    if (!cache.has(ref)) cache.set(ref, builtinMeshTemplate(ref)?.build() ?? null);
    return cache.get(ref) ?? null;
}

/** Cut the surfaces to the projector's box. */
export function bakeSceneDecal(input: DecalBakeInput): DecalBakeResult {
    const warnings: string[] = [];
    const receivers: DecalReceiver[] = [];
    const builtins = new Map<string, MeshData | null>();

    for (const s of input.surfaces) {
        let mesh: MeshData | null = null;
        try {
            mesh = s.builtinRef ? builtinGeometry(s.builtinRef, builtins)
                                : decodeMesh(new Uint8Array(readFileSync(s.meshFile)));
        } catch (err) {
            warnings.push(`${s.label}: ${(err as Error).message}`);
            continue;
        }
        if (!mesh) {
            warnings.push(`${s.label}: "${s.builtinRef}" is not stock geometry this build has`);
            continue;
        }
        const receiver = receiverFromMesh(mesh, s.transform);
        if (!receiver) {
            warnings.push(`${s.label}: its geometry carries no positions`);
            continue;
        }
        receivers.push(receiver);
    }

    const mesh = bakeDecalMesh(receivers, input.projector, { facing: input.facing });
    return {
        mesh,
        bytes: mesh ? encodeMesh(mesh) : null,
        received: receivers.length,
        warnings,
    };
}
