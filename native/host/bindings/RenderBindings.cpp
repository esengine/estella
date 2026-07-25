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

// es_createTextureKTX2(ArrayBuffer|TypedArray, srgb?) -> { id, width, height } | null.
// Transcodes a KTX2/Basis container to the best device-supported compressed format
// (or RGBA32) and uploads it. Native-only: the web transcodes in a wasm module and
// uploads through WebGL2, so there is no engine entry point shared with it.
JSValue js_createTextureKTX2(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NULL;
    std::vector<u8> bytes;
    readByteSource(ctx, argv[0], bytes);
    if (bytes.empty()) return JS_NULL;
    const bool srgb = argc > 1 && JS_ToBool(ctx, argv[1]) != 0;
    auto r = transcodeKTX2(bytes.data(), bytes.size(), srgb,
                           host().ctx->require<resource::ResourceManager>(), *host().gfx);
    if (r.handle < 0) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "id", JS_NewInt32(ctx, r.handle));
    JS_SetPropertyStr(ctx, o, "width", JS_NewInt32(ctx, r.width));
    JS_SetPropertyStr(ctx, o, "height", JS_NewInt32(ctx, r.height));
    return o;
}

// es_getTextureDimensions(handle) -> { width, height } | null. The engine's
// rm_getTextureDimensions returns an emscripten::val, so this one query stays
// hand-written; it reads the same ResourceManager that entry point would.
JSValue js_getTextureDimensions(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    int64_t id = 0;
    JS_ToInt64(ctx, &id, argv[0]);
    auto* tex = host().ctx->require<resource::ResourceManager>().getTexture(
        resource::TextureHandle((u32)id));
    if (!tex) return JS_NULL;
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "width", JS_NewInt32(ctx, (int32_t)tex->getWidth()));
    JS_SetPropertyStr(ctx, obj, "height", JS_NewInt32(ctx, (int32_t)tex->getHeight()));
    return obj;
}

// es_rasterizeGlyph({ codepoint, fontFamily, style, pixelSize, sdf, padding })
// -> { pixels: ArrayBuffer, width, height, advance, bearingX, bearingY } | null.
// The device's answer to the browser's 2D canvas; see media/glyph_raster.hpp.
JSValue js_rasterizeGlyph(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1 || !hostAlive() || !host().platform) return JS_NULL;
    JSValue req = argv[0];

    const auto numberField = [&](const char* name, double fallback) {
        JSValue v = JS_GetPropertyStr(ctx, req, name);
        double out = fallback;
        if (!JS_IsUndefined(v)) JS_ToFloat64(ctx, &out, v);
        JS_FreeValue(ctx, v);
        return out;
    };
    const auto boolField = [&](const char* name) {
        JSValue v = JS_GetPropertyStr(ctx, req, name);
        const bool out = JS_ToBool(ctx, v) != 0;
        JS_FreeValue(ctx, v);
        return out;
    };

    std::string family;
    JSValue familyVal = JS_GetPropertyStr(ctx, req, "fontFamily");
    if (const char* s = JS_ToCString(ctx, familyVal)) {
        family = s;
        JS_FreeCString(ctx, s);
    }
    JS_FreeValue(ctx, familyVal);

    const auto glyph = rasterizeGlyph(
        *host().platform,
        (uint32_t)numberField("codepoint", 0),
        family,
        (int)numberField("style", 0),
        (float)numberField("pixelSize", 48),
        boolField("sdf"),
        (float)numberField("padding", 6));
    if (!glyph.ok) return JS_NULL;

    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "pixels",
                      glyph.rgba.empty() ? JS_NewArrayBufferCopy(ctx, nullptr, 0)
                                         : JS_NewArrayBufferCopy(ctx, glyph.rgba.data(), glyph.rgba.size()));
    JS_SetPropertyStr(ctx, o, "width", JS_NewInt32(ctx, glyph.width));
    JS_SetPropertyStr(ctx, o, "height", JS_NewInt32(ctx, glyph.height));
    JS_SetPropertyStr(ctx, o, "advance", JS_NewFloat64(ctx, glyph.advance));
    JS_SetPropertyStr(ctx, o, "bearingX", JS_NewFloat64(ctx, glyph.bearingX));
    JS_SetPropertyStr(ctx, o, "bearingY", JS_NewFloat64(ctx, glyph.bearingY));
    return o;
}

// es_renderer_surfaceSize() -> { width, height }: the camera plugin reads it per
// frame, so a rotation reaches the projection without an event.
JSValue js_renderer_surfaceSize(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "width", JS_NewInt32(ctx, hostAlive() ? (int32_t)host().w : 0));
    JS_SetPropertyStr(ctx, o, "height", JS_NewInt32(ctx, hostAlive() ? (int32_t)host().h : 0));
    return o;
}

// es_registry_getCameraEntities() -> [entity]. Active cameras with a Transform,
// as the web binding reports them (its sibling returns an emscripten::val array).
JSValue js_registry_getCameraEntities(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    JSValue arr = JS_NewArray(ctx);
    if (!hostAlive() || !host().registry) return arr;
    auto& registry = *host().registry;
    uint32_t n = 0;
    for (auto entity : registry.view<ecs::Camera, ecs::Transform>()) {
        if (registry.get<ecs::Camera>(entity).isActive) {
            JS_SetPropertyUint32(ctx, arr, n++, JS_NewInt32(ctx, (int32_t)entity.id()));
        }
    }
    return arr;
}

}  // namespace

void registerRenderBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_createTextureKTX2", js_createTextureKTX2, 2);
    bindGlobal(h, global, "es_getTextureDimensions", js_getTextureDimensions, 1);
    bindGlobal(h, global, "es_rasterizeGlyph", js_rasterizeGlyph, 1);
    bindGlobal(h, global, "es_renderer_surfaceSize", js_renderer_surfaceSize, 0);
    bindGlobal(h, global, "es_registry_getCameraEntities", js_registry_getCameraEntities, 0);
}

}  // namespace eshost
