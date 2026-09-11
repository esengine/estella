// Which SpriteMask cuts a sprite. A frame can show that SOME mask won; only this can
// show which one the rule chose, and the rule is what the next change has to keep.
// Header-only, so no engine link.

#include "esengine/renderer/draw/SpriteMaskRange.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

static DrawList::SortIdentity at(i32 layer, i32 order) { return {layer, order}; }

/// An unlimited mask sitting at (layer, order), with the ref it would stamp.
static ResolvedMask mask(i32 layer, i32 order, i32 ref) {
    return {at(layer, order), {}, false, ref};
}
static ResolvedMask limited(i32 layer, i32 order, i32 endLayer, i32 endOrder, i32 ref) {
    return {at(layer, order), at(endLayer, endOrder), true, ref};
}

static const ResolvedMask* nearest(const std::vector<ResolvedMask>& v,
                                   const DrawList::SortIdentity& where) {
    return nearestReachingMask(v.data(), static_cast<u32>(v.size()), where);
}

int main() {
    // ---- Forward reach ------------------------------------------------------------
    // A mask cuts what is drawn AFTER it, because that is when its stencil exists.
    {
        const ResolvedMask m = mask(2, 0, 1);
        CHECK(maskReaches(m, at(2, 1)), "a mask reaches a sprite later in its layer");
        CHECK(maskReaches(m, at(3, -128)), "a mask reaches into a later layer");
        CHECK(!maskReaches(m, at(2, -1)), "a mask does not reach a sprite drawn before it");
        CHECK(!maskReaches(m, at(1, 127)), "nor one in an earlier layer");
    }

    // Equal is NOT covered: two draws at one place have no order between them, so the
    // stencil may be written after the draw that was supposed to test it.
    {
        const ResolvedMask m = mask(2, 5, 1);
        CHECK(!maskReaches(m, at(2, 5)), "a mask does not reach a sprite at its own place");
    }

    // ---- A stated reach ------------------------------------------------------------
    // Inclusive at the end: the field says "last order this reaches".
    {
        const ResolvedMask m = limited(2, 0, /*end=*/2, 5, 1);
        CHECK(maskReaches(m, at(2, 5)), "a limited mask reaches its stated end");
        CHECK(!maskReaches(m, at(2, 6)), "and stops one past it");
        CHECK(!maskReaches(m, at(3, -128)), "a limited mask does not spill into a later layer");
    }

    // ---- Which mask the stencil actually holds --------------------------------------
    // The nearest one, because it wrote last. Testing the earlier mask's ref would fail
    // exactly where the later mask covered it — the sprite would vanish inside the mask.
    {
        const std::vector<ResolvedMask> v{mask(1, 0, 1), mask(2, 0, 2)};
        const ResolvedMask* n = nearest(v, at(3, 0));
        CHECK(n && n->ref == 2, "the nearest reaching mask decides");
    }
    // Order in the list is not the answer — the same pair, listed the other way.
    {
        const std::vector<ResolvedMask> v{mask(2, 0, 2), mask(1, 0, 1)};
        const ResolvedMask* n = nearest(v, at(3, 0));
        CHECK(n && n->ref == 2, "and it is nearest by PLACE, not by position in the list");
    }
    // A nearer mask that does not reach this far leaves the farther one in charge.
    {
        const std::vector<ResolvedMask> v{mask(1, 0, 1), limited(2, 0, 2, 3, 2)};
        const ResolvedMask* n = nearest(v, at(5, 0));
        CHECK(n && n->ref == 1, "a nearer mask whose reach ended does not take over");
    }
    {
        const std::vector<ResolvedMask> v{};
        CHECK(nearest(v, at(1, 0)) == nullptr, "no masks, no cut");
    }
    {
        const std::vector<ResolvedMask> v{mask(5, 0, 1)};
        CHECK(nearest(v, at(1, 0)) == nullptr, "a mask drawn later cuts nothing before it");
    }

    // A mask that never got a ref (past the stencil's 255) must not be chosen — it cuts
    // nothing, and picking it would test ref 0, which is every unmasked pixel.
    {
        const std::vector<ResolvedMask> v{mask(1, 0, 1), mask(2, 0, 0)};
        const ResolvedMask* n = nearest(v, at(3, 0));
        CHECK(n && n->ref == 1, "a mask with no ref is skipped, not chosen with ref 0");
    }

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
