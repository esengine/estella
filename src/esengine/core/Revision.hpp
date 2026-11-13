// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Revision.hpp
 * @brief   What a resource's content is, as a number that changes whenever it does.
 *
 * @details A mesh, a material, a texture, a probe grid each carry a revision: taken from here when their content is made and
 *          again whenever it changes. A reader that keeps what it derived from one (the renderer's per-entity record of a draw)
 *          keeps the revision beside it and asks again only when the revision moved. One counter for every kind, so a revision
 *          is unique across them all: a released resource whose memory or slot a new one reuses is never taken for it.
 *
 *          The engine's components say the same of themselves with change stamps (Registry::changedSince); resources are not in
 *          the registry, so they say it here.
 */
#pragma once

#include "Types.hpp"

#include <atomic>

namespace esengine {

/** @brief A revision no content has had before. Never 0, which reads as "none". */
inline u64 nextRevision() {
    static std::atomic<u64> next{0};
    return ++next;
}

}  // namespace esengine
