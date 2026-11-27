// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   World residency: what exists, and why it exists right now.
 */

export {
    StreamedWorld, StreamPlane, WorldPersistent, WorldStreamingSource, ExcludeFromFarProxy,
    type StreamedWorldData, type WorldStreamingSourceData,
} from './components';
export {
    desiredResidency, distanceToCell, cellAt, cellSquare, manifestPlane, planeSecond,
    type WorldCell, type WorldManifest, type ResidencySource, type ResidencyDecision,
} from './cells';
export {
    WorldStreamer, WorldStreaming, DEFAULT_STREAMING_POLICY,
    type CellResidency, type WorldStreamHost, type WorldStreamerStatus, type CellDelivery,
    type StreamingPolicy, type SlowStreamingPolicy,
} from './WorldStreamer';
export { worldResidencyPlugin, worldResidencySystem } from './residencyPlugin';
export { worldCellDocumentPath, worldResidencyReport, type WorldResidencyReport } from './report';
export { persistentEntityRows, stableEntityId } from './identity';
export {
    partitionWorld,
    type PartitionOptions, type PartitionedCell, type PrefabRoot, type WorldPartition,
} from './partitionWorld';
export {
    cutWorld, cellDocumentPath, worldManifestPath, WORLD_DIR,
    prefabRootOf, resolvePrefabRoots, type CutWorld,
} from './cutWorld';
export { registryEntityFields } from './componentRefs';
export {
    RememberState, WorldMemory, WorldMemoryRes, type RememberStateData, type WorldMemoryData,
} from './worldMemory';
export {
    farProxySettings, farProxySurfaces, farProxyPath, farProxyMeshPath, farProxySceneName, groupFarProxy, assembleFarProxies, deferFarProxies,
    createFarProxyBuilder,
    type FarProxySettings, type FarProxySurface, type FarProxySkip, type FarProxyPart, type FarProxyGroup, type FarProxyHost,
    type AssembledFarProxy,
} from './farProxy';
export {
    ProceduralChunks, ProceduralChunksRes, chunksOf, streamingSourcesOf,
    type ChunkLayer, type ChunkSource, type ChunkState, type ChunkLayerStatus,
} from './chunks';
