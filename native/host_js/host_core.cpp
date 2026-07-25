// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    host_core.cpp
 * @brief   Implements the platform-independent JS host (see host_core.hpp).
 * @details The host installs the native side of the registry contract as globals:
 *          * entity + hierarchy (hand-written here): es_createEntity /
 *            es_destroyEntity / es_setParent / es_hasParent / es_removeParent /
 *            es_hasChildren / es_getChildren
 *          * per-component (EHT-generated, esn_register): es_set_<C> /
 *            es_<C>_buffer / es_<C>_has / es_<C>_remove
 *          * resources + assets (hand-written): es_createTexture, es_setClear,
 *            es_readAsset
 *          createNativeRegistry + NativeMemoryProvider inside the SDK bundle read
 *          these off globalThis. Entity ids cross as the native Entity's raw u32
 *          (round-tripped via Entity::fromRaw), so hierarchy queries return ids
 *          the SDK recognises.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "host_core.hpp"

#include "esn_shim.hpp"          // quickjs + the esn_* plumbing decls (+ esn_register)
#include "esengine_bundle.h"     // the real SDK, bundled: installs globalThis.ESEngine
#include "native_audio.hpp"      // the miniaudio-backed engine behind es_audio*
#include "ktx2_decode.hpp"       // basis_universal transcode behind es_createTextureKTX2
#include "glyph_raster.hpp"      // stb_truetype + the engine's SDF, behind es_rasterizeGlyph

#include "esengine/core/EstellaContext.hpp"
#include "esengine/core/World.hpp"
#include "esengine/ecs/TransformSystem.hpp"          // TransformSystem + ecs::setParent
#include "esengine/ecs/components/Hierarchy.hpp"      // Parent / Children
#include "esengine/renderer/RenderContext.hpp"
#include "esengine/renderer/RenderFrame.hpp"
#include "esengine/renderer/Texture.hpp"           // TextureSpecification + filter/wrap for import settings
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/resource/ShaderParser.hpp"       // linearColorSpace() — texture format at the JS boundary

#include <glm/gtc/matrix_transform.hpp>

// stb_image for the native image-decode path (NativeBridge.loadImagePixels). The
// engine core doesn't use stb_image, so this TU owns the implementation.
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <mutex>
#include <queue>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

using namespace esengine;

// Host platform bootstrap — HOST code, not game. The bridge itself is assembled
// by the SDK (createHostBridge) from the es_* primitives below: it is typed there
// against the interface it must satisfy, so this stays the few things only a JS
// string here can do — the TextDecoder shim and the default boot entry points.
static const char* kBootstrapJS = R"JS(
// The platform layer decodes packaged JSON through TextDecoder; QuickJS has none,
// so route it to the host's UTF-8 decoder. Only utf-8 is meaningful here.
globalThis.TextDecoder = function TextDecoder() {};
globalThis.TextDecoder.prototype.decode = function (buf) {
    return buf == null ? '' : es_utf8Decode(buf);
};

// The whole host contract in one check — the JS globals a bare engine lacks and
// the es_* bindings this shell binds — so a gap is named here, not downstream.
ESEngine.assertNativeHost(globalThis);

// The bridge over the host's es_* bindings; it also installs es_onNativeTouch,
// the entry point the host calls per touch.
globalThis.__esNativeBridge = ESEngine.createHostBridge(globalThis);

// Default boot: run an EXPORTED project — game.config.json, the manifests, the
// cooked assets and the scenes, all read off the device. A packaged game.js (the
// hand-written-script path) replaces these two functions instead.
globalThis.__esGame = null;
globalThis.init = function () {
    ESEngine.initNativeGame({ bridge: globalThis.__esNativeBridge, scope: globalThis, width: W, height: H })
        .then(function (game) { globalThis.__esGame = game; })
        .catch(function (e) {
            console.error('exported game failed to boot:', e && e.message ? e.message : e);
        });
};
globalThis.update = function (dt) {
    if (globalThis.__esGame) globalThis.__esGame.app.tick(dt);
};
)JS";

namespace {

// A pending setTimeout / setInterval callback. QuickJS is only the language: the
// timers, like console, are the host's job.
struct Timer {
    int64_t id;
    double due;        ///< nowMs() deadline.
    double interval;   ///< Repeat period; 0 for a one-shot.
    JSValue fn;
};

struct App {
    eshost::Platform* platform = nullptr;
    WGPUInstance instance = nullptr;
    WGPUAdapter adapter = nullptr;
    WGPUDevice device = nullptr;
    WebGPUDevice* gfx = nullptr;
    EstellaContext* ctx = nullptr;
    ecs::Registry* registry = nullptr;
    JSRuntime* rt = nullptr;
    JSContext* js = nullptr;
    eshost::AudioEngine audio;              // native sound (miniaudio); silent if no device
    std::string cacheDir;                   // app private dir — SDK bytecode cache
    std::vector<Timer> timers;
    int64_t next_timer_id = 1;
    std::unordered_map<int, JSValue> fetchCallbacks;   // in-flight es_fetch id -> JS callback
    int nextFetchId = 1;
    glm::vec4 clear{0.07f, 0.08f, 0.12f, 1.0f};
    f32 w = 0, h = 0;
    bool ready = false;         // engine + JS booted once
    bool surfaceReady = false;  // a live window surface is bound (false while screen off)
    uint64_t frame = 0;
};

App* g_app = nullptr;

// HTTP replies cross back from whatever thread the platform's completion runs on.
// The platform enqueues here (POD only, no JS); the frame loop drains it on the JS
// thread and runs the callbacks. Kept outside App so deliverFetch (a free function
// the glue calls) needs no App pointer and is safe before/after boot.
std::mutex g_fetchMutex;
std::queue<eshost::FetchResult> g_fetchQueue;

double nowMs();

void hostLog(bool error, const char* fmt, ...) {
    char buf[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buf, sizeof(buf), fmt, args);
    va_end(args);
    if (g_app && g_app->platform) g_app->platform->log(error, buf);
}

}  // namespace

#define LOGI(...) hostLog(false, __VA_ARGS__)
#define LOGE(...) hostLog(true, __VA_ARGS__)

// ---- the esn_shim plumbing the generated component bindings call ------------

ecs::Registry& esn_reg() { return *g_app->registry; }

// Entity ids cross the boundary as the native Entity's raw u32.
Entity esn_entity(JSContext* ctx, JSValueConst v) {
    uint32_t raw = Entity::INVALID_RAW;
    JS_ToUint32(ctx, &raw, v);
    return Entity::fromRaw(raw);
}

bool esn_getnum(JSContext* ctx, JSValueConst obj, const char* key, double* out) {
    JSValue p = JS_GetPropertyStr(ctx, obj, key);
    bool ok = !JS_IsUndefined(p) && !JS_IsNull(p) && JS_ToFloat64(ctx, out, p) == 0;
    JS_FreeValue(ctx, p);
    return ok;
}
bool esn_getbool(JSContext* ctx, JSValueConst obj, const char* key, int* out) {
    JSValue p = JS_GetPropertyStr(ctx, obj, key);
    if (JS_IsUndefined(p) || JS_IsNull(p)) { JS_FreeValue(ctx, p); return false; }
    *out = JS_ToBool(ctx, p);
    JS_FreeValue(ctx, p);
    return true;
}
void esn_getvec(JSContext* ctx, JSValueConst obj, const char* key, float* dst, int n) {
    JSValue arr = JS_GetPropertyStr(ctx, obj, key);
    if (JS_IsArray(arr)) {
        for (int i = 0; i < n; ++i) {
            JSValue el = JS_GetPropertyUint32(ctx, arr, (uint32_t)i);
            double d = 0;
            JS_ToFloat64(ctx, &d, el);
            dst[i] = (float)d;
            JS_FreeValue(ctx, el);
        }
    }
    JS_FreeValue(ctx, arr);
}
JSValue esn_arraybuffer(JSContext* ctx, void* ptr, size_t size) {
    return JS_NewArrayBuffer(ctx, reinterpret_cast<uint8_t*>(ptr), size, nullptr, nullptr, false);
}

