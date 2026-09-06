// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ktx2_decode.hpp
 * @brief   Transcode a KTX2/Basis texture to a device-supported GPU format and
 *          upload it, native-side.
 * @details The web KTX2 path is WebGL2 + the Basis wasm module, both absent on
 *          native. Here the vendored basis_universal C++ transcoder (like stb /
 *          miniaudio) turns a KTX2 container into ETC2/ASTC/BC blocks — or RGBA32
 *          when the device supports none — and the engine ResourceManager uploads
 *          them. This TU owns the basis include; host_core only calls transcodeKTX2.
 */
#pragma once

#include <cstddef>
#include <cstdint>

namespace esengine {
class GfxDevice;
namespace resource { class ResourceManager; }
}  // namespace esengine

namespace eshost {

struct KTX2Result {
    int handle;   ///< ResourceManager texture id, or < 0 on failure.
    int width;
    int height;
    /// GfxCompressedFormat ordinal uploaded, or < 0 when it decoded to RGBA32.
    /// The fallback is otherwise indistinguishable from success: the texture
    /// draws correctly at four times the memory somebody paid cook time to avoid.
    int format;
    /// A device format WAS available and this image is not whole blocks of it.
    /// Kept apart from "the device offered none" because only this one is fixed
    /// by the asset — the other is fixed by the build target, or not at all.
    bool blockRefused;
};

/** Transcode + upload a KTX2 clip (mip level 0). @p srgb selects the sRGB GPU
 *  format variant (the block data is identical). Picks the best format the
 *  @p device supports, falling back to RGBA32 so it always succeeds if the file
 *  is valid — and says in the result which of those happened. */
KTX2Result transcodeKTX2(const uint8_t* bytes, size_t n, bool srgb,
                         esengine::resource::ResourceManager& rm, esengine::GfxDevice& device);

}  // namespace eshost
