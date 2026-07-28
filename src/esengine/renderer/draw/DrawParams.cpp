// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    DrawParams.cpp
 * @brief   Loose-uniform → std140 DrawParams block rewriter.
 */

#include "./DrawParams.hpp"

#include <cctype>

namespace esengine {

const DrawParamSlot* DrawParamsLayout::find(const std::string& name) const {
    for (const auto& s : slots) {
        if (s.name == name) return &s;
    }
    return nullptr;
}

void drawParamSizeAlign(DrawParamType t, u32& size, u32& align) {
    switch (t) {
        case DrawParamType::Float:
        case DrawParamType::Int:  size = 4;  align = 4;  break;
        case DrawParamType::Vec2: size = 8;  align = 8;  break;
        case DrawParamType::Vec3: size = 12; align = 16; break;
        case DrawParamType::Vec4: size = 16; align = 16; break;
        // std140 matrices are column arrays with vec4 stride.
        case DrawParamType::Mat3: size = 48; align = 16; break;
        case DrawParamType::Mat4: size = 64; align = 16; break;
    }
}

namespace {

struct LooseDecl {
    std::string name;
    std::string member;  ///< Block-member text, e.g. "highp vec2 u_resolution;"
    DrawParamType type = DrawParamType::Float;
    usize begin = 0;     ///< Byte range of the declaration line (excl. trailing newline).
    usize end = 0;
};

bool typeFromToken(const std::string& tok, DrawParamType& out) {
    if (tok == "float") { out = DrawParamType::Float; return true; }
    if (tok == "int")   { out = DrawParamType::Int;   return true; }
    if (tok == "vec2")  { out = DrawParamType::Vec2;  return true; }
    if (tok == "vec3")  { out = DrawParamType::Vec3;  return true; }
    if (tok == "vec4")  { out = DrawParamType::Vec4;  return true; }
    if (tok == "mat3")  { out = DrawParamType::Mat3;  return true; }
    if (tok == "mat4")  { out = DrawParamType::Mat4;  return true; }
    return false;
}

bool isIdentChar(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_';
}

/** Splits a line into whitespace-separated tokens, treating ';' as its own token. */
std::vector<std::string> tokenize(const std::string& line) {
    std::vector<std::string> tokens;
    std::string cur;
    for (char c : line) {
        if (std::isspace(static_cast<unsigned char>(c))) {
            if (!cur.empty()) { tokens.push_back(cur); cur.clear(); }
        } else if (c == ';') {
            if (!cur.empty()) { tokens.push_back(cur); cur.clear(); }
            tokens.push_back(";");
        } else {
            cur += c;
        }
    }
    if (!cur.empty()) tokens.push_back(cur);
    return tokens;
}

/**
 * Collects liftable loose uniform declarations. Line-based: a declaration must
 * be `uniform [precision] <type> <name>;` on one line (matches how every
 * in-tree and SDK-authored shader writes them). Lines inside block comments and
 * text after `//` are ignored; anything the grammar doesn't cover is left
 * loose (safe: GL keeps handling loose uniforms).
 */
std::vector<LooseDecl> collectLooseDecls(const std::string& src) {
    std::vector<LooseDecl> out;
    bool inBlockComment = false;

    usize lineStart = 0;
    while (lineStart < src.size()) {
        usize lineEnd = src.find('\n', lineStart);
        if (lineEnd == std::string::npos) lineEnd = src.size();
        std::string line = src.substr(lineStart, lineEnd - lineStart);

        // Resolve comment state: drop /*...*/ segments (line-local or spanning).
        std::string code;
        code.reserve(line.size());
        for (usize i = 0; i < line.size();) {
            if (inBlockComment) {
                usize close = line.find("*/", i);
                if (close == std::string::npos) { i = line.size(); break; }
                inBlockComment = false;
                i = close + 2;
            } else if (line.compare(i, 2, "/*") == 0) {
                inBlockComment = true;
                i += 2;
            } else if (line.compare(i, 2, "//") == 0) {
                break;
            } else {
                code += line[i++];
            }
        }

        const auto tokens = tokenize(code);
        // uniform [precision] type name ;
        if (tokens.size() >= 4 && tokens[0] == "uniform" && tokens.back() == ";") {
            usize t = 1;
            std::string precision;
            if (tokens[t] == "highp" || tokens[t] == "mediump" || tokens[t] == "lowp") {
                precision = tokens[t];
                ++t;
            }
            DrawParamType type;
            // Exactly: type name ; — anything longer (initializer, extra
            // declarator) or shorter is not a liftable declaration.
            if (tokens.size() == t + 3 && typeFromToken(tokens[t], type)) {
                const std::string& name = tokens[t + 1];
                bool identOk = !name.empty() && !std::isdigit(static_cast<unsigned char>(name[0]));
                for (char c : name) identOk = identOk && isIdentChar(c);
                if (identOk) {
                    LooseDecl d;
                    d.name = name;
                    d.type = type;
                    d.member = (precision.empty() ? "" : precision + " ") + tokens[t] + " " + name + ";";
                    d.begin = lineStart;
                    d.end = lineEnd;
                    out.push_back(std::move(d));
                }
            }
        }

        lineStart = lineEnd + 1;
    }
    return out;
}

/** Replaces each decl's line with `replacementForFirst` (first) or nothing (rest). */
std::string applyRewrite(const std::string& src, const std::vector<LooseDecl>& decls,
                         const std::string& blockText) {
    std::string out = src;
    // Back to front so byte ranges stay valid.
    for (usize i = decls.size(); i-- > 0;) {
        const auto& d = decls[i];
        out.replace(d.begin, d.end - d.begin, i == 0 ? blockText : "");
    }
    return out;
}

}  // namespace

DrawParamsRewrite rewriteLooseUniforms(const std::string& vertexSrc, const std::string& fragmentSrc) {
    DrawParamsRewrite result{vertexSrc, fragmentSrc, {}};

    // Uniform blocks need GLSL ES 3.0 — a 1.00 source (no #version 300
    // directive; attribute/varying style) keeps its loose uniforms, which GL
    // handles as before.
    if (vertexSrc.find("#version 300") == std::string::npos ||
        fragmentSrc.find("#version 300") == std::string::npos) {
        return result;
    }

    // A source that already mentions the block name authored its own layout —
    // do not stack a second definition on top.
    if (vertexSrc.find(DRAW_PARAMS_BLOCK) != std::string::npos ||
        fragmentSrc.find(DRAW_PARAMS_BLOCK) != std::string::npos) {
        return result;
    }

    const auto vsDecls = collectLooseDecls(vertexSrc);
    const auto fsDecls = collectLooseDecls(fragmentSrc);
    if (vsDecls.empty() && fsDecls.empty()) return result;

    // Union of both stages in first-appearance order; both stages must agree on
    // a shared name's type (else the program is broken regardless — leave the
    // sources for the linker to report).
    std::vector<const LooseDecl*> unionDecls;
    for (const auto* decls : {&vsDecls, &fsDecls}) {
        for (const auto& d : *decls) {
            const LooseDecl* seen = nullptr;
            for (const auto* u : unionDecls) {
                if (u->name == d.name) { seen = u; break; }
            }
            if (seen == nullptr) {
                unionDecls.push_back(&d);
            } else if (seen->type != d.type) {
                return result;
            }
        }
    }

    auto alignUp = [](u32 v, u32 a) -> u32 { return (v + a - 1) & ~(a - 1); };
    u32 offset = 0;
    std::string blockText = std::string("layout(std140) uniform ") + DRAW_PARAMS_BLOCK + " {\n";
    for (const auto* d : unionDecls) {
        u32 size = 0, align = 0;
        drawParamSizeAlign(d->type, size, align);
        offset = alignUp(offset, align);
        result.layout.slots.push_back({d->name, d->type, offset});
        offset += size;
        blockText += "    " + d->member + "\n";
    }
    blockText += "};";
    result.layout.blockSize = alignUp(offset, 16);

    if (!vsDecls.empty()) result.vertexSrc = applyRewrite(vertexSrc, vsDecls, blockText);
    if (!fsDecls.empty()) result.fragmentSrc = applyRewrite(fragmentSrc, fsDecls, blockText);
    return result;
}

}  // namespace esengine
