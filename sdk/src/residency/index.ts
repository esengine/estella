// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   World residency: what exists, and why it exists right now.
 */

export {
    StreamedWorld, WorldPersistent, WorldStreamingSource,
    type StreamedWorldData, type WorldStreamingSourceData,
} from './components';
export {
    desiredResidency, distanceToCell,
    type WorldCell, type WorldManifest, type ResidencySource, type ResidencyDecision,
} from './cells';
export {
    WorldStreamer, WorldStreaming,
    type CellResidency, type WorldStreamHost, type WorldStreamerStatus,
} from './WorldStreamer';
export { worldResidencyPlugin, worldResidencySystem } from './residencyPlugin';
export { worldResidencyReport, type WorldResidencyReport } from './report';
export { persistentEntityRows, stableEntityId } from './identity';
