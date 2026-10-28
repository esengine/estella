// Which channel of the 2D shadow mask each casting light draws into: lights that cannot meet share one.
// The contract: two lights share a channel only when neither's read reach touches the other's written shadow,
// a directional light shares with nothing, the first lights given get channels first, and a fifth overlapping light gets none.

#include "esengine/renderer/store/ShadowChannels2D.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

namespace {

ShadowMaskLight lamp(f32 x, f32 y, f32 reach = 100.0f, f32 write = 230.0f) {
    ShadowMaskLight l;
    l.pos = {x, y};
    l.read = reach;
    l.write = write;
    return l;
}

ShadowMaskLight sun() {
    ShadowMaskLight l;
    l.everywhere = true;
    return l;
}

std::vector<i32> assign(const std::vector<ShadowMaskLight>& lights, u32* dropped = nullptr) {
    std::vector<i32> out(lights.size(), 0);
    const u32 d = assignShadowChannels(lights.data(), static_cast<u32>(lights.size()), 4, out.data());
    if (dropped) *dropped = d;
    return out;
}

}  // namespace

int main() {
    // --- lights that meet each take their own channel
    {
        const auto c = assign({lamp(0, 0), lamp(50, 0), lamp(0, 50), lamp(50, 50)});
        CHECK(c[0] == 0 && c[1] == 1 && c[2] == 2 && c[3] == 3, "four lamps in one place take the four channels, in the order they were given");
    }

    // --- lights that cannot meet share the first one
    {
        const auto c = assign({lamp(0, 0), lamp(5000, 0), lamp(-5000, 0), lamp(0, 5000)});
        CHECK(c[0] == 0 && c[1] == 0 && c[2] == 0 && c[3] == 0, "four lamps far apart all share channel 0");
    }

    // --- more than four, as long as no more than four meet anywhere
    {
        std::vector<ShadowMaskLight> camp;
        for (int i = 0; i < 12; ++i) camp.push_back(lamp(i * 1000.0f, 0));
        u32 dropped = 9;
        const auto c = assign(camp, &dropped);
        bool all = true;
        for (i32 v : c) if (v < 0) all = false;
        CHECK(all && dropped == 0, "twelve torches in a row, a thousand apart, all cast: the cap was on lights that meet, not on lights");
    }

    // --- the test is the read against the write: one lamp's reach touching the other's shadow, either way round
    {
        // Each reads 100 out and can write 150 out, so two collide while they are less than 100 + 150 apart.
        const auto apart = assign({lamp(0, 0, 100, 150), lamp(260, 0, 100, 150)});
        CHECK(apart[0] == 0 && apart[1] == 0, "260 apart, past 100 + 150: they cannot meet and share a channel");
        const auto close = assign({lamp(0, 0, 100, 150), lamp(240, 0, 100, 150)});
        CHECK(close[0] == 0 && close[1] == 1, "240 apart, inside it: one reads where the other writes, so they take a channel each");
        const auto meet = assign({lamp(0, 0, 100, 150), lamp(260, 0, 100, 150), lamp(130, 0, 100, 150)});
        CHECK(meet[2] == 1, "a lamp between two that share one meets both and takes the next");
        // A long shadow and a short reach: the reading light is the one that is near, the writing light's shadow is what reaches it.
        const auto lopsided = assign({lamp(0, 0, 10, 500), lamp(400, 0, 10, 20)});
        CHECK(lopsided[1] == 1, "a lamp whose reach is tiny still collides with one whose shadow lands on it");
    }

    // --- a directional light shares with nothing, wherever the others are
    {
        const auto c = assign({sun(), lamp(0, 0), lamp(9000, 0)});
        CHECK(c[0] == 0 && c[1] != 0 && c[2] != 0, "the sun holds channel 0 alone and every lamp goes round it");
        CHECK(c[1] == 1 && c[2] == 1, "and the two far lamps share the next");
    }

    // --- a fifth that meets four has none
    {
        u32 dropped = 0;
        const auto c = assign({lamp(0, 0), lamp(10, 0), lamp(0, 10), lamp(10, 10), lamp(5, 5)}, &dropped);
        CHECK(c[4] == -1 && dropped == 1, "a fifth lamp that meets four gets no channel and is counted");
        CHECK(c[0] == 0 && c[3] == 3, "and the first four keep theirs: what is dropped is the last given, the dimmest");
    }

    // --- nothing at all
    {
        u32 dropped = 7;
        const auto c = assign({}, &dropped);
        CHECK(c.empty() && dropped == 0, "no lights is no channels and nothing dropped");
    }

    std::printf("%s\n", g_failures == 0 ? "all passed" : "FAILED");
    return g_failures == 0 ? 0 : 1;
}