namespace {

// ---- entity + hierarchy: the base Registry surface the SDK World drives ------

JSValue js_createEntity(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewUint32(ctx, g_app->registry->create().id());
}
JSValue js_destroyEntity(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    g_app->registry->destroy(esn_entity(ctx, argv[0]));
    return JS_UNDEFINED;
}
JSValue js_setParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    ecs::setParent(*g_app->registry, esn_entity(ctx, argv[0]), esn_entity(ctx, argv[1]));
    return JS_UNDEFINED;
}
JSValue js_hasParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    return JS_NewBool(ctx, g_app->registry->has<ecs::Parent>(esn_entity(ctx, argv[0])));
}
JSValue js_removeParent(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    ecs::setParent(*g_app->registry, esn_entity(ctx, argv[0]), INVALID_ENTITY);
    return JS_UNDEFINED;
}
JSValue js_hasChildren(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    auto* c = g_app->registry->tryGet<ecs::Children>(esn_entity(ctx, argv[0]));
    return JS_NewBool(ctx, c && !c->entities.empty());
}
JSValue js_getChildren(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    JSValue arr = JS_NewArray(ctx);
    if (auto* c = g_app->registry->tryGet<ecs::Children>(esn_entity(ctx, argv[0]))) {
        uint32_t i = 0;
        for (Entity child : c->entities) {
            JS_SetPropertyUint32(ctx, arr, i++, JS_NewUint32(ctx, child.id()));
        }
    }
    return arr;
}

// ---- resources + clear (not reflected; the native ResourceManagerBindings analog) -

JSValue js_setClear(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double r = 0, g = 0, b = 0;
    JS_ToFloat64(ctx, &r, argv[0]); JS_ToFloat64(ctx, &g, argv[1]); JS_ToFloat64(ctx, &b, argv[2]);
    g_app->clear = {(f32)r, (f32)g, (f32)b, 1.0f};
    return JS_UNDEFINED;
}
// Read a byte source into `out`, whatever shape the SDK handed us: a raw
// ArrayBuffer (audio clip bytes, cache writes), a Uint8Array (texture pixels), or
// a plain JS number array (the tiny inline checker some scripts build).
void readByteSource(JSContext* ctx, JSValueConst v, std::vector<u8>& out) {
    // Raw ArrayBuffer first — a typed-array view is not one, so it falls through.
    size_t rawSize = 0;
    if (uint8_t* raw = JS_GetArrayBuffer(ctx, &rawSize, v)) {
        out.assign(raw, raw + rawSize);
        return;
    }
    JS_FreeValue(ctx, JS_GetException(ctx));   // not a raw ArrayBuffer — try a view

    size_t byteOffset = 0, byteLen = 0, bytesPerEl = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, v, &byteOffset, &byteLen, &bytesPerEl);
    if (!JS_IsException(ab)) {
        size_t abSize = 0;
        uint8_t* base = JS_GetArrayBuffer(ctx, &abSize, ab);
        if (base && byteOffset + byteLen <= abSize) {
            out.assign(base + byteOffset, base + byteOffset + byteLen);
        }
        JS_FreeValue(ctx, ab);
        return;
    }
    JS_FreeValue(ctx, ab);
    JS_FreeValue(ctx, JS_GetException(ctx));   // not a typed array — clear + index it
    uint32_t len = 0;
    JSValue lv = JS_GetPropertyStr(ctx, v, "length");
    JS_ToUint32(ctx, &len, lv);
    JS_FreeValue(ctx, lv);
    out.resize(len);
    for (uint32_t i = 0; i < len; ++i) {
        JSValue el = JS_GetPropertyUint32(ctx, v, i);
        int32_t iv = 0;
        JS_ToInt32(ctx, &iv, el);
        out[i] = (u8)iv;
        JS_FreeValue(ctx, el);
    }
}

// The texture format at the JS boundary — mirrors bindings/ResourceManagerBindings
// boundaryTextureFormat so native and web upload colour identically (format 0 = RGB8;
// else sRGB variant under the linear pipeline, plain RGBA8 in gamma).
TextureFormat boundaryTextureFormat(int32_t format) {
    if (format == 0) return TextureFormat::RGB8;
    if (resource::ShaderParser::linearColorSpace()) return TextureFormat::SRGB8A8;
    return TextureFormat::RGBA8;
}

// es_createTexture(w, h, pixels, format?, flip?, filter?, wrap?) -> handle id.
// Backs the native ResourceManager's createTextureFromBytes: the SDK decodes an
// image to RGBA (loadImagePixels) and hands the bytes here — no wasm heap.
//
// filter/wrap carry the cooked-asset import settings (a scene's
// textureImporterSettings, threaded through the shared runtime loader). Each is a
// number or undefined; honor them exactly as the web embind rm_createTextureEx
// does (filter 0=Nearest/else Linear; wrap 0=Repeat/1=ClampToEdge/2=MirroredRepeat)
// so native sampling matches web — pixel art stays crisp. With neither, the plain
// createTexture path is unchanged.
JSValue js_createTexture(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    int32_t w = 0, h = 0;
    JS_ToInt32(ctx, &w, argv[0]);
    JS_ToInt32(ctx, &h, argv[1]);
    std::vector<u8> pixels;
    readByteSource(ctx, argv[2], pixels);

    int32_t format = 1;                     // default: colour (RGBA8 / sRGB)
    if (argc > 3 && !JS_IsUndefined(argv[3])) JS_ToInt32(ctx, &format, argv[3]);
    const bool flip = (argc > 4 && !JS_IsUndefined(argv[4])) ? JS_ToBool(ctx, argv[4]) != 0 : false;
    const TextureFormat fmt = boundaryTextureFormat(format);
    auto& rm = g_app->ctx->require<resource::ResourceManager>();

    const bool hasFilter = argc > 5 && !JS_IsUndefined(argv[5]);
    const bool hasWrap = argc > 6 && !JS_IsUndefined(argv[6]);
    if (!hasFilter && !hasWrap) {
        auto handle = rm.createTexture(
            (u32)w, (u32)h, ConstSpan<u8>(pixels.data(), pixels.size()), fmt, flip);
        return JS_NewInt64(ctx, (int64_t)handle.id());
    }

    TextureSpecification spec;
    spec.width = (u32)w;
    spec.height = (u32)h;
    spec.format = fmt;
    spec.generateMips = false;              // decoded 2D sprites, like the web Ex path
    if (hasFilter) {
        int32_t f = 1;
        JS_ToInt32(ctx, &f, argv[5]);
        spec.minFilter = (f == 0) ? TextureFilter::Nearest : TextureFilter::Linear;
        spec.magFilter = spec.minFilter;
    }
    if (hasWrap) {
        int32_t wm = 1;
        JS_ToInt32(ctx, &wm, argv[6]);
        const TextureWrap tw = (wm == 0) ? TextureWrap::Repeat
                             : (wm == 2) ? TextureWrap::MirroredRepeat
                                         : TextureWrap::ClampToEdge;
        spec.wrapS = tw;
        spec.wrapT = tw;
    }
    auto handle = rm.createTexture(spec);
    if (auto* tex = rm.getTexture(handle); tex && !pixels.empty()) {
        const u64 required = (u64)w * (u64)h * (fmt == TextureFormat::RGB8 ? 3 : 4);
        if (pixels.size() >= required) tex->setDataRaw(pixels.data(), (u32)required, flip);
    }
    return JS_NewInt64(ctx, (int64_t)handle.id());
}

