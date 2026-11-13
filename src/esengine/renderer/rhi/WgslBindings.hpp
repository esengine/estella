// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WgslBindings.hpp
 * @brief   What a texture unit is called in WGSL, and what a WGSL source says about
 *          the group-1 bindings it holds.
 * @details One author for a convention three places acted on: the shader assembler
 *          emits these declarations, the WebGPU backend builds its bind-group layouts
 *          from them, and the twin generator writes them into a cooked shader. Backend
 *          neutral on purpose — the assembler runs in a build with no WebGPU in it.
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"

#include <cstdlib>
#include <cstring>

namespace esengine {

/**
 * @brief Group-1 binding of a texture unit. Units 0-7 are the batch stream and take
 *        bindings 0-7; a material's own units start at 8 and take 16 upward, leaving
 *        8-15 for the samplers underneath the first eight.
 */
inline constexpr u32 textureBindingForUnit(u32 unit) { return unit < 8 ? unit : unit + 8; }

/** @brief Group-1 binding of a texture unit's sampler (see textureBindingForUnit). */
inline constexpr u32 samplerBindingForUnit(u32 unit) { return unit < 8 ? unit + 8 : unit + 16; }

/** @brief Units a `tN` / `sN` name can carry — the batch stream and a material's own. */
inline constexpr u32 WGSL_MAX_TEXTURE_UNITS = 16;

/**
 * @brief Bit mask of the `@group(N) @binding(i)` indices a WGSL source declares.
 * @details Declarations drive the backend's EXPLICIT bind-group layouts: every declared
 *          binding gets a layout entry and a bound resource (or a dummy backfill), so a
 *          declared-but-unused binding is as legal as it is in GLSL. Bindings >= 32 are
 *          ignored — the group-1 convention tops out at 31.
 */
inline u32 scanWGSLBindingMask(const char* source, u32 group) {
    if (!source) return 0;
    u32 mask = 0;
    for (const char* p = source; (p = std::strstr(p, "@group(")) != nullptr;) {
        p += 7;
        char* end = nullptr;
        const unsigned long g = std::strtoul(p, &end, 10);
        if (end == p) continue;
        p = end;
        if (g != group) continue;
        const char* b = std::strstr(p, "@binding(");
        if (!b) break;
        b += 9;
        const unsigned long idx = std::strtoul(b, &end, 10);
        if (end == b) continue;
        p = end;
        if (idx < 32) mask |= (1u << idx);
    }
    return mask;
}

/**
 * @brief The `tN` / `sN` names a WGSL source REACHES, by unit.
 * @details The other half of the question {@link scanWGSLBindingMask} asks: what a
 *          stage names, as against what it declares. A name reached and not declared is
 *          an unresolved identifier, which WebGPU reports as an invalid PIPELINE with no
 *          shader named anywhere in it — so the assembler completes the set instead.
 *
 *          A name the source makes its own is not a unit: `let s2`, `var t0` in a
 *          function, a parameter or a field `s1 : f32`. Three colours kept in s0..s3
 *          once counted as four units read, and a material's eighth texture was told
 *          there was no unit left for it. A `var` after an attribute's `)` is a
 *          binding's own declaration, which does name the unit.
 */
inline void scanWGSLReachedUnits(const char* source, u32& textures, u32& samplers) {
    textures = 0;
    samplers = 0;
    if (!source) return;
    const auto isIdent = [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
    };
    const auto isSpace = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r'; };
    // Whether the name starting at @p p (ending before @p end) is one the source declares for itself.
    const auto ownName = [&](const char* p, const char* end) -> bool {
        const char* b = p;
        while (b != source && isSpace(b[-1])) --b;
        const char* after = end;
        while (isSpace(*after)) ++after;
        if (b != source && (b[-1] == '(' || b[-1] == ',' || b[-1] == '{') && *after == ':') return true;
        const char* w = b;
        while (w != source && isIdent(w[-1])) --w;
        const usize len = static_cast<usize>(b - w);
        if (len == 3 && std::strncmp(w, "let", 3) == 0) return true;
        if (len == 5 && std::strncmp(w, "const", 5) == 0) return true;
        if (len != 3 || std::strncmp(w, "var", 3) != 0) return false;
        while (w != source && isSpace(w[-1])) --w;
        return w == source || w[-1] != ')';
    };
    u32 ownTextures = 0;
    u32 ownSamplers = 0;
    for (const char* p = source; *p; ++p) {
        if (*p != 't' && *p != 's') continue;
        if (p != source && isIdent(p[-1])) continue;
        char* end = nullptr;
        const unsigned long unit = std::strtoul(p + 1, &end, 10);
        if (end == p + 1 || isIdent(*end)) continue;
        if (unit < WGSL_MAX_TEXTURE_UNITS) {
            (*p == 't' ? textures : samplers) |= (1u << unit);
            if (ownName(p, end)) (*p == 't' ? ownTextures : ownSamplers) |= (1u << unit);
        }
        p = end - 1;
    }
    textures &= ~ownTextures;
    samplers &= ~ownSamplers;
}

}  // namespace esengine
