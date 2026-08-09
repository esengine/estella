// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    linux_common.hpp
 * @brief   The two halves of the platform seam SDL does not cover on Linux:
 *          matching a font file (fontconfig) and performing an HTTP request
 *          (libcurl). The siblings are apple_common.hpp and windows_common.hpp.
 *
 * @details Linux differs from the other two in one way worth writing down: it
 *          has no OS-provided HTTP stack. macOS has NSURLSession and Windows has
 *          WinHTTP, both of which own the TLS trust store; on Linux that job
 *          belongs to a library, and libcurl is the one every distribution ships
 *          and the Steam Runtime carries. So it is a link-time dependency of the
 *          Linux host, and the only one this seam adds beyond fontconfig.
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

/** A font file for @p family covering @p codepoint, with @p style's bold/italic
 *  bits applied — implements Platform::loadFont.
 *
 *  fontconfig falls back across the installed fonts when given the codepoint as a
 *  required charset: the CJK path, with no per-distribution path hard-coded. */
FontFile linuxLoadFont(const std::string& family, esengine::u32 codepoint, int style);

/** Run @p req on a libcurl worker thread and hand the reply to deliverFetch —
 *  see Platform::startFetch. */
void linuxStartFetch(const FetchRequest& req);

}  // namespace eshost