// es_createTextureKTX2(ArrayBuffer|TypedArray, srgb?) -> { id, width, height } | null.
// Transcodes a KTX2/Basis container to the best device-supported compressed format
// (or RGBA32) and uploads it — the native counterpart of the web WebGL2 path.
JSValue js_createTextureKTX2(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NULL;
    std::vector<u8> bytes;
    readByteSource(ctx, argv[0], bytes);
    if (bytes.empty()) return JS_NULL;
    const bool srgb = argc > 1 && JS_ToBool(ctx, argv[1]) != 0;
    auto r = eshost::transcodeKTX2(bytes.data(), bytes.size(), srgb,
                                   g_app->ctx->require<resource::ResourceManager>(), *g_app->gfx);
    if (r.handle < 0) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "id", JS_NewInt32(ctx, r.handle));
    JS_SetPropertyStr(ctx, o, "width", JS_NewInt32(ctx, r.width));
    JS_SetPropertyStr(ctx, o, "height", JS_NewInt32(ctx, r.height));
    return o;
}

// es_releaseTexture(handle) — drop one native ResourceManager reference.
JSValue js_releaseTexture(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    int64_t id = 0;
    JS_ToInt64(ctx, &id, argv[0]);
    g_app->ctx->require<resource::ResourceManager>().releaseTexture(
        resource::TextureHandle((u32)id));
    return JS_UNDEFINED;
}

// es_getTextureDimensions(handle) -> { width, height } | null.
JSValue js_getTextureDimensions(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    int64_t id = 0;
    JS_ToInt64(ctx, &id, argv[0]);
    auto* tex = g_app->ctx->require<resource::ResourceManager>().getTexture(
        resource::TextureHandle((u32)id));
    if (!tex) return JS_NULL;
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "width", JS_NewInt32(ctx, (int32_t)tex->getWidth()));
    JS_SetPropertyStr(ctx, obj, "height", JS_NewInt32(ctx, (int32_t)tex->getHeight()));
    return obj;
}

// es_getTextureRenderId(handle) -> the id a draw command binds this texture by
// (Texture::getId(), backend-neutral). The SDK's glyph atlas passes it straight
// to the text batch, exactly as the web path does through getTextureGLId.
JSValue js_getTextureRenderId(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    int64_t id = 0;
    JS_ToInt64(ctx, &id, argv[0]);
    auto* tex = g_app->ctx->require<resource::ResourceManager>().getTexture(
        resource::TextureHandle((u32)id));
    return JS_NewInt64(ctx, tex ? (int64_t)tex->getId() : 0);
}

// es_updateTextureSubregion(handle, x, y, w, h, pixels) — upload one rect of an
// existing texture. The dynamic glyph atlas packs glyphs into a page this way
// instead of re-uploading the whole page per glyph.
JSValue js_updateTextureSubregion(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 6) return JS_UNDEFINED;
    int64_t id = 0; JS_ToInt64(ctx, &id, argv[0]);
    int32_t x = 0, y = 0, w = 0, h = 0;
    JS_ToInt32(ctx, &x, argv[1]); JS_ToInt32(ctx, &y, argv[2]);
    JS_ToInt32(ctx, &w, argv[3]); JS_ToInt32(ctx, &h, argv[4]);
    if (w <= 0 || h <= 0) return JS_UNDEFINED;
    std::vector<u8> pixels;
    readByteSource(ctx, argv[5], pixels);
    if (pixels.empty()) return JS_UNDEFINED;
    auto* tex = g_app->ctx->require<resource::ResourceManager>().getTexture(
        resource::TextureHandle((u32)id));
    if (!tex) return JS_UNDEFINED;
    // updateSubRegion bounds-checks the rect and the buffer size itself.
    tex->updateSubRegion((u32)x, (u32)y, (u32)w, (u32)h, pixels.data(), (u32)pixels.size(), /*flipY=*/false);
    return JS_UNDEFINED;
}

// es_rasterizeGlyph({ codepoint, fontFamily, style, pixelSize, sdf, padding })
// -> { pixels: ArrayBuffer, width, height, advance, bearingX, bearingY } | null.
// The device's answer to the browser's 2D canvas; see glyph_raster.hpp.
JSValue js_rasterizeGlyph(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1 || !g_app || !g_app->platform) return JS_NULL;
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

    const auto glyph = eshost::rasterizeGlyph(
        *g_app->platform,
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

// Read a typed array's elements without copying more than the view. Returns the
// element pointer + count, or {nullptr, 0} when the value is not a typed array.
template <typename T>
std::pair<const T*, size_t> typedArrayView(JSContext* ctx, JSValueConst v, std::vector<u8>& storage) {
    storage.clear();
    readByteSource(ctx, v, storage);
    if (storage.size() < sizeof(T)) return {nullptr, 0};
    return {reinterpret_cast<const T*>(storage.data()), storage.size() / sizeof(T)};
}

// es_submitTextBatch(vertices, vertexCount, indices, textureId, transform,
//                    entity, layer, depth, sdf)
// The SDK lays glyph quads out against the atlas and hands them here — the native
// counterpart of the web's renderer_submitTextBatch, minus the wasm heap.
JSValue js_submitTextBatch(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 9 || !g_app || !g_app->ctx) return JS_UNDEFINED;
    std::vector<u8> vBytes, iBytes, tBytes;
    auto [vertices, vertexFloats] = typedArrayView<f32>(ctx, argv[0], vBytes);
    int32_t vertexCount = 0; JS_ToInt32(ctx, &vertexCount, argv[1]);
    auto [indices, indexCount] = typedArrayView<u16>(ctx, argv[2], iBytes);
    int64_t textureId = 0; JS_ToInt64(ctx, &textureId, argv[3]);
    auto [transform, transformFloats] = typedArrayView<f32>(ctx, argv[4], tBytes);
    int64_t entity = 0; JS_ToInt64(ctx, &entity, argv[5]);
    int32_t layer = 0; JS_ToInt32(ctx, &layer, argv[6]);
    double depth = 0; JS_ToFloat64(ctx, &depth, argv[7]);
    const bool sdf = JS_ToBool(ctx, argv[8]) != 0;

    // The vertex format is x,y,u,v,r,g,b,a — 8 floats each; validate before the
    // renderer trusts the spans, as the web binding's boundarySpan does.
    if (!vertices || !indices || !transform) return JS_UNDEFINED;
    if (vertexCount <= 0 || indexCount == 0 || transformFloats < 16) return JS_UNDEFINED;
    if (vertexFloats < (size_t)vertexCount * 8) return JS_UNDEFINED;

    g_app->ctx->require<RenderFrame>().submitTextBatch(
        vertices, vertexCount, indices, (i32)indexCount, (u32)textureId, transform,
        Entity::fromRaw((u32)entity), layer, (f32)depth, sdf);
    return JS_UNDEFINED;
}

std::vector<u8> readAsset(App& a, const char* path) {
    return a.platform ? a.platform->readAsset(path) : std::vector<u8>{};
}

// es_readAsset(path) -> ArrayBuffer | null. Backs the bridge's readFile.
JSValue js_readAsset(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_NULL;
    std::vector<u8> bytes = readAsset(*g_app, path);
    JS_FreeCString(ctx, path);
    if (bytes.empty()) return JS_NULL;
    return JS_NewArrayBufferCopy(ctx, bytes.data(), bytes.size());
}

