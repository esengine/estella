// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "net/WsFrame.hpp"

using eshost::kWsCloseMessageTooBig;
using eshost::kWsCloseProtocolError;
using eshost::kWsMaxMessageBytes;
using eshost::wsFrameRefusal;

TEST_CASE("a_data_frame_within_the_limit_is_read") {
    CHECK(wsFrameRefusal(0x1, true, 0, 0) == 0);
    CHECK(wsFrameRefusal(0x2, true, kWsMaxMessageBytes, 0) == 0);
    CHECK(wsFrameRefusal(0x2, false, 1024, 0) == 0);
    CHECK(wsFrameRefusal(0x0, true, 1024, 4096) == 0);
}

TEST_CASE("a_frame_longer_than_the_limit_is_refused_before_it_is_allocated") {
    CHECK(wsFrameRefusal(0x2, true, kWsMaxMessageBytes + 1, 0) == kWsCloseMessageTooBig);
    CHECK(wsFrameRefusal(0x1, true, 0x7FFFFFFFFFFFFFFFull, 0) == kWsCloseMessageTooBig);
    CHECK(wsFrameRefusal(0x2, true, 0xFFFFFFFFFFFFFFFFull, 0) == kWsCloseMessageTooBig);
    CHECK(wsFrameRefusal(0x0, false, 0xFFFFFFFFFFFFFFFFull, 1) == kWsCloseMessageTooBig);
}

TEST_CASE("fragments_are_refused_once_their_sum_passes_the_limit") {
    CHECK(wsFrameRefusal(0x0, false, 1, kWsMaxMessageBytes - 1) == 0);
    CHECK(wsFrameRefusal(0x0, false, 1, kWsMaxMessageBytes) == kWsCloseMessageTooBig);
    CHECK(wsFrameRefusal(0x0, true, kWsMaxMessageBytes, 1) == kWsCloseMessageTooBig);
}

TEST_CASE("a_new_message_does_not_inherit_the_previous_ones_bytes") {
    CHECK(wsFrameRefusal(0x1, true, kWsMaxMessageBytes, 0) == 0);
}

TEST_CASE("a_control_frame_is_short_and_whole") {
    CHECK(wsFrameRefusal(0x9, true, 125, 0) == 0);
    CHECK(wsFrameRefusal(0x8, true, 2, 0) == 0);
    CHECK(wsFrameRefusal(0x9, true, 126, 0) == kWsCloseProtocolError);
    CHECK(wsFrameRefusal(0xA, false, 0, 0) == kWsCloseProtocolError);
    CHECK(wsFrameRefusal(0x8, true, kWsMaxMessageBytes + 1, 0) == kWsCloseProtocolError);
}
