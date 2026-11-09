// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  voxelSupport.ts — what a build that ships volumes tells the core.
 *
 * A call, not a file's side effect — see tilemap/tilemapSupport.ts.
 */
import { addEntryPlugin } from '../runtime/entryPlugins';
import { makeBuiltinShaderTemplate, MODEL, registerBuiltinShaderTemplate } from '../render/builtinShaders';
import { deriveVoxelGround } from './voxelShader';
import { VoxelPlugin } from './voxelPlugin';

export function registerVoxelSupport(): void {
    registerBuiltinShaderTemplate(makeBuiltinShaderTemplate('voxel-ground', 'Voxel Ground',
        'Model, for ground with no uv: up to four materials weighted by the vertex colour, each laid from the three sides by world position.', deriveVoxelGround(MODEL)));
    addEntryPlugin('voxel', () => new VoxelPlugin());
}