// es_loadImagePixels(path) -> { width, height, pixels: ArrayBuffer(RGBA) } | null.
// Decodes a packaged image asset to top-first RGBA via stb_image — the native
// NativeBridge.loadImagePixels ("Path 2": decode -> createTextureFromPixels).
JSValue js_loadImagePixels(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_NULL;
    std::vector<u8> file = readAsset(*g_app, path);
    JS_FreeCString(ctx, path);
    if (file.empty()) return JS_NULL;
    int w = 0, h = 0, ch = 0;
    stbi_uc* px = stbi_load_from_memory(file.data(), (int)file.size(), &w, &h, &ch, 4);
    if (!px) { LOGE("stb_image decode failed"); return JS_NULL; }
    JSValue buf = JS_NewArrayBufferCopy(ctx, px, (size_t)w * (size_t)h * 4);
    stbi_image_free(px);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "width", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, obj, "height", JS_NewInt32(ctx, h));
    JS_SetPropertyStr(ctx, obj, "pixels", buf);   // ArrayBuffer; the bootstrap wraps it Uint8Array
    return obj;
}

// ---- audio: es_audio* over the native AudioEngine (miniaudio) ----------------
// Bound only when the engine has a device (see initJS); a host without one binds
// none, so the SDK's hasAudioBindings() is false and audio stays the Null backend.

// es_audioLoad(ArrayBuffer | TypedArray) -> { id, duration, bytes } | null. The
// SDK hands the compressed clip bytes; the engine decodes + registers them.
JSValue js_audioLoad(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NULL;
    std::vector<u8> bytes;
    readByteSource(ctx, argv[0], bytes);
    if (bytes.empty()) return JS_NULL;
    auto r = g_app->audio.load(bytes.data(), bytes.size());
    if (r.id < 0) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "id", JS_NewInt32(ctx, r.id));
    JS_SetPropertyStr(ctx, o, "duration", JS_NewFloat64(ctx, r.duration));
    JS_SetPropertyStr(ctx, o, "bytes", JS_NewInt64(ctx, r.bytes));
    return o;
}
JSValue js_audioUnload(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    int32_t id = 0; JS_ToInt32(ctx, &id, argv[0]);
    g_app->audio.unload(id);
    return JS_UNDEFINED;
}

// es_audioPlay(bufferId, volume, pan, loop, rate) -> voiceId (-1 if unknown).
JSValue js_audioPlay(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    int32_t buf = 0; JS_ToInt32(ctx, &buf, argv[0]);
    double vol = 1, pan = 0, rate = 1;
    if (argc > 1) JS_ToFloat64(ctx, &vol, argv[1]);
    if (argc > 2) JS_ToFloat64(ctx, &pan, argv[2]);
    const bool loop = argc > 3 && JS_ToBool(ctx, argv[3]);
    if (argc > 4) JS_ToFloat64(ctx, &rate, argv[4]);
    return JS_NewInt32(ctx, g_app->audio.play(buf, (f32)vol, (f32)pan, loop, (f32)rate));
}

// The voice-scoped commands all take the voice id as argv[0].
int32_t voiceArg(JSContext* ctx, JSValueConst* argv) {
    int32_t v = 0; JS_ToInt32(ctx, &v, argv[0]); return v;
}
JSValue js_audioStop(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    g_app->audio.stop(voiceArg(ctx, argv)); return JS_UNDEFINED;
}
JSValue js_audioPause(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    g_app->audio.pause(voiceArg(ctx, argv)); return JS_UNDEFINED;
}
JSValue js_audioResume(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    g_app->audio.resume(voiceArg(ctx, argv)); return JS_UNDEFINED;
}
JSValue js_audioSetVolume(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double v = 1; JS_ToFloat64(ctx, &v, argv[1]);
    g_app->audio.setVolume(voiceArg(ctx, argv), (f32)v); return JS_UNDEFINED;
}
JSValue js_audioSetPan(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double p = 0; JS_ToFloat64(ctx, &p, argv[1]);
    g_app->audio.setPan(voiceArg(ctx, argv), (f32)p); return JS_UNDEFINED;
}
JSValue js_audioSetLoop(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    g_app->audio.setLoop(voiceArg(ctx, argv), JS_ToBool(ctx, argv[1]) != 0); return JS_UNDEFINED;
}
JSValue js_audioSetRate(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    double r = 1; JS_ToFloat64(ctx, &r, argv[1]);
    g_app->audio.setRate(voiceArg(ctx, argv), (f32)r); return JS_UNDEFINED;
}

// es_audioVoiceState(voiceId) -> { playing, currentTime } | null (null once ended).
JSValue js_audioVoiceState(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    auto st = g_app->audio.voiceState(voiceArg(ctx, argv));
    if (!st.valid) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "playing", JS_NewBool(ctx, st.playing));
    JS_SetPropertyStr(ctx, o, "currentTime", JS_NewFloat64(ctx, st.currentTime));
    return o;
}
JSValue js_audioSuspendAll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    g_app->audio.suspendAll(); return JS_UNDEFINED;
}
JSValue js_audioResumeAll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    g_app->audio.resumeAll(); return JS_UNDEFINED;
}

// console.* — QuickJS ships no console at all, so without this a game script's
// first console.log is a ReferenceError and every rejected promise is silent.
JSValue jsConsoleWrite(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv, bool error) {
    std::string line;
    for (int i = 0; i < argc; ++i) {
        const char* s = JS_ToCString(ctx, argv[i]);
        if (!s) continue;
        if (!line.empty()) line += ' ';
        line += s;
        JS_FreeCString(ctx, s);
    }
    hostLog(error, "%s", line.c_str());
    return JS_UNDEFINED;
}
JSValue js_consoleLog(JSContext* ctx, JSValueConst t, int argc, JSValueConst* argv) {
    return jsConsoleWrite(ctx, t, argc, argv, false);
}
JSValue js_consoleError(JSContext* ctx, JSValueConst t, int argc, JSValueConst* argv) {
    return jsConsoleWrite(ctx, t, argc, argv, true);
}

JSValue jsAddTimer(JSContext* ctx, int argc, JSValueConst* argv, bool repeat) {
    if (argc < 1 || !JS_IsFunction(ctx, argv[0])) return JS_NewInt64(ctx, 0);
    double delay = 0;
    if (argc > 1) JS_ToFloat64(ctx, &delay, argv[1]);
    if (!(delay >= 0)) delay = 0;                      // also catches NaN
    App& a = *g_app;
    const int64_t id = a.next_timer_id++;
    // A zero-delay interval would fire forever within one pump; clamp as browsers do.
    a.timers.push_back(Timer{id, nowMs() + delay, repeat ? (delay > 1 ? delay : 1) : 0,
                             JS_DupValue(ctx, argv[0])});
    return JS_NewInt64(ctx, id);
}
JSValue js_setTimeout(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    return jsAddTimer(ctx, argc, argv, false);
}
JSValue js_setInterval(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    return jsAddTimer(ctx, argc, argv, true);
}
JSValue js_clearTimer(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    int64_t id = 0;
    if (argc > 0) JS_ToInt64(ctx, &id, argv[0]);
    App& a = *g_app;
    for (auto it = a.timers.begin(); it != a.timers.end(); ++it) {
        if (it->id != id) continue;
        JS_FreeValue(a.js, it->fn);
        a.timers.erase(it);
        break;
    }
    return JS_UNDEFINED;
}

JSValue js_performanceNow(JSContext* ctx, JSValueConst, int, JSValueConst*) {
    return JS_NewFloat64(ctx, nowMs());
}

