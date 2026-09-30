// PerDrawBlocks: every draw gets a range of its own, carved from a few pages
// that a pass uploads once each.

#include "MockGfxDevice.hpp"
#include "esengine/renderer/rhi/PerDrawBlocks.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

struct Bound { BufferHandle buffer; u32 offset; u32 size; };

int main() {
    MockGfxDevice device;
    PerDrawBlocks blocks;
    constexpr u32 BLOCK = 16016;
    constexpr u32 WRITTEN = 160;
    constexpr u32 DRAWS = 8000;
    blocks.init(device, BLOCK);
    const int afterInit = device.createBufferCalls;

    const std::vector<u8> bytes(BLOCK, 7);
    int uploads = 0;
    const auto frame = [&](std::vector<Bound>& out) {
        blocks.beginFrame();
        std::vector<PerDrawBlocks::Range> staged;
        for (u32 i = 0; i < DRAWS; ++i) staged.push_back(blocks.stage(bytes.data(), WRITTEN));
        const int writesBefore = device.updateBufferCalls;
        blocks.upload();
        uploads = device.updateBufferCalls - writesBefore;
        for (const auto& range : staged) {
            blocks.bind(3, range);
            out.push_back({device.lastUniformBuffer, device.lastUniformOffset, device.lastUniformSize});
        }
    };

    std::vector<Bound> first;
    frame(first);
    const int created = device.createBufferCalls - afterInit;
    std::printf("      %u draws took %d buffers\n", DRAWS, created);
    CHECK(created > 0 && created <= 32, "a frame of thousands of draws is a few pages");
    CHECK(uploads == created, "a pass uploads once per page, not once per draw");

    bool aligned = true, fits = true, disjoint = true, sized = true;
    for (usize i = 0; i < first.size(); ++i) {
        const Bound& b = first[i];
        aligned &= b.offset % GFX_UNIFORM_OFFSET_ALIGNMENT == 0;
        fits &= b.offset + BLOCK <= 128u * 1024u;
        sized &= b.size == BLOCK;
        if (i > 0 && first[i - 1].buffer == b.buffer) disjoint &= b.offset >= first[i - 1].offset + WRITTEN;
    }
    CHECK(aligned, "every range starts on the uniform offset alignment");
    CHECK(fits, "every range's whole block lies inside its page");
    CHECK(sized, "every range is bound as the block the shader declares");
    CHECK(disjoint, "no draw's bytes are overwritten by the next draw's");

    std::vector<Bound> second;
    frame(second);
    CHECK(device.createBufferCalls - afterInit == created, "a second frame reuses the pages");

    blocks.bind(3, blocks.stage(bytes.data(), BLOCK + 16));
    CHECK(device.lastUniformOffset == 0 && device.lastUniformSize == 0 &&
              device.lastUniformBuffer != second.back().buffer,
          "a write the block cannot hold binds the zero block");

    if (g_failures) std::printf("%d failure(s)\n", g_failures);
    return g_failures ? 1 : 0;
}
