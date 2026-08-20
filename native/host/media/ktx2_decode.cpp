// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ktx2_decode.cpp
 * @brief   KTX2 → GPU transcode (see ktx2_decode.hpp), backed by basis_universal.
 */
#include "ktx2_decode.hpp"

#include "basisu_transcoder.h"

#include "esengine/renderer/rhi/GfxDevice.hpp"
#include "esengine/renderer/rhi/GfxEnums.hpp"
#include "esengine/renderer/rhi/Texture.hpp"           // TextureFormat
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
    // WebGPU refuses a compressed copy whose size is not whole blocks — a 70x70
    // sprite fails CreateTexture and the game draws nothing. Device support is not
    // the only question, and the block is the FORMAT's, not always 4x4.
    for (const FormatChoice& c : kChoices) {
        const GfxCompressedFormat want = srgb ? c.srgb : c.linear;
        if (!device.supportsCompressedFormat(want)) continue;
        if (gfxWholeBlockLevels(want, w, h, 1) == 0) continue;
        basisFmt = c.basisFmt;
        gfxFmt = want;
        compressed = true;
        break;
    }

    // The output count is BLOCKS for a block format and PIXELS for an uncompressed
    // one: basis reports a 4x4 block for RGBA32 too, so one formula does not cover
    // both — 324 units of a 70x70 image is a decode that fails.
    const bool uncompressed = basist::basis_transcoder_format_is_uncompressed(basisFmt);
    const uint32_t bw = basist::basis_get_block_width(basisFmt);
    const uint32_t bh = basist::basis_get_block_height(basisFmt);
    const uint32_t bpb = basist::basis_get_bytes_per_block_or_pixel(basisFmt);
    // The rule is about each LEVEL, not the image: 72x72 is whole blocks and its
    // third mip, 18x18, is not — and that copy is refused exactly as a 70x70 base
    // would be. The chain stops there, whole as far as it goes.
    const uint32_t numLevels = compressed
        ? gfxWholeBlockLevels(gfxFmt, w, h, t.get_levels() ? t.get_levels() : 1u)
        : 1u;

    // Pack each level tightly, level 0 first — the layout the device unpacks.
    std::vector<uint8_t> out;
    uint32_t uploaded = 0;
    for (uint32_t level = 0; level < numLevels; ++level) {
        const uint32_t lw = (w >> level) ? (w >> level) : 1u;
        const uint32_t lh = (h >> level) ? (h >> level) : 1u;
        const uint32_t units = uncompressed ? (lw * lh)
                                           : ((lw + bw - 1) / bw) * ((lh + bh - 1) / bh);
        const size_t off = out.size();
        out.resize(off + static_cast<size_t>(units) * bpb);
        if (!t.transcode_image_level(level, 0, 0, out.data() + off, units, basisFmt)) {
            out.resize(off);   // drop the partial level and stop
            break;
        }
        ++uploaded;
    }
    if (uploaded == 0) return fail;

    const ConstSpan<u8> span(out.data(), out.size());
    const resource::TextureHandle handle = compressed
        ? rm.createCompressedTexture(w, h, gfxFmt, span, uploaded)
        : rm.createTexture(w, h, span, srgb ? TextureFormat::SRGB8A8 : TextureFormat::RGBA8, false);
    if (!handle.isValid()) return fail;
    return KTX2Result{static_cast<int>(handle.id()), static_cast<int>(w), static_cast<int>(h)};
}

}  // namespace eshost