// The host's writable store, under Platform::cacheDir(). Backs both the
// hot-update offline cache and (through it) key-value storage. Keys are
// content hashes or plain names; anything else is refused rather than escaping
// the directory.
std::string cachePathFor(const char* key) {
    if (!key || !*key || g_app->cacheDir.empty()) return {};
    for (const char* c = key; *c; ++c) {
        const bool ok = (*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z')
                        || (*c >= '0' && *c <= '9') || *c == '.' || *c == '_' || *c == '-';
        if (!ok) return {};
    }
    return g_app->cacheDir + "/" + key;
}

// es_readCacheFile(key) -> ArrayBuffer | null.
JSValue js_readCacheFile(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* key = JS_ToCString(ctx, argv[0]);
    const std::string path = cachePathFor(key);
    if (key) JS_FreeCString(ctx, key);
    if (path.empty()) return JS_NULL;
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return JS_NULL;
    fseek(f, 0, SEEK_END);
    const long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    std::vector<u8> bytes(size > 0 ? (size_t)size : 0);
    if (!bytes.empty() && fread(bytes.data(), 1, bytes.size(), f) != bytes.size()) bytes.clear();
    fclose(f);
    if (bytes.empty()) return JS_NULL;
    return JS_NewArrayBufferCopy(ctx, bytes.data(), bytes.size());
}

// es_writeCacheFile(key, ArrayBuffer | TypedArray | string) -> bool. A string is
// written as UTF-8, so script-side JSON needs no TextEncoder.
JSValue js_writeCacheFile(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 2) return JS_FALSE;
    const char* key = JS_ToCString(ctx, argv[0]);
    const std::string path = cachePathFor(key);
    if (key) JS_FreeCString(ctx, key);
    if (path.empty()) return JS_FALSE;
    std::vector<u8> bytes;
    if (JS_IsString(argv[1])) {
        size_t len = 0;
        if (const char* text = JS_ToCStringLen(ctx, &len, argv[1])) {
            bytes.assign(text, text + len);
            JS_FreeCString(ctx, text);
        }
    } else {
        readByteSource(ctx, argv[1], bytes);
    }
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) return JS_FALSE;
    const bool ok = bytes.empty() || fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
    fclose(f);
    return ok ? JS_TRUE : JS_FALSE;
}

// es_utf8Decode(ArrayBuffer | TypedArray) -> string. Backs the TextDecoder the
// platform layer uses to read packaged JSON (manifests, scenes); QuickJS parses
// UTF-8 natively, so this beats decoding byte-by-byte in script.
JSValue js_utf8Decode(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 1) return JS_NewString(ctx, "");
    size_t size = 0;
    if (uint8_t* raw = JS_GetArrayBuffer(ctx, &size, argv[0])) {
        return JS_NewStringLen(ctx, reinterpret_cast<const char*>(raw), size);
    }
    JS_FreeValue(ctx, JS_GetException(ctx));   // not an ArrayBuffer — try a view
    size_t offset = 0, length = 0, bytesPerEl = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &offset, &length, &bytesPerEl);
    if (JS_IsException(ab)) { JS_FreeValue(ctx, JS_GetException(ctx)); return JS_NewString(ctx, ""); }
    uint8_t* base = JS_GetArrayBuffer(ctx, &size, ab);
    JSValue out = (base && offset + length <= size)
        ? JS_NewStringLen(ctx, reinterpret_cast<const char*>(base + offset), length)
        : JS_NewString(ctx, "");
    JS_FreeValue(ctx, ab);
    return out;
}

void logJsError(JSContext* ctx, const char* where) {
    JSValue e = JS_GetException(ctx);
    const char* s = JS_ToCString(ctx, e);
    LOGE("JS error in %s: %s", where, s ? s : "?");
    if (s) JS_FreeCString(ctx, s);
    JS_FreeValue(ctx, e);
}
void evalJs(App& a, const char* src, const char* name) {
    JSValue r = JS_Eval(a.js, src, strlen(src), name, JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(r)) logJsError(a.js, name);
    JS_FreeValue(a.js, r);
}
void callJs(App& a, const char* fn, int argc, JSValue* argv) {
    JSValue global = JS_GetGlobalObject(a.js);
    JSValue f = JS_GetPropertyStr(a.js, global, fn);
    if (JS_IsFunction(a.js, f)) {
        JSValue r = JS_Call(a.js, f, global, argc, argv);
        if (JS_IsException(r)) logJsError(a.js, fn);
        JS_FreeValue(a.js, r);
    }
    JS_FreeValue(a.js, f);
    JS_FreeValue(a.js, global);
}

// ---- HTTP: es_fetch over the platform's native networking -------------------

std::string fetchStrProp(JSContext* ctx, JSValueConst obj, const char* key, const char* dflt) {
    JSValue v = JS_GetPropertyStr(ctx, obj, key);
    std::string out = dflt ? dflt : "";
    if (JS_IsString(v)) {
        if (const char* s = JS_ToCString(ctx, v)) { out = s; JS_FreeCString(ctx, s); }
    }
    JS_FreeValue(ctx, v);
    return out;
}

void readFetchHeaders(JSContext* ctx, JSValueConst obj, eshost::FetchRequest& req) {
    JSValue h = JS_GetPropertyStr(ctx, obj, "headers");
    if (JS_IsObject(h)) {
        JSPropertyEnum* tab = nullptr;
        uint32_t len = 0;
        if (JS_GetOwnPropertyNames(ctx, &tab, &len, h, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) == 0) {
            for (uint32_t i = 0; i < len; ++i) {
                const char* key = JS_AtomToCString(ctx, tab[i].atom);
                JSValue val = JS_GetProperty(ctx, h, tab[i].atom);
                const char* vs = JS_ToCString(ctx, val);
                if (key && vs) req.headers.emplace_back(key, vs);
                if (vs) JS_FreeCString(ctx, vs);
                if (key) JS_FreeCString(ctx, key);
                JS_FreeValue(ctx, val);
            }
            JS_FreePropertyEnum(ctx, tab, len);
        }
    }
    JS_FreeValue(ctx, h);
}

// es_fetch(request, callback): request = { url, method?, headers?, body?,
// responseType? }. Runs the request off the main thread and calls back with
// { ok, status, statusText, headers, arrayBuffer | text, error? }. The bridge
// wraps this in a Promise. responseType 'text' returns a string; everything else
// returns an ArrayBuffer (the bridge decodes text/json from it on demand).
JSValue js_fetch(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 2 || !JS_IsObject(argv[0]) || !JS_IsFunction(ctx, argv[1])) return JS_UNDEFINED;
    eshost::FetchRequest req;
    req.id = g_app->nextFetchId++;
    req.url = fetchStrProp(ctx, argv[0], "url", "");
    req.method = fetchStrProp(ctx, argv[0], "method", "GET");
    req.wantText = fetchStrProp(ctx, argv[0], "responseType", "arraybuffer") == "text";
    readFetchHeaders(ctx, argv[0], req);
    JSValue body = JS_GetPropertyStr(ctx, argv[0], "body");
    if (JS_IsString(body)) {
        size_t len = 0;
        if (const char* s = JS_ToCStringLen(ctx, &len, body)) {
            req.body.assign(s, s + len);
            JS_FreeCString(ctx, s);
        }
    } else if (!JS_IsUndefined(body) && !JS_IsNull(body)) {
        readByteSource(ctx, body, req.body);
    }
    JS_FreeValue(ctx, body);

    g_app->fetchCallbacks[req.id] = JS_DupValue(ctx, argv[1]);
    if (req.url.empty()) {
        eshost::FetchResult err;
        err.id = req.id;
        err.error = "es_fetch: missing url";
        eshost::deliverFetch(std::move(err));
    } else {
        g_app->platform->startFetch(req);
    }
    return JS_UNDEFINED;
}

