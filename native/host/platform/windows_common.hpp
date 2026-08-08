// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    windows_common.hpp
 * @brief   The two halves of the platform seam SDL does not cover on Windows:
 *          matching a font file (DirectWrite) and performing an HTTP request
 *          (WinHTTP). The Apple sibling is apple_common.hpp.
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
 *  DirectWrite resolves the family and finds a face covering the codepoint: the
 *  CJK fallback, without a hard-coded path. */
FontFile windowsLoadFont(const std::string& family, esengine::u32 codepoint, int style);

/** Run @p req on a WinHTTP worker thread and hand the reply to deliverFetch —
 *  see Platform::startFetch. TLS is the OS's, which is why this is platform code. */
void windowsStartFetch(const FetchRequest& req);

}  // namespace eshost
