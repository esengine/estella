// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <cstdint>

namespace eshost {

inline constexpr uint64_t kWsMaxMessageBytes = 64ull << 20;
inline constexpr int kWsCloseProtocolError = 1002;
inline constexpr int kWsCloseMessageTooBig = 1009;

constexpr int wsFrameRefusal(uint8_t opcode, bool fin, uint64_t length, uint64_t pending) {
    if (opcode >= 0x8) return (!fin || length > 125) ? kWsCloseProtocolError : 0;
    if (length > kWsMaxMessageBytes) return kWsCloseMessageTooBig;
    if (opcode == 0x0 && length > kWsMaxMessageBytes - pending) return kWsCloseMessageTooBig;
    return 0;
}

}  // namespace eshost