JSValue makeFetchResult(App& a, const eshost::FetchResult& r) {
    JSValue o = JS_NewObject(a.js);
    JS_SetPropertyStr(a.js, o, "ok", JS_NewBool(a.js, r.ok));
    JS_SetPropertyStr(a.js, o, "status", JS_NewInt32(a.js, r.status));
    JS_SetPropertyStr(a.js, o, "statusText", JS_NewString(a.js, r.statusText.c_str()));
    if (!r.error.empty()) JS_SetPropertyStr(a.js, o, "error", JS_NewString(a.js, r.error.c_str()));
    JSValue h = JS_NewObject(a.js);
    for (const auto& kv : r.headers) {
        JS_SetPropertyStr(a.js, h, kv.first.c_str(), JS_NewString(a.js, kv.second.c_str()));
    }
    JS_SetPropertyStr(a.js, o, "headers", h);
    if (r.isText) {
        JS_SetPropertyStr(a.js, o, "text",
            JS_NewStringLen(a.js, reinterpret_cast<const char*>(r.body.data()), r.body.size()));
    } else {
        JS_SetPropertyStr(a.js, o, "arrayBuffer",
            JS_NewArrayBufferCopy(a.js, r.body.data(), r.body.size()));
    }
    return o;
}

// Run the JS callbacks for HTTP replies that arrived since the last frame — JS
// thread only. deliverFetch queued them (POD) from the completion thread.
void drainFetches(App& a) {
    std::queue<eshost::FetchResult> done;
    { std::lock_guard<std::mutex> lk(g_fetchMutex); done.swap(g_fetchQueue); }
    while (!done.empty()) {
        const eshost::FetchResult r = std::move(done.front());
        done.pop();
        auto it = a.fetchCallbacks.find(r.id);
        if (it == a.fetchCallbacks.end()) continue;   // never happens, but stay safe
        JSValue cb = it->second;
        a.fetchCallbacks.erase(it);
        JSValue arg = makeFetchResult(a, r);
        JSValue ret = JS_Call(a.js, cb, JS_UNDEFINED, 1, &arg);
        if (JS_IsException(ret)) logJsError(a.js, "es_fetch callback");
        JS_FreeValue(a.js, ret);
        JS_FreeValue(a.js, arg);
        JS_FreeValue(a.js, cb);
    }
}

// Drain QuickJS's microtask queue. app.tick() is async: its synchronous prefix
// (finishPlugins, resource inserts) runs on call, but the systems run in jobs.
void pumpJobs(App& a) {
    JSContext* c;
    while (JS_ExecutePendingJob(a.rt, &c) > 0) { /* ran a job */ }
}

// Fire the timers that came due. Callbacks may add or clear timers, so they run
// off a snapshot rather than while iterating.
void pumpTimers(App& a) {
    const double now = nowMs();
    std::vector<Timer> due;
    for (auto it = a.timers.begin(); it != a.timers.end();) {
        if (it->due > now) { ++it; continue; }
        due.push_back(*it);
        if (it->interval > 0) { it->due = now + it->interval; ++it; }
        else it = a.timers.erase(it);
    }
    for (Timer& t : due) {
        JSValue r = JS_Call(a.js, t.fn, JS_UNDEFINED, 0, nullptr);
        if (JS_IsException(r)) logJsError(a.js, "timer callback");
        JS_FreeValue(a.js, r);
        if (t.interval <= 0) JS_FreeValue(a.js, t.fn);   // the erased entry's reference
    }
}

/// One turn of the host's event loop: microtasks, then timers, then whatever
/// microtasks those timers queued.
void pumpJs(App& a) {
    pumpJobs(a);
    pumpTimers(a);
    pumpJobs(a);
}

void bindGlobal(App& a, JSValue global, const char* name, JSCFunction* fn, int argc) {
    JS_SetPropertyStr(a.js, global, name, JS_NewCFunction(a.js, fn, name, argc));
}

double nowMs() {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

// FNV-1a of the bundle — a changed SDK invalidates its bytecode cache.
uint64_t hashBytes(const char* p, size_t n) {
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < n; i++) { h ^= (uint8_t)p[i]; h *= 1099511628211ull; }
    return h;
}

// Evaluate a global script, reusing a cached bytecode compile. QuickJS is an
// interpreter: parsing the ~700 KB SDK bundle costs ~8 s every launch. So compile
// once (JS_WriteObject the bytecode, tagged with the bundle hash), and on later
// launches JS_ReadObject it — skipping the parse. The same QuickJS build writes and
// reads it, so the format always matches; the hash guards against a stale bundle,
// and a bad read just recompiles. Cache file: [8-byte hash][bytecode].
JSValue evalCachedScript(App& a, const char* src, size_t srcLen, const char* filename,
                         const std::string& cachePath) {
    const uint64_t want = hashBytes(src, srcLen);

    if (!cachePath.empty()) {
        FILE* f = fopen(cachePath.c_str(), "rb");
        if (f) {
            uint64_t got = 0;
            std::vector<u8> bc;
            if (fread(&got, sizeof(got), 1, f) == 1 && got == want) {
                fseek(f, 0, SEEK_END);
                long sz = ftell(f);
                fseek(f, (long)sizeof(got), SEEK_SET);
                if (sz > (long)sizeof(got)) {
                    bc.resize((size_t)sz - sizeof(got));
                    if (fread(bc.data(), 1, bc.size(), f) != bc.size()) bc.clear();
                }
            }
            fclose(f);
            if (!bc.empty()) {
                JSValue obj = JS_ReadObject(a.js, bc.data(), bc.size(), JS_READ_OBJ_BYTECODE);
                if (!JS_IsException(obj)) {
                    LOGI("SDK bundle: loaded from bytecode cache");
                    return JS_EvalFunction(a.js, obj);
                }
                JSValue e = JS_GetException(a.js); JS_FreeValue(a.js, e);  // stale/corrupt -> recompile
            }
        }
    }

    // Parse once (slow), cache the bytecode, run.
    JSValue fn = JS_Eval(a.js, src, srcLen, filename, JS_EVAL_TYPE_GLOBAL | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(fn)) return fn;
    if (!cachePath.empty()) {
        size_t bcLen = 0;
        uint8_t* bc = JS_WriteObject(a.js, &bcLen, fn, JS_WRITE_OBJ_BYTECODE);
        if (bc) {
            FILE* f = fopen(cachePath.c_str(), "wb");
            if (f) { fwrite(&want, sizeof(want), 1, f); fwrite(bc, 1, bcLen, f); fclose(f); }
            js_free(a.js, bc);
            LOGI("SDK bundle: compiled + cached bytecode (%zu bytes)", bcLen);
        }
    }
    return JS_EvalFunction(a.js, fn);   // consumes fn
}

