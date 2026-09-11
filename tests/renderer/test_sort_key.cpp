// The sort key's field layout, asserted on the bits rather than through a frame: two
// draws in the right order prove nothing about WHICH field decided it, and that is what
// the next change has to keep. Header-only, so no engine link.

#include "esengine/renderer/draw/DrawCommand.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

/// The key a plain blended sprite gets, with every field the caller can vary.
static u64 blended(i32 layer, i32 order, f32 depth, u32 shader = 0, u32 material = 0) {
    return DrawCommand::buildSortKey(RenderStage::Transparent, layer, shader,
                                     BlendMode::Normal, 0, depth, material, order);
}

static u64 opaque(i32 layer, i32 order, f32 depth, u32 shader = 0, u32 material = 0) {
    return DrawCommand::buildSortKey(RenderStage::Opaque, layer, shader,
                                     BlendMode::None, 0, depth, material, order);
}

static u64 ysorted(i32 layer, i32 order, f32 worldY, u32 shader = 0) {
    return DrawCommand::buildSortKeyYSorted(RenderStage::Transparent, layer, worldY,
                                            shader, BlendMode::Normal, 0, order);
}

/// The 8 bits a group spends on its members, read back out of a finished key.
static u64 memberField(u64 key) { return (key >> 30) & 0xFF; }

int main() {
    // ---- What a group takes over -------------------------------------------------
    // The promise is that nothing outside lands BETWEEN the members — a claim about the
    // key's top fields, so it is checked there.
    {
        const u64 lowMember = DrawCommand::withGroupOrder(blended(5, 2, 0.0f), -100);
        const u64 highMember = DrawCommand::withGroupOrder(blended(5, 2, 0.0f), 100);
        const u64 outsiderAbove = blended(5, 3, 0.0f);
        const u64 outsiderBelow = blended(5, 1, 0.0f);
        CHECK(lowMember < highMember, "a member's own order still separates it inside the group");
        CHECK(outsiderBelow < lowMember && highMember < outsiderAbove,
              "an outsider cannot land between two members of one group");
    }

    // The member field must be the SAME field in every packing, or two members of one
    // group could not be compared at all — the group's own stage is not uniform across
    // its contents (an opaque prop under a blended character).
    {
        const u64 b = DrawCommand::withGroupOrder(blended(5, 0, 1.0f, 0xFF, 0x1F), 7);
        const u64 o = DrawCommand::withGroupOrder(opaque(5, 0, 1.0f, 0xFF, 0x7FF), 7);
        const u64 y = DrawCommand::withGroupOrder(ysorted(5, 0, 42.0f, 0xFF), 7);
        CHECK(memberField(b) == memberField(o) && memberField(o) == memberField(y),
              "the member field is the same 8 bits in all three packings");
        CHECK(memberField(b) == 7u + 128u, "a member order is stored biased, like the group's");
    }

    // Stamping is not appending: it must LAND on those bits whatever they held, or a
    // deep sprite would out-sort a shallow sibling stated to be above it.
    {
        const u64 near = DrawCommand::withGroupOrder(blended(5, 0, 1000.0f), 0);
        const u64 far = DrawCommand::withGroupOrder(blended(5, 0, -1000.0f), 1);
        CHECK(near < far, "a stated member order outranks the depth it overwrote");
    }
    {
        const u64 backY = DrawCommand::withGroupOrder(ysorted(5, 0, 500.0f), 1);
        const u64 frontY = DrawCommand::withGroupOrder(ysorted(5, 0, -500.0f), 0);
        CHECK(frontY < backY, "a stated member order outranks world Y inside a group");
    }

    // Negative and out-of-range members, on the same terms as the group's own order:
    // clamped, never wrapped, because a wrap turns "far on top" into "behind".
    {
        const u64 under = DrawCommand::withGroupOrder(blended(5, 0, 0.0f), -1);
        const u64 unstated = DrawCommand::withGroupOrder(blended(5, 0, 0.0f), 0);
        const u64 over = DrawCommand::withGroupOrder(blended(5, 0, 0.0f), 5000);
        const u64 pinned = DrawCommand::withGroupOrder(blended(5, 0, 0.0f), 127);
        CHECK(under < unstated, "a negative member sinks below an unstated one");
        CHECK(over == pinned, "a member order past the range pins to the end it ran past");
    }

    // A group cannot leak: whatever a member states, it stays inside the group's layer.
    {
        const u64 loudMember = DrawCommand::withGroupOrder(blended(5, 0, 0.0f), 127);
        const u64 quietAbove = blended(6, -128, 0.0f);
        CHECK(loudMember < quietAbove, "the loudest member never escapes its group's layer");
    }

    // ---- What the stamp leaves alone ---------------------------------------------
    // Only [37:30] moves. A group that also disturbed the layer, the order or the stage
    // would reorder the frame in ways nothing here would catch.
    {
        const u64 plain = blended(5, 2, 1.0f, 0xFF, 0x1F);
        const u64 stamped = DrawCommand::withGroupOrder(plain, 3);
        constexpr u64 memberBits = 0xFFull << 30;
        CHECK((plain & ~memberBits) == (stamped & ~memberBits),
              "stamping a member order touches no other field");
    }

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
