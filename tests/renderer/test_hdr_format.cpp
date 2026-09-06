// What a linear project asked its intermediates to be, and what the device let
// them be. Three cases, not two: a gamma project getting RGBA8 is not a
// fallback, and calling it one warns every project that never wanted HDR.

#include "esengine/renderer/store/HdrFormat.hpp"

#include <cstdio>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    // No linear pipeline: nothing asked for HDR, so nothing gave way.
    const HdrFormatDecision gamma = decideHdrFormat(/*linear=*/false, /*float=*/false);
    CHECK(gamma.requested == GfxPixelFormat::RGBA8, "a gamma project asks for RGBA8");
    CHECK(gamma.effective == GfxPixelFormat::RGBA8, "and gets it");
    CHECK(gamma.refusal == HdrRefusal::None,
          "and is NOT a fallback — a device that cannot do what nobody asked for refused nothing");
    CHECK(!gamma.linear, "and did not ask for a linear pipeline");

    // The same device, with the capability it lacks now irrelevant.
    const HdrFormatDecision gammaOnCapable = decideHdrFormat(false, true);
    CHECK(gammaOnCapable.effective == GfxPixelFormat::RGBA8 &&
          gammaOnCapable.refusal == HdrRefusal::None,
          "a capable device does not push HDR onto a project that asked for none");

    // Asked and granted.
    const HdrFormatDecision hdr = decideHdrFormat(true, true);
    CHECK(hdr.requested == GfxPixelFormat::RGBA16F, "a linear project asks for half-float");
    CHECK(hdr.effective == GfxPixelFormat::RGBA16F, "and a capable device gives it");
    CHECK(hdr.refusal == HdrRefusal::None, "with nothing to explain");
    CHECK(hdr.linear, "and it did ask for a linear pipeline");

    // Asked and not granted — the case that ran silently.
    const HdrFormatDecision fell = decideHdrFormat(true, false);
    CHECK(fell.requested == GfxPixelFormat::RGBA16F, "the ask is the same");
    CHECK(fell.effective == GfxPixelFormat::SRGB8_ALPHA8,
          "and sRGB-encoded 8-bit keeps the linear pipeline correct at LDR precision");
    CHECK(fell.refusal == HdrRefusal::FloatTargetsUnsupported,
          "and the reason is the device's, named");
    CHECK(fell.requested != fell.effective,
          "asked and got differ, which is the whole fact a reader needs");
    CHECK(fell.linear, "and the project did ask");

    // The one thing a reader must never have to infer: whether an equal pair is
    // a granted ask or no ask at all. `requested` alone cannot say it; `linear`
    // is what separates them.
    CHECK(gamma.requested == gamma.effective && hdr.requested == hdr.effective,
          "both non-fallback cases have requested == effective");
    CHECK(gamma.linear != hdr.linear,
          "and only `linear` tells a granted ask from no ask at all");

    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall HDR format claims hold\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
