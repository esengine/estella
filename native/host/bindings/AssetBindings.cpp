// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetBindings.cpp
 * @brief   Packaged files, image decode, the writable cache, and UTF-8 decoding.
 * @details What the SDK's platform layer reads a game off the device with. The
 *          decode path is "Path 2" — the host decodes an image to RGBA and the
 *          native ResourceManager uploads the bytes — because there is no
 *          offscreen DOM canvas here. The cache is the hot-update offline store:
 *          content-addressed keys written after verification, so a returning
 *          player boots updated content with no network.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "Bindings.hpp"

// stb_image for the native image-decode path (NativeBridge.loadImagePixels). The
// engine core doesn't use stb_image, so this TU owns the implementation.
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#include <cstdio>

using namespace esengine;

namespace eshost {
namespace {

// es_readAsset(path) -> ArrayBuffer | null. Backs the bridge's readFile.
JSValue js_readAsset(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_NULL;
    std::vector<u8> bytes = readAsset(host(), path);
    JS_FreeCString(ctx, path);
    if (bytes.empty()) return JS_NULL;
    return JS_NewArrayBufferCopy(ctx, bytes.data(), bytes.size());
}

// es_loadImagePixels(path) -> { width, height, pixels: ArrayBuffer(RGBA) } | null.
// Decodes a packaged image asset to top-first RGBA via stb_image.
JSValue js_loadImagePixels(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_NULL;
    std::vector<u8> file = readAsset(host(), path);
    JS_FreeCString(ctx, path);
    if (file.empty()) return JS_NULL;
    int w = 0, h = 0, ch = 0;
    stbi_uc* px = stbi_load_from_memory(file.data(), (int)file.size(), &w, &h, &ch, 4);
    if (!px) { ESHOST_LOGE("stb_image decode failed"); return JS_NULL; }
    JSValue buf = JS_NewArrayBufferCopy(ctx, px, (size_t)w * (size_t)h * 4);
    stbi_image_free(px);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "width", JS_NewInt32(ctx, w));
    JS_SetPropertyStr(ctx, obj, "height", JS_NewInt32(ctx, h));
    JS_SetPropertyStr(ctx, obj, "pixels", buf);   // ArrayBuffer; the bootstrap wraps it Uint8Array
    return obj;
}

// The host's writable store, under Platform::cacheDir(). Backs both the
// hot-update offline cache and (through it) key-value storage. Keys are
// content hashes or plain names; anything else is refused rather than escaping
// the directory.
std::string cachePathFor(const char* key) {
    if (!key || !*key || host().cacheDir.empty()) return {};
    for (const char* c = key; *c; ++c) {
        const bool ok = (*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z')
                        || (*c >= '0' && *c <= '9') || *c == '.' || *c == '_' || *c == '-';
        if (!ok) return {};
    }
    return host().cacheDir + "/" + key;
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

}  // namespace

std::vector<u8> readAsset(HostState& h, const char* path) {
    return h.platform ? h.platform->readAsset(path) : std::vector<u8>{};
}

void registerAssetBindings(HostState& h, JSValue global) {
    bindGlobal(h, global, "es_readAsset", js_readAsset, 1);
    bindGlobal(h, global, "es_loadImagePixels", js_loadImagePixels, 1);
    bindGlobal(h, global, "es_readCacheFile", js_readCacheFile, 1);
    bindGlobal(h, global, "es_writeCacheFile", js_writeCacheFile, 2);
    bindGlobal(h, global, "es_utf8Decode", js_utf8Decode, 1);
}

}  // namespace eshost
