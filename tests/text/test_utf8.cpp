// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "esengine/text/Utf8.hpp"

#include <string>
#include <vector>

using esengine::u32;
using esengine::usize;
using esengine::text::kReplacementCodepoint;
using esengine::text::nextCodepoint;

namespace {

std::vector<u32> decode(const std::string& bytes) {
    std::vector<u32> out;
    for (usize i = 0; i < bytes.size();) {
        const usize before = i;
        out.push_back(nextCodepoint(bytes.data(), bytes.size(), i));
        REQUIRE(i > before);
        REQUIRE(i <= bytes.size());
    }
    return out;
}

const u32 R = kReplacementCodepoint;

}  // namespace

TEST_CASE("well_formed_sequences_decode_to_their_codepoints") {
    CHECK(decode("A") == std::vector<u32>{0x41});
    CHECK(decode("\xC3\xA9") == std::vector<u32>{0xE9});
    CHECK(decode("\xE4\xB8\xAD") == std::vector<u32>{0x4E2D});
    CHECK(decode("\xF0\x9F\x98\x80") == std::vector<u32>{0x1F600});
    CHECK(decode("a\xC3\xA9\xE4\xB8\xAD\xF0\x9F\x98\x80z")
          == std::vector<u32>{0x61, 0xE9, 0x4E2D, 0x1F600, 0x7A});
    CHECK(decode("\xC2\x80") == std::vector<u32>{0x80});
    CHECK(decode("\xEF\xBF\xBD") == std::vector<u32>{R});
    CHECK(decode("\xF4\x8F\xBF\xBF") == std::vector<u32>{0x10FFFF});
}

TEST_CASE("a_stray_byte_is_one_replacement_and_costs_one_byte") {
    CHECK(decode("\x80") == std::vector<u32>{R});
    CHECK(decode("\xFF") == std::vector<u32>{R});
    CHECK(decode("A\xBF" "B") == std::vector<u32>{0x41, R, 0x42});
    CHECK(decode("\xF8\x88\x80\x80\x80") == std::vector<u32>{R, R, R, R, R});
}

TEST_CASE("a_lead_without_its_continuation_keeps_the_byte_after_it") {
    CHECK(decode("\xC3" "A") == std::vector<u32>{R, 0x41});
    CHECK(decode("\xE4\xB8" "A") == std::vector<u32>{R, R, 0x41});
    CHECK(decode("\xF0\x9F\x98" "A") == std::vector<u32>{R, R, R, 0x41});
}

TEST_CASE("a_sequence_cut_off_by_the_end_is_replaced") {
    CHECK(decode("\xC3") == std::vector<u32>{R});
    CHECK(decode("\xE4\xB8") == std::vector<u32>{R, R});
    CHECK(decode("\xF0\x9F\x98") == std::vector<u32>{R, R, R});
}

TEST_CASE("overlong_surrogate_and_out_of_range_forms_are_replaced") {
    CHECK(decode("\xC0\x80") == std::vector<u32>{R, R});
    CHECK(decode("\xC1\xBF") == std::vector<u32>{R, R});
    CHECK(decode("\xE0\x80\x80") == std::vector<u32>{R, R, R});
    CHECK(decode("\xF0\x80\x80\x80") == std::vector<u32>{R, R, R, R});
    CHECK(decode("\xED\xA0\x80") == std::vector<u32>{R, R, R});
    CHECK(decode("\xF4\x90\x80\x80") == std::vector<u32>{R, R, R, R});
}

TEST_CASE("every_three_byte_input_terminates_inside_its_bounds") {
    std::string bytes(3, '\0');
    for (int a = 0x70; a < 0x100; ++a) {
        for (int b = 0; b < 0x100; b += 3) {
            for (int c = 0; c < 0x100; c += 5) {
                bytes[0] = static_cast<char>(a);
                bytes[1] = static_cast<char>(b);
                bytes[2] = static_cast<char>(c);
                const auto out = decode(bytes);
                REQUIRE(out.size() >= 1);
                REQUIRE(out.size() <= 3);
            }
        }
    }
}
