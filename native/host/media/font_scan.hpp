// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    font_scan.hpp
 * @brief   Pick a font file out of a directory, for platforms with no matcher.
 * @details {@link Platform::loadFont} asks for a file that covers one codepoint,
 *          which iOS answers with CoreText and Android with AFontMatcher — but
 *          AFontMatcher is API 29 and the Android floor is 24, so between them
 *          there is no OS matcher to ask. Choosing a file out of a directory of
 *          them is not Android knowledge, so it lives here beside the rasterizer
 *          that already owns stb_truetype rather than in one platform's glue.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "Host.hpp"

#include <string>

namespace eshost {

/**
 * The first font in @p dir that has a glyph for @p codepoint, preferring files
 * whose name looks like @p family and the requested @p style.
 *
 * Coverage is decided by asking the font, not by trusting a name: a family is
 * only the starting order, and the answer is whichever candidate actually draws
 * the character. An empty {@link FontFile::path} means nothing in the directory
 * covers it.
 */
FontFile scanFontDir(const char* dir, const std::string& family, esengine::u32 codepoint, int style);

}  // namespace eshost
