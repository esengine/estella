// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export {
    VoxelTerrain, VoxelTerrains, VoxelTerrainsRes, VoxelPlugin, voxelPlugin,
    type VoxelTerrainData, type VoxelTerrainStatus, type VoxelEditEvent,
} from './voxelPlugin';
export {
    VOXEL_MATERIALS, VoxelField,
    type VoxelEditOptions, type VoxelEditResult, type VoxelFieldData, type VoxelFieldOptions, type VoxelHit, type VoxelOp, type VoxelPoint, type VoxelSample, type VoxelShape, type VoxelSource,
} from './field';
export { heightVoxelSource, noiseVoxelSource, VoxelMaterial, type VoxelNoiseParams } from './source';
export { surfaceNets, type VoxelSurface } from './surfaceNets';

// Importing this subpath INSTALLS volumes — see tilemap/index.ts.
import { registerVoxelSupport } from './voxelSupport';

registerVoxelSupport();
