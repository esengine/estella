// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Decals: the surface under a projector, cut to its box and drawn again.
 */
export {
    clipToProjector, projectorUV, DEFAULT_FACING_COSINE, CLIP_EPSILON,
    type ClipVertex, type ClipTriangle,
} from './clip';
export { bakeDecalMesh, receiverFromMesh, type DecalReceiver, type DecalBakeOptions } from './bake';
export { DecalProjector, type DecalProjectorData } from './components';
