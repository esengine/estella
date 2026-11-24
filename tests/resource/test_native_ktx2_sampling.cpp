// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "esengine/resource/ResourceManager.hpp"
#include "media/ktx2_decode.hpp"
#include "renderer/MockGfxDevice.hpp"

#include <cstdio>
#include <fstream>
#include <iterator>
#include <vector>

int main(int argc, char** argv) {
    if (argc != 2) return 1;
    std::ifstream file(argv[1], std::ios::binary);
    const std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
    if (bytes.empty()) return 1;

    // The Basis fixture has ten authored levels, from 768x512 down to 1x1.
    for (bool blocks : {true, false}) {
        for (bool mipmaps : {true, false}) {
            esengine::MockGfxDevice device;
            device.compressedSupported = blocks;
            esengine::resource::ResourceManager rm;
            rm.init(device);
            const auto result = eshost::transcodeKTX2(bytes.data(), bytes.size(), false, mipmaps, rm, device);
            const bool correctLevels = blocks ? device.lastCompressedMipLevels == (mipmaps ? 10u : 1u)
                                              : (device.generateMipmapsCalls > 0) == mipmaps;
            if (result.handle < 0 || result.width != 768 || result.height != 512 || (result.format >= 0) != blocks
                || device.lastTextureDesc.mipmaps != mipmaps || !correctLevels) {
                std::fprintf(stderr, "KTX2 blocks=%d mipmaps=%d: format=%d levels=%u generated=%d\n",
                             blocks, mipmaps, result.format, device.lastCompressedMipLevels, device.generateMipmapsCalls);
                return 1;
            }
        }
    }
    return 0;
}
