// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TransformEpoch.hpp
 * @brief   The words that say composed world transforms are stale, apart from the composer so the registry can say it too
 */
#pragma once

#include "../core/Types.hpp"

namespace esengine::ecs {

/**
 * @brief How many times a transform composition INPUT has changed
 * @details One shared counter, written by every producer of a local transform
 *          field or of the hierarchy, on either side of the wasm boundary.
 * @note Modulo 2^32: aliasing needs 2^32 invalidations between two compositions.
 */
inline u32* transformEpochWords() {
    static u32 words[2] = {1, 0};
    return words;
}
inline u32& transformMutationEpoch() { return transformEpochWords()[0]; }

/**
 * @brief How many times a producer has written a local transform WITHOUT stamping it
 * @details The word after transformMutationEpoch, so a script reaches both through one address. Composition recomposes only
 *          what was stamped; when this has moved, it cannot know what was written and composes everything.
 */
inline u32& transformUnstampedEpoch() { return transformEpochWords()[1]; }

/**
 * @brief Say that composed world transforms are stale
 * @details Never call this from a writer of worldPosition/worldRotation/
 *          worldScale: those are the composition's OUTPUT, and invalidating on
 *          them makes every composition immediately stale again.
 */
inline void invalidateTransformComposition() { transformMutationEpoch()++; }

/** @brief Say that local transforms were written with no stamp saying which: the next composition composes everything. */
inline void invalidateUnstampedTransforms() {
    transformMutationEpoch()++;
    transformUnstampedEpoch()++;
}

}  // namespace esengine::ecs