void initJS(App& a) {
    const double t0 = nowMs();
    a.rt = JS_NewRuntime();
    a.js = JS_NewContext(a.rt);
    JSValue global = JS_GetGlobalObject(a.js);

    JS_SetPropertyStr(a.js, global, "W", JS_NewFloat64(a.js, a.w));
    JS_SetPropertyStr(a.js, global, "H", JS_NewFloat64(a.js, a.h));
    JS_SetPropertyStr(a.js, global, "S", JS_NewFloat64(a.js, a.w < a.h ? a.w : a.h));

    // The host environment the SDK expects but QuickJS (a language, not a runtime)
    // does not provide: console, timers and a monotonic clock. Without them a
    // rejected promise is silent and the asset cache's setTimeout throws.
    JSValue console = JS_NewObject(a.js);
    for (const char* name : {"log", "info", "debug", "trace"}) {
        JS_SetPropertyStr(a.js, console, name, JS_NewCFunction(a.js, js_consoleLog, name, 1));
    }
    for (const char* name : {"warn", "error"}) {
        JS_SetPropertyStr(a.js, console, name, JS_NewCFunction(a.js, js_consoleError, name, 1));
    }
    JS_SetPropertyStr(a.js, global, "console", console);

    bindGlobal(a, global, "setTimeout", js_setTimeout, 2);
    bindGlobal(a, global, "setInterval", js_setInterval, 2);
    bindGlobal(a, global, "clearTimeout", js_clearTimer, 1);
    bindGlobal(a, global, "clearInterval", js_clearTimer, 1);
    JSValue perf = JS_NewObject(a.js);
    JS_SetPropertyStr(a.js, perf, "now", JS_NewCFunction(a.js, js_performanceNow, "now", 0));
    JS_SetPropertyStr(a.js, global, "performance", perf);
    bindGlobal(a, global, "es_utf8Decode", js_utf8Decode, 1);
    bindGlobal(a, global, "es_readCacheFile", js_readCacheFile, 1);
    bindGlobal(a, global, "es_writeCacheFile", js_writeCacheFile, 2);
    bindGlobal(a, global, "es_fetch", js_fetch, 2);

    // Entity + hierarchy (base Registry surface).
    bindGlobal(a, global, "es_createEntity", js_createEntity, 0);
    bindGlobal(a, global, "es_destroyEntity", js_destroyEntity, 1);
    bindGlobal(a, global, "es_setParent", js_setParent, 2);
    bindGlobal(a, global, "es_hasParent", js_hasParent, 1);
    bindGlobal(a, global, "es_removeParent", js_removeParent, 1);
    bindGlobal(a, global, "es_hasChildren", js_hasChildren, 1);
    bindGlobal(a, global, "es_getChildren", js_getChildren, 1);
    // Resources + clear + asset reads. es_createTexture / es_releaseTexture /
    // es_getTextureDimensions are the native ResourceManager contract the SDK's
    // createNativeResourceManager binds to (the asset pipeline's texture backend).
    bindGlobal(a, global, "es_setClear", js_setClear, 3);
    bindGlobal(a, global, "es_createTexture", js_createTexture, 3);
    bindGlobal(a, global, "es_createTextureKTX2", js_createTextureKTX2, 2);
    bindGlobal(a, global, "es_releaseTexture", js_releaseTexture, 1);
    bindGlobal(a, global, "es_getTextureDimensions", js_getTextureDimensions, 1);
    bindGlobal(a, global, "es_readAsset", js_readAsset, 1);
    bindGlobal(a, global, "es_loadImagePixels", js_loadImagePixels, 1);
    // Text (es_rasterizeGlyph + es_submitTextBatch + the two texture calls the
    // glyph atlas needs): the SDK's TEXT_BINDINGS, all-or-nothing. The device has
    // no 2D canvas to rasterize on and no wasm heap to submit through; everything
    // between those two — atlas, layout, batching — is the SDK's own code.
    bindGlobal(a, global, "es_rasterizeGlyph", js_rasterizeGlyph, 1);
    bindGlobal(a, global, "es_submitTextBatch", js_submitTextBatch, 9);
    bindGlobal(a, global, "es_updateTextureSubregion", js_updateTextureSubregion, 6);
    bindGlobal(a, global, "es_getTextureRenderId", js_getTextureRenderId, 1);
    // Audio (es_audio*): bound only when a device came up, so the SDK's
    // hasAudioBindings() gates the native audio backend on real availability —
    // a host with no sound device binds none and falls back to the Null backend.
    if (a.audio.ready()) {
        bindGlobal(a, global, "es_audioLoad", js_audioLoad, 1);
        bindGlobal(a, global, "es_audioUnload", js_audioUnload, 1);
        bindGlobal(a, global, "es_audioPlay", js_audioPlay, 5);
        bindGlobal(a, global, "es_audioStop", js_audioStop, 1);
        bindGlobal(a, global, "es_audioPause", js_audioPause, 1);
        bindGlobal(a, global, "es_audioResume", js_audioResume, 1);
        bindGlobal(a, global, "es_audioSetVolume", js_audioSetVolume, 2);
        bindGlobal(a, global, "es_audioSetPan", js_audioSetPan, 2);
        bindGlobal(a, global, "es_audioSetLoop", js_audioSetLoop, 2);
        bindGlobal(a, global, "es_audioSetRate", js_audioSetRate, 2);
        bindGlobal(a, global, "es_audioVoiceState", js_audioVoiceState, 1);
        bindGlobal(a, global, "es_audioSuspendAll", js_audioSuspendAll, 0);
        bindGlobal(a, global, "es_audioResumeAll", js_audioResumeAll, 0);
    }
    // Per-component bindings (EHT-generated): es_set_<C> / es_<C>_buffer / _has / _remove.
    esn_register(a.js, global);
    JS_FreeValue(a.js, global);

    // Layers: the real SDK bundle (engine, embedded) installs ESEngine; the host
    // bootstrap (host platform glue) installs the NativeBridge; the game (a
    // packaged asset, developer content) authors on top.
    const double tCtx = nowMs();
    std::string bcPath = a.cacheDir.empty() ? std::string() : (a.cacheDir + "/esengine.native.bc");
    JSValue br = evalCachedScript(a, kSdkBundleJS, strlen(kSdkBundleJS), "esengine.native.js", bcPath);
    if (JS_IsException(br)) logJsError(a.js, "SDK bundle");
    JS_FreeValue(a.js, br);
    const double tBundle = nowMs();
    evalJs(a, kBootstrapJS, "bootstrap.js");
    // An exported project (game.config.json + manifests + cooked assets) boots
    // through the bootstrap's default init/update. Its own scripts must register
    // their components BEFORE the scene loads. Without that config the package is
    // a hand-written game.js, which replaces init/update outright.
    const bool exported = !readAsset(a, "game.config.json").empty();
    if (exported) {
        std::vector<u8> scripts = readAsset(a, "scripts.js");
        if (!scripts.empty()) {
            evalJs(a, std::string(reinterpret_cast<const char*>(scripts.data()), scripts.size()).c_str(),
                   "scripts.js");
        }
    } else {
        std::vector<u8> game = readAsset(a, "game.js");
        if (game.empty()) {
            LOGE("nothing to run: the package has neither game.config.json (an export) nor game.js");
            return;
        }
        evalJs(a, std::string(reinterpret_cast<const char*>(game.data()), game.size()).c_str(), "game.js");
    }
    const double tGame = nowMs();
    callJs(a, "init", 0, nullptr);
    pumpJs(a);
    const double tInit = nowMs();
    LOGI("boot ms — qjs ctx: %.0f | SDK bundle eval: %.0f | bootstrap+game: %.0f | init(): %.0f | total JS: %.0f",
         tCtx - t0, tBundle - tCtx, tGame - tBundle, tInit - tGame, tInit - t0);
    LOGI("%s init() ran on the real SDK App", exported ? "exported project" : "game.js");
}

}  // namespace

