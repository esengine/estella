// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BasisModuleEntry.cpp
 * @brief   Emscripten module: Basis Universal KTX2 transcoder
 * @details A standalone wasm module (built like spine/physics) exposing a small C
 *          API over basist::ktx2_transcoder. The SDK loads it on demand and uses it
 *          to turn a KTX2/Basis container into GPU-ready compressed (or RGBA8) bytes
 *          for upload. Stateless from the caller's view: open → query → transcode →
 *          close, one image at a time.
 *
 *          The integer `target` codes form a stable contract with the TS side
 *          (sdk/src/asset/compressed.ts / BasisTranscoder impl):
 *            0 = ETC2_RGBA8, 1 = ASTC_4x4, 2 = S3TC_DXT5 (BC3), 3 = RGBA8 (fallback).
 */

#include "basisu_transcoder.h"

#include <cstdint>

namespace {

basist::ktx2_transcoder g_transcoder;
bool g_open = false;

basist::transcoder_texture_format mapFormat(int target) {
    switch (target) {
        case 0:  return basist::transcoder_texture_format::cTFETC2_RGBA;     // ETC2_RGBA8
        case 1:  return basist::transcoder_texture_format::cTFASTC_4x4_RGBA; // ASTC 4x4
        case 2:  return basist::transcoder_texture_format::cTFBC3_RGBA;      // S3TC/DXT5
        default: return basist::transcoder_texture_format::cTFRGBA32;        // uncompressed fallback
    }
}

bool isUncompressed(int target) { return target == 3; }

// Blocks (compressed) or pixels (uncompressed) in one level.
uint32_t levelUnits(const basist::ktx2_image_level_info& info, int target) {
    return isUncompressed(target) ? (info.m_orig_width * info.m_orig_height)
                                  : (info.m_num_blocks_x * info.m_num_blocks_y);
}

}  // namespace

extern "C" {

void es_basis_close();  // forward declaration (es_basis_open calls it)

/** Initialize the transcoder lookup tables. Call once after module load. */
void es_basis_init() {
    basist::basisu_transcoder_init();
}

/**
 * Open a KTX2 container. `pData` must stay valid (allocated in this module's heap)
 * until es_basis_close(). Returns 1 on success.
 */
int es_basis_open(const uint8_t* pData, uint32_t dataSize) {
    es_basis_close();
    if (!g_transcoder.init(pData, dataSize)) return 0;
    if (!g_transcoder.start_transcoding()) return 0;
    g_open = true;
    return 1;
}

uint32_t es_basis_get_width() { return g_open ? g_transcoder.get_width() : 0u; }
uint32_t es_basis_get_height() { return g_open ? g_transcoder.get_height() : 0u; }

/** Mip levels the open container carries (1 for a texture without a chain). */
uint32_t es_basis_level_count() { return g_open ? g_transcoder.get_levels() : 0u; }

uint32_t es_basis_level_width(uint32_t level) {
    basist::ktx2_image_level_info info;
    return g_open && g_transcoder.get_image_level_info(info, level, 0, 0) ? info.m_orig_width : 0u;
}

uint32_t es_basis_level_height(uint32_t level) {
    basist::ktx2_image_level_info info;
    return g_open && g_transcoder.get_image_level_info(info, level, 0, 0) ? info.m_orig_height : 0u;
}

/** Bytes required to transcode `level` to `target`, or 0 on error. */
uint32_t es_basis_level_size(int target, uint32_t level) {
    if (!g_open) return 0u;
    basist::ktx2_image_level_info info;
    if (!g_transcoder.get_image_level_info(info, level, 0, 0)) return 0u;
    return levelUnits(info, target) * basist::basis_get_bytes_per_block_or_pixel(mapFormat(target));
}

/** Transcode `level` into `pOut` (>= es_basis_level_size). Returns 1 on success. */
int es_basis_transcode_level(int target, uint32_t level, uint8_t* pOut, uint32_t outSize) {
    if (!g_open || !pOut) return 0;
    basist::ktx2_image_level_info info;
    if (!g_transcoder.get_image_level_info(info, level, 0, 0)) return 0;
    const basist::transcoder_texture_format fmt = mapFormat(target);
    const uint32_t units = levelUnits(info, target);
    if (outSize < units * basist::basis_get_bytes_per_block_or_pixel(fmt)) return 0;
    return g_transcoder.transcode_image_level(level, 0, 0, pOut, units, fmt) ? 1 : 0;
}

uint32_t es_basis_transcoded_size(int target) { return es_basis_level_size(target, 0); }

int es_basis_transcode(int target, uint8_t* pOut, uint32_t outSize) {
    return es_basis_transcode_level(target, 0, pOut, outSize);
}

/** Release the open container. Safe to call when none is open. */
void es_basis_close() {
    g_open = false;
}

}  // extern "C"
