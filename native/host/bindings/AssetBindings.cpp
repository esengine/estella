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
esjs::Val js_readAsset(const esjs::Args& a) {
    esjs::Utf8 pathUtf8(a[0]); const char* path = pathUtf8 ? pathUtf8.c_str() : nullptr;
    if (!path) return esjs::null();
    std::vector<u8> bytes = readAsset(host(), path);
    if (bytes.empty()) return esjs::null();
    return esjs::arrayBufferCopy(bytes.data(), bytes.size());
}

// es_loadImagePixels(path | ArrayBuffer) -> { width, height, pixels: ArrayBuffer(RGBA) } | null.
// Decodes a packaged image asset — or bytes the script fetched or read from the
// cache, which is how a CDN image arrives — to top-first RGBA via stb_image.
esjs::Val js_loadImagePixels(const esjs::Args& a) {
    std::vector<u8> file;
    esjs::Bytes raw;
    if (esjs::bytesOf(a[0], &raw)) {
        file.assign(raw.data, raw.data + raw.size);
    } else {
        // not a byte buffer: a path
        esjs::Utf8 pathUtf8(a[0]); const char* path = pathUtf8 ? pathUtf8.c_str() : nullptr;
        if (!path) return esjs::null();
        file = readAsset(host(), path);
    }
    if (file.empty()) return esjs::null();
    int w = 0, h = 0, ch = 0;
    stbi_uc* px = stbi_load_from_memory(file.data(), (int)file.size(), &w, &h, &ch, 4);
    if (!px) { ESHOST_LOGE("stb_image decode failed"); return esjs::null(); }
    esjs::Val buf = esjs::arrayBufferCopy(px, (size_t)w * (size_t)h * 4);
    stbi_image_free(px);
    esjs::Val obj = esjs::object();
    esjs::set(obj, "width", esjs::int32(w));
    esjs::set(obj, "height", esjs::int32(h));
    esjs::set(obj, "pixels", buf);   // ArrayBuffer; the bootstrap wraps it Uint8Array
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

esjs::Val readFileAt(const std::string& path) {
    if (path.empty()) return esjs::null();
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return esjs::null();
    fseek(f, 0, SEEK_END);
    const long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    std::vector<u8> bytes(size > 0 ? (size_t)size : 0);
    if (!bytes.empty() && fread(bytes.data(), 1, bytes.size(), f) != bytes.size()) bytes.clear();
    fclose(f);
    if (bytes.empty()) return esjs::null();
    return esjs::arrayBufferCopy(bytes.data(), bytes.size());
}

// A string source is written as UTF-8, so script-side JSON needs no TextEncoder.
esjs::Val writeFileAt(const std::string& path, esjs::Val source) {
    if (path.empty()) return esjs::boolean(false);
    std::vector<u8> bytes;
    if (esjs::isString(source)) {
        const esjs::Utf8 text(source);
        bytes.assign(text.c_str(), text.c_str() + text.size());
    } else {
        readByteSource(source, bytes);
    }
    // Write a temp file and rename over the target: a crash or a kill mid-write
    // must not leave a truncated file where a save used to be. rename(2) within
    // one directory is atomic, so a reader sees the old file or the new one.
    const std::string tmp = path + ".tmp";
    FILE* f = fopen(tmp.c_str(), "wb");
    if (!f) return esjs::boolean(false);
    const bool wrote = bytes.empty() || fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
    const bool flushed = wrote && fflush(f) == 0;
    fclose(f);
    if (!flushed || rename(tmp.c_str(), path.c_str()) != 0) {
        remove(tmp.c_str());
        return esjs::boolean(false);
    }
    return esjs::boolean(true);
}

// es_readCacheFile(key) -> ArrayBuffer | null. Reclaimable half: hot-update content.
esjs::Val js_readCacheFile(const esjs::Args& a) {
    esjs::Utf8 keyUtf8(a[0]); const char* key = keyUtf8 ? keyUtf8.c_str() : nullptr;
    const std::string path = pathIn(host().cacheDir, key);
    return readFileAt(path);
}

// es_writeCacheFile(key, ArrayBuffer | TypedArray | string) -> bool.
esjs::Val js_writeCacheFile(const esjs::Args& a) {
    if (a.size() < 2) return esjs::boolean(false);
    esjs::Utf8 keyUtf8(a[0]); const char* key = keyUtf8 ? keyUtf8.c_str() : nullptr;
    const std::string path = pathIn(host().cacheDir, key);
    return writeFileAt(path, a[1]);
}

// es_readDataFile(key) -> ArrayBuffer | null. Durable half: what a player keeps.
esjs::Val js_readDataFile(const esjs::Args& a) {
    esjs::Utf8 keyUtf8(a[0]); const char* key = keyUtf8 ? keyUtf8.c_str() : nullptr;
    const std::string path = pathIn(host().dataDir, key);
    return readFileAt(path);
}

// es_writeDataFile(key, ArrayBuffer | TypedArray | string) -> bool.
esjs::Val js_writeDataFile(const esjs::Args& a) {
    if (a.size() < 2) return esjs::boolean(false);
    esjs::Utf8 keyUtf8(a[0]); const char* key = keyUtf8 ? keyUtf8.c_str() : nullptr;
    const std::string path = pathIn(host().dataDir, key);
    return writeFileAt(path, a[1]);
}

// es_utf8Decode(ArrayBuffer | TypedArray) -> string. Backs the TextDecoder the
// platform layer uses to read packaged JSON (manifests, scenes); the engine reads
// UTF-8 natively, so this beats decoding byte-by-byte in script.
esjs::Val js_utf8Decode(const esjs::Args& a) {
    esjs::Bytes bytes;
    if (!esjs::bytesOf(a[0], &bytes)) return esjs::string("");
    return esjs::string(std::string_view(reinterpret_cast<const char*>(bytes.data), bytes.size));
}

}  // namespace

std::vector<u8> readAsset(HostState& h, const char* path) {
    return h.platform ? h.platform->readAsset(path) : std::vector<u8>{};
}

void registerAssetBindings(HostState& h, esjs::Val global) {
    bindGlobal(global, "es_readAsset", js_readAsset, 1);
    bindGlobal(global, "es_loadImagePixels", js_loadImagePixels, 1);
    bindGlobal(global, "es_readCacheFile", js_readCacheFile, 1);
    bindGlobal(global, "es_writeCacheFile", js_writeCacheFile, 2);
    bindGlobal(global, "es_readDataFile", js_readDataFile, 1);
    bindGlobal(global, "es_writeDataFile", js_writeDataFile, 2);
    bindGlobal(global, "es_utf8Decode", js_utf8Decode, 1);
}

}  // namespace eshost
