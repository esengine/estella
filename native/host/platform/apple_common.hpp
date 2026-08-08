// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    apple_common.hpp
 * @brief   The parts of the platform seam iOS and macOS answer with the SAME
 *          Apple frameworks: font matching (Core Text) and HTTP (NSURLSession).
 * @details Neither has an iOS-only line in it — Core Text and NSURLSession are
 *          Foundation, not UIKit — and a second copy is how two platforms end up
 *          matching different faces for the same family.
 *
 *          What genuinely differs stays in ios.mm and desktop.cpp: the window,
 *          the event loop, the writable directories, the device description.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <string>

#include "Host.hpp"

namespace eshost {

/**
 * A font file for @p family covering @p codepoint, with @p style's bold/italic
 * bits (GLYPH_BOLD / GLYPH_ITALIC) applied — implements Platform::loadFont.
 *
 * Core Text resolves the family and CTFontCreateForString picks a face that
 * covers the codepoint: the CJK fallback, without a hard-coded path.
 */
FontFile appleLoadFont(const std::string& family, esengine::u32 codepoint, int style);

/**
 * Run @p req on NSURLSession's background queue and hand the reply to
 * deliverFetch — see Platform::startFetch. TLS is the OS's, which is the reason
 * this is platform code at all.
 */
void appleStartFetch(const FetchRequest& req);

}  // namespace eshost
