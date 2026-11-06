// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The read-only file mapping the native glyph rasterizer opens fonts
 *        through (native/host/media/mapped_file.hpp): the bytes it gives are the
 *        file's, it maps rather than copies, and it moves without double-freeing.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest.h"

#include "media/mapped_file.hpp"

#include <cstdio>
#include <cstring>
#include <string>

using eshost::MappedFile;

namespace {
std::string writeTemp(const char* name, const std::string& content) {
    const std::string path = std::string(name) + ".bin";
    FILE* f = std::fopen(path.c_str(), "wb");
    REQUIRE(f);
    std::fwrite(content.data(), 1, content.size(), f);
    std::fclose(f);
    return path;
}
}  // namespace

TEST_CASE("a mapped file gives the file's bytes, mapped") {
    std::string content(1 << 20, '\0');
    for (size_t i = 0; i < content.size(); ++i) content[i] = (char)(i * 31 + 7);
    const std::string path = writeTemp("test_mapped_file_a", content);
    {
        MappedFile file;
        REQUIRE(file.open(path));
        CHECK(file.mapped());
        REQUIRE(file.size() == content.size());
        CHECK(std::memcmp(file.data(), content.data(), content.size()) == 0);
    }
    std::remove(path.c_str());   // the mapping is gone, so the file can be
}

TEST_CASE("a missing or empty file opens as nothing") {
    MappedFile file;
    CHECK_FALSE(file.open(""));
    CHECK_FALSE(file.open("test_mapped_file_does_not_exist.bin"));
    CHECK(file.empty());
    const std::string path = writeTemp("test_mapped_file_empty", "");
    CHECK_FALSE(file.open(path));
    CHECK(file.data() == nullptr);
    std::remove(path.c_str());
}

TEST_CASE("a mapping moves, and only the last owner unmaps it") {
    const std::string path = writeTemp("test_mapped_file_b", "glyphs");
    {
        MappedFile a;
        REQUIRE(a.open(path));
        MappedFile b = std::move(a);
        CHECK(a.empty());
        REQUIRE(b.size() == 6);
        CHECK(std::memcmp(b.data(), "glyphs", 6) == 0);
        MappedFile c;
        c = std::move(b);
        CHECK(std::memcmp(c.data(), "glyphs", 6) == 0);
    }
    std::remove(path.c_str());
}
