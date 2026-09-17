// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GfxContent.hpp
 * @brief   Who restores a GPU object's contents after the device is lost.
 *
 * @details Declared when the object is created, and not defaultable: a buffer or
 *          texture whose recovery nobody decided is exactly how content went
 *          missing after a loss while the handle kept pointing at storage.
 */
#pragma once

#include "../../core/Types.hpp"

namespace esengine {

enum class GfxContentKind : u8 {
    /// Rewritten before every use. Recovery recreates the storage zero-filled.
    Transient,
    /// The device keeps the last bytes it was given and uploads them again.
    Retained,
    /// A provider outside the device refills it; until then it is owed.
    Sourced,
};

/**
 * @brief A content policy. `provider` names who refills a Sourced object and `key`
 *        what it refills; both are the provider's own vocabulary.
 */
class GfxContent {
public:
    static constexpr GfxContent transient() { return GfxContent{GfxContentKind::Transient, 0, 0}; }
    static constexpr GfxContent retained() { return GfxContent{GfxContentKind::Retained, 0, 0}; }
    static constexpr GfxContent sourced(u32 provider, u32 key) {
        return GfxContent{GfxContentKind::Sourced, provider, key};
    }

    constexpr GfxContentKind kind() const { return kind_; }
    constexpr u32 provider() const { return provider_; }
    constexpr u32 key() const { return key_; }

private:
    constexpr GfxContent(GfxContentKind kind, u32 provider, u32 key)
        : kind_(kind), provider_(provider), key_(key) {}

    GfxContentKind kind_;
    u32 provider_;
    u32 key_;
};

}  // namespace esengine
