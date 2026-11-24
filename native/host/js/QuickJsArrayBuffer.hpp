// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "quickjs.h"

namespace esjs {

// The engine owns the storage. QuickJS gets a fixed-length view and no allocator.
template <auto Create = JS_NewArrayBuffer>
inline JSValue wrapBorrowedArrayBuffer(JSContext* ctx, void* data, size_t size) {
    auto* bytes = static_cast<uint8_t*>(data);
    if constexpr (requires { Create(ctx, bytes, size, 0, nullptr, nullptr, false); }) {
        return Create(ctx, bytes, size, 0, nullptr, nullptr, false);
    } else {
        // Older source trees supplied through --quickjs predate max_len.
        return Create(ctx, bytes, size, nullptr, nullptr, false);
    }
}

}  // namespace esjs
