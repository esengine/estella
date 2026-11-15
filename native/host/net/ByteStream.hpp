// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

namespace eshost {

struct ByteStream {
    virtual ~ByteStream() = default;
    virtual bool sendAll(const uint8_t* data, size_t len) = 0;
    virtual bool recvAll(uint8_t* data, size_t len) = 0;
    virtual void shutdown() = 0;
};

std::unique_ptr<ByteStream> dialTls(const std::string& host, const std::string& port, std::string& why);

}  // namespace eshost