namespace eshost {

bool bindSurface() {
    App& a = *g_app;
    u32 w = 0, h = 0;
    a.platform->surfaceSize(w, h);
    a.w = (f32)w;
    a.h = (f32)h;
    if (!a.gfx->configureSurface(a.platform->surface(), w, h)) {
        LOGE("configureSurface failed");
        return false;
    }
    a.surfaceReady = true;
    return true;
}

void surfaceLost() {
    if (g_app) g_app->surfaceReady = false;
}

bool booted() { return g_app && g_app->ready; }

bool surfaceBound() { return g_app && g_app->surfaceReady; }

bool boot(Platform& platform) {
    static App app;
    g_app = &app;
    App& a = app;
    a.platform = &platform;
    a.cacheDir = platform.cacheDir();

    const double te0 = nowMs();
    WGPUInstanceFeatureName feats[] = {WGPUInstanceFeatureName_TimedWaitAny};
    WGPUInstanceDescriptor idesc = {};
    idesc.requiredFeatureCount = 1;
    idesc.requiredFeatures = feats;
    a.instance = wgpuCreateInstance(&idesc);
    WGPURequestAdapterOptions opts = {};
    opts.backendType = platform.backend();
    auto onA = [](WGPURequestAdapterStatus s, WGPUAdapter ad, WGPUStringView, void* u, void*) {
        if (s == WGPURequestAdapterStatus_Success) *static_cast<WGPUAdapter*>(u) = ad; };
    WGPURequestAdapterCallbackInfo aci = {};
    aci.mode = WGPUCallbackMode_WaitAnyOnly; aci.callback = onA; aci.userdata1 = &a.adapter;
    WGPUFutureWaitInfo af = {wgpuInstanceRequestAdapter(a.instance, &opts, aci), 0};
    wgpuInstanceWaitAny(a.instance, 1, &af, UINT64_MAX);
    if (!a.adapter) { LOGE("no adapter"); return false; }
    auto onD = [](WGPURequestDeviceStatus s, WGPUDevice d, WGPUStringView, void* u, void*) {
        if (s == WGPURequestDeviceStatus_Success) *static_cast<WGPUDevice*>(u) = d; };
    // Enable the block-compression families this adapter supports (ETC2/ASTC/BC)
    // so the engine can create KTX2 textures; a device rejects a format it did not
    // opt into, even when the adapter advertises it.
    WGPUFeatureName compFeats[3];
    size_t compCount = 0;
    for (WGPUFeatureName f : {WGPUFeatureName_TextureCompressionETC2,
                              WGPUFeatureName_TextureCompressionASTC,
                              WGPUFeatureName_TextureCompressionBC}) {
        if (wgpuAdapterHasFeature(a.adapter, f)) compFeats[compCount++] = f;
    }
    WGPUDeviceDescriptor dd = {};
    dd.requiredFeatureCount = compCount;
    dd.requiredFeatures = compCount ? compFeats : nullptr;
    WGPURequestDeviceCallbackInfo dci = {};
    dci.mode = WGPUCallbackMode_WaitAnyOnly; dci.callback = onD; dci.userdata1 = &a.device;
    WGPUFutureWaitInfo df = {wgpuAdapterRequestDevice(a.adapter, &dd, dci), 0};
    wgpuInstanceWaitAny(a.instance, 1, &df, UINT64_MAX);
    if (!a.device) { LOGE("no device"); return false; }

    auto device = makeUnique<WebGPUDevice>(a.device, a.instance, a.adapter);
    a.gfx = device.get();
    if (!bindSurface()) return false;
    static EstellaContext context;
    a.ctx = &context;
    context.state().viewport_width = (i32)a.w;
    context.state().viewport_height = (i32)a.h;
    if (!context.init(std::move(device))) { LOGE("context.init failed"); return false; }
    static ecs::Registry registry;
    a.registry = &registry;
    LOGI("boot ms — Dawn instance/adapter/device + EstellaContext: %.0f", nowMs() - te0);
    LOGI("audio: %s", a.audio.init() ? "native engine up (miniaudio)" : "no device — silent");
    initJS(a);
    a.ready = true;
    LOGI("real SDK up (%dx%d) — esengine World over native Dawn", (int)a.w, (int)a.h);
    return true;
}

void frame() {
    if (!g_app || !g_app->ready || !g_app->surfaceReady) return;
    App& a = *g_app;
    auto& ctx = *a.ctx;
    JSValue dt = JS_NewFloat64(a.js, 1.0 / 60.0);
    callJs(a, "update", 1, &dt);
    JS_FreeValue(a.js, dt);
    pumpJs(a);   // run the App tick's async systems and any timers they set

    // Notify JS of voices that ended on their own (the audio thread never touches
    // QuickJS; we poll on this thread and push, like touch). onEnd handlers may
    // start new sounds synchronously — safe, pumpEnded iterates a snapshot.
    a.audio.pumpEnded([&a](int voiceId) {
        JSValue arg = JS_NewInt32(a.js, voiceId);
        callJs(a, "es_onNativeAudioEnded", 1, &arg);
        JS_FreeValue(a.js, arg);
    });

    // Run the callbacks for any HTTP replies that landed since last frame, then
    // let their .then() continuations run.
    drainFetches(a);
    pumpJs(a);

    ctx.require<RenderContext>().setFrameTime((f32)a.frame / 60.0f, (u32)a.w, (u32)a.h);
    World world{*a.registry, ctx.services(), 1.0f / 60.0f};
    ctx.require<ecs::TransformSystem>().update(world);
    const glm::mat4 vp = glm::ortho(0.0f, a.w, 0.0f, a.h);
    auto& rf = ctx.require<RenderFrame>();
    rf.begin(vp, 0, RenderFrame::PassClear{true, true, a.clear});
    rf.collectAll(*a.registry);
    // What the SDK draws from JS — glyph quads — goes in between collecting the
    // scene and flushing it, which is where the web pipeline runs the same
    // callbacks. Installed by the SDK's native runtime; absent if it has no text.
    callJs(a, "es_jsPreFlush", 0, nullptr);
    rf.flush();
    rf.end();
    a.gfx->present();
    if (++a.frame % 120 == 0) LOGI("real-SDK frame %llu", (unsigned long long)a.frame);
}

// Push one host touch to the game's es_onNativeTouch(type,id,x,y), which fans it
// out to the NativeBridge's registered listener.
void touch(int type, int id, float x, float y) {
    if (!g_app || !g_app->ready) return;
    App& a = *g_app;
    JSValue global = JS_GetGlobalObject(a.js);
    JSValue fn = JS_GetPropertyStr(a.js, global, "es_onNativeTouch");
    if (JS_IsFunction(a.js, fn)) {
        JSValue args[4] = {
            JS_NewInt32(a.js, type), JS_NewInt32(a.js, id),
            JS_NewFloat64(a.js, x), JS_NewFloat64(a.js, y),
        };
        JSValue r = JS_Call(a.js, fn, global, 4, args);
        if (JS_IsException(r)) logJsError(a.js, "es_onNativeTouch");
        JS_FreeValue(a.js, r);
        for (JSValue& v : args) JS_FreeValue(a.js, v);
    }
    JS_FreeValue(a.js, fn);
    JS_FreeValue(a.js, global);
}

// The app went to background (visible=false) or returned. Suspend/resume the
// audio device at the native layer — correct even while the JS tick is paused —
// then push the signal to JS, where the Lifecycle plugin auto-pauses the game.
void setVisible(bool visible) {
    if (!g_app || !g_app->ready) return;
    App& a = *g_app;
    if (visible) a.audio.resumeAll(); else a.audio.suspendAll();
    JSValue arg = JS_NewBool(a.js, visible);
    callJs(a, "es_onNativeVisibility", 1, &arg);
    JS_FreeValue(a.js, arg);
    pumpJs(a);
}

// OS memory pressure — let the SDK's residency caches drop evictable entries
// (the audio buffer cache trims). Held buffers keep playing; only re-fetch cost
// returns for evicted ones.
void memoryWarning() {
    if (!g_app || !g_app->ready) return;
    callJs(*g_app, "es_onNativeMemoryWarning", 0, nullptr);
    pumpJs(*g_app);
}

// Thread-safe: the platform's HTTP completion (any thread) queues its reply here;
// the frame loop drains it on the JS thread (drainFetches). No JS is touched here.
void deliverFetch(FetchResult result) {
    std::lock_guard<std::mutex> lk(g_fetchMutex);
    g_fetchQueue.push(std::move(result));
}

}  // namespace eshost
