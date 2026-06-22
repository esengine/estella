/**
 * @file    text/SdfGenerator.cpp
 * @brief   8SSEDT (8-point signed sequential euclidean distance transform).
 *
 * Two distance fields are propagated — one toward the nearest "inside" texel,
 * one toward the nearest "outside" texel — and subtracted to get a signed
 * distance that is positive inside the glyph, negative outside, ~0 at the edge.
 * The classic two-pass sequential sweep is approximate but fast and allocation-
 * light, which matters because glyphs are generated on-demand at runtime.
 */
#include "SdfGenerator.hpp"

#include <vector>
#include <cmath>
#include <algorithm>

namespace esengine::text {
namespace {

// Offset from a texel to its nearest opposite-class texel, in texels.
struct Point {
    i32 dx;
    i32 dy;
};

constexpr Point kInside{0, 0};
constexpr Point kEmpty{9999, 9999};  // distSq ~2e8, well within i32

inline i32 distSq(const Point& p) { return p.dx * p.dx + p.dy * p.dy; }

struct Grid {
    std::vector<Point> cells;
    i32 w;
    i32 h;

    usize index(i32 x, i32 y) const {
        return static_cast<usize>(y) * static_cast<usize>(w) + static_cast<usize>(x);
    }
    Point get(i32 x, i32 y) const {
        if (x < 0 || y < 0 || x >= w || y >= h) return kEmpty;
        return cells[index(x, y)];
    }
    void put(i32 x, i32 y, const Point& p) { cells[index(x, y)] = p; }
};

inline void compare(const Grid& g, Point& p, i32 x, i32 y, i32 ox, i32 oy) {
    Point other = g.get(x + ox, y + oy);
    other.dx += ox;
    other.dy += oy;
    if (distSq(other) < distSq(p)) p = other;
}

// Two-pass sequential sweep: each pass updates every texel from the four
// already-visited neighbours, so two passes cover all eight directions.
void propagate(Grid& g) {
    for (i32 y = 0; y < g.h; ++y) {
        for (i32 x = 0; x < g.w; ++x) {
            Point p = g.get(x, y);
            compare(g, p, x, y, -1, 0);
            compare(g, p, x, y, 0, -1);
            compare(g, p, x, y, -1, -1);
            compare(g, p, x, y, 1, -1);
            g.put(x, y, p);
        }
        for (i32 x = g.w - 1; x >= 0; --x) {
            Point p = g.get(x, y);
            compare(g, p, x, y, 1, 0);
            g.put(x, y, p);
        }
    }
    for (i32 y = g.h - 1; y >= 0; --y) {
        for (i32 x = g.w - 1; x >= 0; --x) {
            Point p = g.get(x, y);
            compare(g, p, x, y, 1, 0);
            compare(g, p, x, y, 0, 1);
            compare(g, p, x, y, -1, 1);
            compare(g, p, x, y, 1, 1);
            g.put(x, y, p);
        }
        for (i32 x = 0; x < g.w; ++x) {
            Point p = g.get(x, y);
            compare(g, p, x, y, -1, 0);
            g.put(x, y, p);
        }
    }
}

}  // namespace

void sdfFromAlpha(const u8* alpha, u8* out, u32 width, u32 height, f32 spread) {
    if (!alpha || !out || width == 0 || height == 0) return;

    const i32 w = static_cast<i32>(width);
    const i32 h = static_cast<i32>(height);
    const i32 n = w * h;

    Grid inside{std::vector<Point>(static_cast<usize>(n)), w, h};   // toward nearest inside texel
    Grid outside{std::vector<Point>(static_cast<usize>(n)), w, h};  // toward nearest outside texel

    const usize count = static_cast<usize>(n);
    for (usize i = 0; i < count; ++i) {
        if (alpha[i] >= 128) {
            inside.cells[i] = kInside;
            outside.cells[i] = kEmpty;
        } else {
            inside.cells[i] = kEmpty;
            outside.cells[i] = kInside;
        }
    }

    propagate(inside);
    propagate(outside);

    const f32 scale = (spread > 0.0f) ? (127.0f / spread) : 127.0f;
    for (usize i = 0; i < count; ++i) {
        const f32 distToInside = std::sqrt(static_cast<f32>(distSq(inside.cells[i])));   // 0 inside, grows outward
        const f32 distToOutside = std::sqrt(static_cast<f32>(distSq(outside.cells[i]))); // 0 outside, grows inward
        const f32 signedDist = distToOutside - distToInside;  // + inside, - outside, ~0 at edge
        const i32 v = static_cast<i32>(std::lround(128.0f + signedDist * scale));
        out[i] = static_cast<u8>(std::clamp(v, 0, 255));
    }
}

}  // namespace esengine::text
