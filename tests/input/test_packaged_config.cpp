// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a native host reads of game.config.json before any shader compiles
 *        (native/host/PackagedConfig.hpp). Too late, and a linear project shows
 *        its linear values with no encode: far too dark, with no error.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "PackagedConfig.hpp"

using eshost::packagedConfigIsLinear;

TEST_CASE("a linear project is found however the file is spaced") {
    CHECK(packagedConfigIsLinear(R"({"colorSpace":"linear"})"));
    CHECK(packagedConfigIsLinear("{\n  \"entryScene\": \"a\",\n  \"colorSpace\": \"linear\",\n  \"x\": 1\n}"));
    CHECK(packagedConfigIsLinear("{ \"colorSpace\" \t:\r\n \"linear\" }"));
}

TEST_CASE("anything else is gamma, as the SDK reads it") {
    CHECK_FALSE(packagedConfigIsLinear(""));
    CHECK_FALSE(packagedConfigIsLinear("{}"));
    CHECK_FALSE(packagedConfigIsLinear(R"({"colorSpace":"gamma"})"));
    CHECK_FALSE(packagedConfigIsLinear(R"({"colorSpace":"linearish"})"));
    CHECK_FALSE(packagedConfigIsLinear(R"({"name":"colorSpace","other":"linear"})"));
}

TEST_CASE("a truncated file does not read past its end") {
    CHECK_FALSE(packagedConfigIsLinear(R"("colorSpace")"));
    CHECK_FALSE(packagedConfigIsLinear(R"("colorSpace":)"));
    CHECK_FALSE(packagedConfigIsLinear(R"("colorSpace": "lin)"));
}

TEST_CASE("a value that is not the key's is not taken for it") {
    CHECK_FALSE(packagedConfigIsLinear(R"({"colorSpace":"gamma","mode":"linear"})"));
    CHECK(packagedConfigIsLinear(R"({"note":"colorSpace","colorSpace":"linear"})"));
}
