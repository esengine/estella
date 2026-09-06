// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ShadowPlan.hpp
 * @brief   What each caster asked the shadow atlas for, and what it got.
 *
 * @details A caster the atlas could not fit kept no tiles and cast nothing, and
 *          the frame counted the tiles it DID hand out. So "why does this object
 *          have no shadow" had no answer anywhere in the engine — not a missing
 *          panel, a missing fact.
 *
 *          Header-only and free of the renderer, like LodSelection.hpp: the
 *          giving-way rule is the part worth holding to a criterion, and it
 *          needs no device to be wrong.
 */
#pragma once

#include "../../core/Types.hpp"
#include "./ShadowAtlas.hpp"

#include <vector>

namespace esengine {

/**
 * @brief One caster's claim on the atlas: what it wanted, what it kept, and why
 *        the difference.
 *
 * @details `granted < requested` with no refusal is impossible — something gave
 *          way and the reason is the whole point of recording this.
 */
struct ShadowGrant {
    /// The light that asked. Carried so a reader can name it rather than an index.
    Entity light{};
    /// Tiles asked for: a sun's cascade set, a cube's six faces, or one.
    u32 requested = 0;
    /// Tiles kept. 0 means this light casts no shadow at all this frame.
    u32 granted = 0;
    /// Why it did not get what it asked for, from the FIRST attempt that failed —
    /// which is the answer to "why not what I asked", not "why not one less".
    AtlasRefusal refusal = AtlasRefusal::None;

    bool denied() const { return granted == 0; }
    bool reduced() const { return granted > 0 && granted < requested; }
};

/** @brief The frame's whole shadow allocation, as numbers something outside it can check. */
struct ShadowPlanReport {
    u32 atlasSize = 0;
    u32 cellSize = 0;
    u32 requestedTiles = 0;
    u32 grantedTiles = 0;
    std::vector<ShadowGrant> grants;

    void clear() {
        requestedTiles = 0;
        grantedTiles = 0;
        grants.clear();
    }

    u32 deniedCasters() const {
        u32 n = 0;
        for (const ShadowGrant& g : grants) n += g.denied() ? 1u : 0u;
        return n;
    }

    u32 reducedCasters() const {
        u32 n = 0;
        for (const ShadowGrant& g : grants) n += g.reduced() ? 1u : 0u;
        return n;
    }
};

/**
 * @brief Claim as much of @p want as the atlas will give, down to one tile.
 *
 * @details A sun settles for fewer rather than costing a positional light the map
 *          it cannot shorten. Giving way and RECORDING what it gave way from are
 *          one function, so a caller cannot take the first without the second.
 */
inline ShadowGrant claimTiles(ShadowAtlas& atlas, Entity light, u32 want, u32 cells,
                              i32& outFirst) {
    ShadowGrant grant{light, want, 0, AtlasRefusal::None};
    outFirst = -1;
    for (u32 take = want; take > 0; --take) {
        AtlasRefusal why = AtlasRefusal::None;
        const i32 at = atlas.allocate(take, cells, why);
        if (at >= 0) {
            outFirst = at;
            grant.granted = take;
            return grant;
        }
        // The first refusal is the one that answers the question a reader has.
        if (take == want) grant.refusal = why;
    }
    return grant;
}

}  // namespace esengine
