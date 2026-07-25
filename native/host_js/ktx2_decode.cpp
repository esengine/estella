// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ktx2_decode.cpp
 * @brief   KTX2 → GPU transcode (see ktx2_decode.hpp), backed by basis_universal.
 */
#include "ktx2_decode.hpp"

#include "basisu_transcoder.h"

#include "esengine/renderer/GfxDevice.hpp"
#include "esengine/renderer/GfxEnums.hpp"
#include "esengine/renderer/Texture.hpp"           // TextureFormat
#include "esengine/resource/ResourceManager.hpp"

#include <mutex>
#include <vector>

using namespace esengine;

namespace {

void ensureBasis() {
    static std::once_flag once;
    std::call_once(once, [] { basist::basisu_transcoder_init(); });
}

// The device format to prefer, its basis transcode target, and its sRGB variant.
// Ordered best-first for mobile GPUs (ASTC), then the ETC2 core baseline, then BC
// (desktop / some simulators); RGBA32 is the always-works fallback.
struct FormatChoice {
    GfxCompressedFormat linear;
    GfxCompressedFormat srgb;
    basist::transcoder_texture_format basisFmt;
};
const FormatChoice kChoices[] = {
    {GfxCompressedFormat::ASTC_4x4, GfxCompressedFormat::ASTC_4x4_SRGB,
     basist::transcoder_texture_format::cTFASTC_4x4_RGBA},
    {GfxCompressedFormat::ETC2_RGBA8, GfxCompressedFormat::ETC2_RGBA8_SRGB,
     basist::transcoder_texture_format::cTFETC2_RGBA},
    {GfxCompressedFormat::S3TC_DXT5, GfxCompressedFormat::S3TC_DXT5_SRGB,
     basist::transcoder_texture_format::cTFBC3_RGBA},
};

}  // namespace

namespace eshost {

KTX2Result transcodeKTX2(const uint8_t* bytes, size_t n, bool srgb,
                         resource::ResourceManager& rm, GfxDevice& device) {
    const KTX2Result fail{-1, 0, 0};
    ensureBasis();

    basist::ktx2_transcoder t;
    if (!t.init(bytes, static_cast<uint32_t>(n)) || !t.start_transcoding()) return fail;
    const uint32_t w = t.get_width();
    const uint32_t h = t.get_height();
    if (w == 0 || h == 0) return fail;

    basist::transcoder_texture_format basisFmt = basist::transcoder_texture_format::cTFRGBA32;
    GfxCompressedFormat gfxFmt = GfxCompressedFormat::ETC2_RGBA8;
    bool compressed = false;
    for (const FormatChoice& c : kChoices) {
        const GfxCompressedFormat want = srgb ? c.srgb : c.linear;
        if (device.supportsCompressedFormat(want)) {
            basisFmt = c.basisFmt;
            gfxFmt = want;
            compressed = true;
            break;
        }
    }

    // output_blocks_buf_size counts blocks (block formats) or pixels (RGBA32);
    // block_width/height is 1 for RGBA32, so this expression covers both.
    const uint32_t bw = basist::basis_get_block_width(basisFmt);
    const uint32_t bh = basist::basis_get_block_height(basisFmt);
    const uint32_t units = ((w + bw - 1) / bw) * ((h + bh - 1) / bh);
    std::vector<uint8_t> out(static_cast<size_t>(units) * basist::basis_get_bytes_per_block_or_pixel(basisFmt));
    if (!t.transcode_image_level(0, 0, 0, out.data(), units, basisFmt)) return fail;

    const ConstSpan<u8> span(out.data(), out.size());
    const resource::TextureHandle handle = compressed
        ? rm.createCompressedTexture(w, h, gfxFmt, span)
        : rm.createTexture(w, h, span, srgb ? TextureFormat::SRGB8A8 : TextureFormat::RGBA8, false);
    if (!handle.isValid()) return fail;
    return KTX2Result{static_cast<int>(handle.id()), static_cast<int>(w), static_cast<int>(h)};
}

}  // namespace eshost
