// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "esengine/resource/ResourceManager.hpp"
#include "media/ktx2_decode.hpp"
#include "renderer/MockGfxDevice.hpp"

#include <cstdio>
#include <fstream>
#include <iterator>
#include <vector>

struct Preview {
    double maxEdge;
    int width;
    int height;
    unsigned levels;
    bool wholeBlocks;
};

static bool checkPreview(const std::vector<uint8_t>& bytes, Preview preview, bool blocks, bool mipmaps) {
    esengine::MockGfxDevice device;
    device.compressedSupported = blocks;
    esengine::resource::ResourceManager rm;
    rm.init(device);
    const auto result = eshost::transcodeKTX2(bytes.data(), bytes.size(), false, mipmaps, rm, device, preview.maxEdge);
    const bool compressed = blocks && preview.wholeBlocks;
    const unsigned levels = mipmaps ? preview.levels : 1u;
    const bool correctUpload = compressed
        ? device.lastCompressedMipLevels == levels && device.lastCompressedByteLength ==
          esengine::gfxCompressedPyramidBytes(device.lastCompressedFormat, preview.width, preview.height, levels)
        : device.updateTextureCalls > 0 && (device.generateMipmapsCalls > 0) == mipmaps;
    if (result.handle >= 0 && result.width == preview.width && result.height == preview.height
        && device.lastTextureDesc.width == preview.width && device.lastTextureDesc.height == preview.height
        && (result.format >= 0) == compressed && result.blockRefused == (blocks && !preview.wholeBlocks)
        && device.lastTextureDesc.mipmaps == mipmaps && correctUpload) return true;
    std::fprintf(stderr, "edge=%g blocks=%d mipmaps=%d: got %dx%d format=%d levels=%u generated=%d\n",
                 preview.maxEdge, blocks, mipmaps, result.width, result.height, result.format,
                 device.lastCompressedMipLevels, device.generateMipmapsCalls);
    return false;
}

static bool checkRecoveryOwner(const std::vector<uint8_t>& bytes, bool blocks) {
    using esengine::resource::ResourceContent;
    esengine::MockGfxDevice device;
    device.compressedSupported = blocks;
    esengine::resource::ResourceManager rm;
    rm.init(device);
    const auto image = eshost::transcodeKTX2(bytes.data(), bytes.size(), false, false, rm, device, 13);
    const auto page = eshost::transcodeKTX2(bytes.data(), bytes.size(), false, false, rm, device, 13, ResourceContent::AtlasPage);
    if (image.handle < 0 || page.handle < 0) return false;
    device.notifyDeviceLost(esengine::GfxDeviceLostReason::ContextLost, "test");
    device.recoverDevice();
    bool owesImage = false, owesPage = false;
    for (const auto& owed : rm.texturesAwaitingReupload()) {
        if (owed.handle.id() == static_cast<uint32_t>(image.handle)) owesImage = owed.content == ResourceContent::Asset;
        if (owed.handle.id() == static_cast<uint32_t>(page.handle)) owesPage = owed.content == ResourceContent::AtlasPage;
    }
    if (owesImage && owesPage) return true;
    std::fprintf(stderr, "KTX2 recovery blocks=%d: asset=%d atlas=%d\n", blocks, owesImage, owesPage);
    return false;
}

int main(int argc, char** argv) {
    if (argc != 2) return 1;
    std::ifstream file(argv[1], std::ios::binary);
    const std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
    if (bytes.empty()) return 1;

    // The Basis fixture has ten authored levels, from 768x512 down to 1x1.
    const Preview previews[] = {
        {0, 768, 512, 10, true}, {200, 192, 128, 8, true}, {13, 12, 8, 4, true},
        {10, 6, 4, 3, false}, {0.5, 1, 1, 1, false},
    };
    for (const auto& preview : previews) {
        for (bool blocks : {true, false}) {
            for (bool mipmaps : {true, false}) {
                if (!checkPreview(bytes, preview, blocks, mipmaps)) return 1;
            }
        }
    }
    return checkRecoveryOwner(bytes, true) && checkRecoveryOwner(bytes, false) ? 0 : 1;
}
