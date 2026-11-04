// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    RenderBindings.cpp
 * @brief   The rendering calls that have no generated form — and only those.
 * @details Most of what the SDK's renderer, asset pipeline and glyph atlas need is
 *          GENERATED from the `bindings` headers: `es_renderer_*` drives the frame,
 *          `es_rm_*` creates, releases and updates textures, `es_renderer_submitTextBatch`
 *          takes the laid-out glyph quads. Those come from the same declarations
 *          embind registers on the web, so one implementation serves both platforms
 *          and both get its BoundarySpan validation.
 *
 *          Three things cannot come from there, and are here:
 *            * KTX2 transcode — native-only; the web path is WebGL2 + a wasm
 *              transcoder, so there is no shared entry point to generate from.
 *            * Glyph rasterization — the device has no 2D canvas, so the host owns
 *              the font stack. Also native-only.
 *            * Two queries whose web siblings return an `emscripten::val`
 *              (the surface size and the camera list), a shape the boundary
 *              cannot marshal.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

#include "media/glyph_raster.hpp"
#include "media/ktx2_decode.hpp"

#include "esengine/ecs/components/Camera.hpp"
#include "esengine/ecs/components/Transform.hpp"
#include "esengine/resource/ResourceManager.hpp"

using namespace esengine;

namespace eshost {
namespace {

// es_createTextureKTX2(ArrayBuffer|TypedArray, srgb?)
//   -> { id, width, height, format, blockRefused } | null.
// Transcodes a KTX2/Basis container to the best device-supported compressed format
// (or RGBA32) and uploads it. Native-only: the web transcodes in a wasm module and
// uploads through WebGL2, so there is no engine entry point shared with it.
// `format`/`blockRefused` carry the CHOICE out: an RGBA upload is otherwise a
// correct picture at four times the memory, with nothing saying it happened.
esjs::Val js_createTextureKTX2(const esjs::Args& a) {
    if (a.size() < 1) return esjs::null();
    std::vector<u8> bytes;
    readByteSource(a[0], bytes);
    if (bytes.empty()) return esjs::null();
    const bool srgb = a.size() > 1 && esjs::toBool(a[1]);
    auto r = transcodeKTX2(bytes.data(), bytes.size(), srgb,
                           host().ctx->require<resource::ResourceManager>(), *host().gfx);
    if (r.handle < 0) return esjs::null();
    esjs::Val o = esjs::object();
    esjs::set(o, "id", esjs::int32(r.handle));
    esjs::set(o, "width", esjs::int32(r.width));
    esjs::set(o, "height", esjs::int32(r.height));
    esjs::set(o, "format", esjs::int32(r.format));
    esjs::set(o, "blockRefused", esjs::boolean(r.blockRefused));
    return o;
}

// es_getTextureDimensions(handle) -> { width, height } | null. The engine's
// rm_getTextureDimensions returns an emscripten::val, so this one query stays
// hand-written; it reads the same ResourceManager that entry point would.
esjs::Val js_getTextureDimensions(const esjs::Args& a) {
    int64_t id = 0;
    id = esjs::toInt64(a[0]);
    auto* tex = host().ctx->require<resource::ResourceManager>().getTexture(
        resource::TextureHandle((u32)id));
    if (!tex) return esjs::null();
    esjs::Val obj = esjs::object();
    esjs::set(obj, "width", esjs::int32((int32_t)tex->getWidth()));
    esjs::set(obj, "height", esjs::int32((int32_t)tex->getHeight()));
    return obj;
}

// es_rasterizeGlyph({ codepoint, fontFamily, style, pixelSize, sdf, padding })
// -> { pixels: ArrayBuffer, width, height, advance, bearingX, bearingY } | null.
// The device's answer to the browser's 2D canvas; see media/glyph_raster.hpp.
esjs::Val js_rasterizeGlyph(const esjs::Args& a) {
    if (a.size() < 1 || !hostAlive() || !host().platform) return esjs::null();
    esjs::Val req = a[0];

    const auto numberField = [&](const char* name, double fallback) {
        esjs::Val v = esjs::get(req, name);
        double out = fallback;
        if (!esjs::isUndefined(v)) out = esjs::toNumber(v);
        return out;
    };
    const auto boolField = [&](const char* name) {
        esjs::Val v = esjs::get(req, name);
        const bool out = esjs::toBool(v);
        return out;
    };

    const esjs::Val familyVal = esjs::get(req, "fontFamily");
    const std::string family = esjs::isNullish(familyVal) ? std::string() : esjs::toString(familyVal);

    const auto glyph = rasterizeGlyph(
        *host().platform,
        (uint32_t)numberField("codepoint", 0),
        family,
        (int)numberField("style", 0),
        (float)numberField("pixelSize", 48),
        boolField("sdf"),
        (float)numberField("padding", 6));
    if (!glyph.ok) return esjs::null();

    esjs::Val o = esjs::object();
    esjs::set(o, "pixels", glyph.rgba.empty() ? esjs::arrayBufferCopy(nullptr, 0)
                                         : esjs::arrayBufferCopy(glyph.rgba.data(), glyph.rgba.size()));
    esjs::set(o, "width", esjs::int32(glyph.width));
    esjs::set(o, "height", esjs::int32(glyph.height));
    esjs::set(o, "advance", esjs::number(glyph.advance));
    esjs::set(o, "bearingX", esjs::number(glyph.bearingX));
    esjs::set(o, "bearingY", esjs::number(glyph.bearingY));
    return o;
}

// es_renderer_surfaceSize() -> { width, height }: the camera plugin reads it per
// frame, so a rotation reaches the projection without an event.
esjs::Val js_renderer_surfaceSize(const esjs::Args& a) {
    esjs::Val o = esjs::object();
    esjs::set(o, "width", esjs::int32(hostAlive() ? (int32_t)host().w : 0));
    esjs::set(o, "height", esjs::int32(hostAlive() ? (int32_t)host().h : 0));
    return o;
}

// OS content insets in the same pixel domain as the rendered surface.
esjs::Val js_safeAreaInsets(const esjs::Args& a) {
    const auto insets = hostAlive() && host().platform
        ? host().platform->safeAreaInsets() : Platform::SafeInsets{};
    esjs::Val o = esjs::object();
    esjs::set(o, "top", esjs::number(insets.top));
    esjs::set(o, "bottom", esjs::number(insets.bottom));
    esjs::set(o, "left", esjs::number(insets.left));
    esjs::set(o, "right", esjs::number(insets.right));
    return o;
}

// es_setWindowSize(w, h): the project's design resolution, which only the SDK can
// read (the window exists before any JS, and the host parses no JSON). A platform
// that is GIVEN its screen ignores it.
esjs::Val js_setWindowSize(const esjs::Args& a) {
    if (a.size() < 2) return esjs::undefined();
    const int32_t w = esjs::toInt32(a[0]), h = esjs::toInt32(a[1]);
    if (host().platform) host().platform->setWindowSize(w, h);
    return esjs::undefined();
}

// es_registry_getCameraEntities() -> [entity]. Active cameras with a Transform,
// as the web binding reports them (its sibling returns an emscripten::val array).
esjs::Val js_registry_getCameraEntities(const esjs::Args& a) {
    esjs::Val arr = esjs::array();
    if (!hostAlive() || !host().registry) return arr;
    auto& registry = *host().registry;
    uint32_t n = 0;
    for (auto entity : registry.activeView<ecs::Camera, ecs::Transform>()) {
        if (registry.get<ecs::Camera>(entity).isActive) {
            esjs::setAt(arr, n++, esjs::int32((int32_t)entity.id()));
        }
    }
    return arr;
}

}  // namespace

void registerRenderBindings(HostState& h, esjs::Val global) {
    bindGlobal(global, "es_createTextureKTX2", js_createTextureKTX2, 2);
    bindGlobal(global, "es_getTextureDimensions", js_getTextureDimensions, 1);
    bindGlobal(global, "es_rasterizeGlyph", js_rasterizeGlyph, 1);
    bindGlobal(global, "es_renderer_surfaceSize", js_renderer_surfaceSize, 0);
    bindGlobal(global, "es_safeAreaInsets", js_safeAreaInsets, 0);
    bindGlobal(global, "es_setWindowSize", js_setWindowSize, 2);
    bindGlobal(global, "es_registry_getCameraEntities", js_registry_getCameraEntities, 0);
}

}  // namespace eshost
