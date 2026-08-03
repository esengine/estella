// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AssetBindings.cpp
 * @brief   Packaged files, image decode, the writable stores, and UTF-8 decoding.
 * @details What the SDK's platform layer reads a game off the device with. The
 *          decode path is "Path 2" — the host decodes an image to RGBA and the
 *          native ResourceManager uploads the bytes — because there is no
 *          offscreen DOM canvas here. There are two writable stores, and which
 *          one a caller picks is a statement about what may be lost: the cache
 *          is the hot-update offline store, content-addressed and refetchable,
 *          while data holds what a player would notice gone.
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

// A file in one of the host's two writable directories. Keys are content hashes
// or plain names; anything else is refused rather than escaping the directory.
std::string pathIn(const std::string& dir, const char* key) {
    if (!key || !*key || dir.empty()) return {};
    for (const char* c = key; *c; ++c) {
        const bool ok = (*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z')
                        || (*c >= '0' && *c <= '9') || *c == '.' || *c == '_' || *c == '-';
        if (!ok) return {};
    }
    return dir + "/" + key;
}

JSValue readFileAt(JSContext* ctx, const std::string& path) {
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

// A string source is written as UTF-8, so script-side JSON needs no TextEncoder.
JSValue writeFileAt(JSContext* ctx, const std::string& path, JSValueConst source) {
    if (path.empty()) return JS_FALSE;
    std::vector<u8> bytes;
    if (JS_IsString(source)) {
        size_t len = 0;
        if (const char* text = JS_ToCStringLen(ctx, &len, source)) {
            bytes.assign(text, text + len);
            JS_FreeCString(ctx, text);
        }
    } else {
        readByteSource(ctx, source, bytes);
    }
    // Write a temp file and rename over the target: a crash or a kill mid-write
    // must not leave a truncated file where a save used to be. rename(2) within
    // one directory is atomic, so a reader sees the old file or the new one.
    const std::string tmp = path + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (!f) return JS_FALSE;
    const bool wrote = bytes.empty() || fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
    const bool flushed = wrote && fflush(f) == 0;
    fclose(f);
    if (!flushed || rename(tmp.c_str(), path.c_str()) != 0) {
        remove(tmp.c_str());
        return JS_FALSE;
    }
    return JS_TRUE;
}

// es_readCacheFile(key) -> ArrayBuffer | null. Reclaimable half: hot-update content.
JSValue js_readCacheFile(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* key = JS_ToCString(ctx, argv[0]);
    const std::string path = pathIn(host().cacheDir, key);
    if (key) JS_FreeCString(ctx, key);
    return readFileAt(ctx, path);
}

// es_writeCacheFile(key, ArrayBuffer | TypedArray | string) -> bool.
JSValue js_writeCacheFile(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 2) return JS_FALSE;
    const char* key = JS_ToCString(ctx, argv[0]);
    const std::string path = pathIn(host().cacheDir, key);
    if (key) JS_FreeCString(ctx, key);
    return writeFileAt(ctx, path, argv[1]);
}

// es_readDataFile(key) -> ArrayBuffer | null. Durable half: what a player keeps.
JSValue js_readDataFile(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
    const char* key = JS_ToCString(ctx, argv[0]);
    const std::string path = pathIn(host().dataDir, key);
    if (key) JS_FreeCString(ctx, key);
    return readFileAt(ctx, path);
}

// es_writeDataFile(key, ArrayBuffer | TypedArray | string) -> bool.
JSValue js_writeDataFile(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
    if (argc < 2) return JS_FALSE;
    const char* key = JS_ToCString(ctx, argv[0]);
    const std::string path = pathIn(host().dataDir, key);
    if (key) JS_FreeCString(ctx, key);
    return writeFileAt(ctx, path, argv[1]);
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
    bindGlobal(h, global, "es_readDataFile", js_readDataFile, 1);
    bindGlobal(h, global, "es_writeDataFile", js_writeDataFile, 2);
    bindGlobal(h, global, "es_utf8Decode", js_utf8Decode, 1);
}

}  // namespace eshost
