// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SpriteMaskRange.hpp
 * @brief   Which SpriteMask, if any, cuts a sprite — the rule, apart from the frame.
 * @details A mask reaches FORWARD: it cuts what is drawn after it, because that is the
 *          order the stencil is written in and the order the author already arranges by
 *          layer and order. Pure so it can be held to cases directly; a frame can only
 *          show that some mask won, never which one the rule chose.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "./DrawList.hpp"

namespace esengine {

/// A SpriteMask's own place in the frame, how far it reaches, and the ref it stamps.
struct ResolvedMask {
    DrawList::SortIdentity at;
    DrawList::SortIdentity reachEnd;
    bool limited = false;
    i32 ref = 0;
};

/**
 * @brief Whether @p mask still covers a draw sitting at @p where.
 *
 * Strictly after: a mask and a sprite at the same place have no order between them, and
 * a stencil written by a draw that may come second cuts nothing reliably.
 */
inline bool maskReaches(const ResolvedMask& mask, const DrawList::SortIdentity& where) {
    if (!(mask.at < where)) return false;
    return !mask.limited || where <= mask.reachEnd;
}

/**
 * @brief The mask whose ref the stencil still holds at @p where, or null.
 *
 * @details The NEAREST reaching one, because it wrote last: where two masks overlap, the
 *          later write is what is in the buffer, so testing an earlier mask's ref would
 *          fail exactly inside the mask that covered it.
 */
inline const ResolvedMask* nearestReachingMask(
    const ResolvedMask* masks, u32 count, const DrawList::SortIdentity& where
) {
    const ResolvedMask* nearest = nullptr;
    for (u32 i = 0; i < count; ++i) {
        const ResolvedMask& mask = masks[i];
        if (mask.ref == 0 || !maskReaches(mask, where)) continue;
        if (!nearest || nearest->at < mask.at) nearest = &mask;
    }
    return nearest;
}

}  // namespace esengine