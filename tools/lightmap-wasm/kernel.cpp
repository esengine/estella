// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    kernel.cpp
 * @brief   The lightmap solve's ray casting, in C++ on every core: an SAH-built
 *          BVH and the two per-lumel passes, direct and gather — plus the texture
 *          averages a bounce's albedo is taken from.
 *
 * The rules are sdk/src/lightmap/solve.ts's, term for term — the sample set,
 * the cutout hash, the back-face reach, the sky — computed in double precision
 * as that code is, so the two agree to rounding. Each lumel writes only its own
 * results, so the answer does not depend on how the threads divide the work.
 */

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <thread>
#include <vector>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#include "stb_image.h"

namespace {

constexpr double kShadowEpsilon = 1e-3;
constexpr int kLeafTris = 4;
constexpr int kBins = 16;

struct Node {
    float lo[3];
    float hi[3];
    int first;  // a leaf's first triangle in `order`, or an inner node's left child
    int count;  // -1 for an inner node, whose right child follows its left
};

struct Scene {
    const float* pos = nullptr;
    int triCount = 0;
    const float* triUV = nullptr;
    const int* triSurface = nullptr;
    const float* patch = nullptr;
    const float* albedo = nullptr;
    const float* triNormal = nullptr;
    const uint8_t* twoSided = nullptr;
    const float* coverage = nullptr;
    bool cutouts = false;
    double backReach = 0;
    std::vector<Node> nodes;
    std::vector<int> order;
};

Scene g_scene;

struct Hit {
    double t = 0, u = 0, v = 0;
};

void boundsOf(const Scene& s, const int* tris, int n, float* lo, float* hi) {
    for (int k = 0; k < 3; ++k) { lo[k] = INFINITY; hi[k] = -INFINITY; }
    for (int i = 0; i < n; ++i) {
        const float* p = s.pos + static_cast<size_t>(tris[i]) * 9;
        for (int c = 0; c < 3; ++c) {
            for (int k = 0; k < 3; ++k) {
                lo[k] = std::min(lo[k], p[c * 3 + k]);
                hi[k] = std::max(hi[k], p[c * 3 + k]);
            }
        }
    }
}

double area(const float* lo, const float* hi) {
    const double x = hi[0] - lo[0], y = hi[1] - lo[1], z = hi[2] - lo[2];
    if (!(x >= 0 && y >= 0 && z >= 0)) return 0;
    return x * y + y * z + z * x;
}

/** Binned SAH: the split that makes a ray's expected cost smallest, tried per axis. */
void build(Scene& s, const std::vector<float>& centroid, int node, int from, int to) {
    Node& self = s.nodes[node];
    boundsOf(s, s.order.data() + from, to - from, self.lo, self.hi);
    const int n = to - from;
    if (n <= kLeafTris) { self.first = from; self.count = n; return; }

    float clo[3] = {INFINITY, INFINITY, INFINITY}, chi[3] = {-INFINITY, -INFINITY, -INFINITY};
    for (int i = from; i < to; ++i) {
        for (int k = 0; k < 3; ++k) {
            const float c = centroid[static_cast<size_t>(s.order[i]) * 3 + k];
            clo[k] = std::min(clo[k], c); chi[k] = std::max(chi[k], c);
        }
    }
    int bestAxis = -1, bestBin = 0;
    double bestCost = INFINITY;
    for (int axis = 0; axis < 3; ++axis) {
        const double extent = chi[axis] - clo[axis];
        if (!(extent > 0)) continue;
        int count[kBins] = {};
        float lo[kBins][3], hi[kBins][3];
        for (int b = 0; b < kBins; ++b) for (int k = 0; k < 3; ++k) { lo[b][k] = INFINITY; hi[b][k] = -INFINITY; }
        for (int i = from; i < to; ++i) {
            const int tri = s.order[i];
            int b = static_cast<int>((centroid[static_cast<size_t>(tri) * 3 + axis] - clo[axis]) / extent * kBins);
            b = std::min(kBins - 1, std::max(0, b));
            ++count[b];
            const float* p = s.pos + static_cast<size_t>(tri) * 9;
            for (int c = 0; c < 3; ++c) for (int k = 0; k < 3; ++k) {
                lo[b][k] = std::min(lo[b][k], p[c * 3 + k]); hi[b][k] = std::max(hi[b][k], p[c * 3 + k]);
            }
        }
        // Sweep from the right, then from the left, pricing each boundary.
        double rightArea[kBins]; int rightCount[kBins];
        float rlo[3] = {INFINITY, INFINITY, INFINITY}, rhi[3] = {-INFINITY, -INFINITY, -INFINITY};
        int rc = 0;
        for (int b = kBins - 1; b > 0; --b) {
            rc += count[b];
            for (int k = 0; k < 3; ++k) { rlo[k] = std::min(rlo[k], lo[b][k]); rhi[k] = std::max(rhi[k], hi[b][k]); }
            rightArea[b] = area(rlo, rhi); rightCount[b] = rc;
        }
        float llo[3] = {INFINITY, INFINITY, INFINITY}, lhi[3] = {-INFINITY, -INFINITY, -INFINITY};
        int lc = 0;
        for (int b = 0; b < kBins - 1; ++b) {
            lc += count[b];
            for (int k = 0; k < 3; ++k) { llo[k] = std::min(llo[k], lo[b][k]); lhi[k] = std::max(lhi[k], hi[b][k]); }
            if (lc == 0 || rightCount[b + 1] == 0) continue;
            const double cost = area(llo, lhi) * lc + rightArea[b + 1] * rightCount[b + 1];
            if (cost < bestCost) { bestCost = cost; bestAxis = axis; bestBin = b; }
        }
    }

    int split = from;
    if (bestAxis >= 0) {
        const double extent = chi[bestAxis] - clo[bestAxis];
        auto mid = std::partition(s.order.begin() + from, s.order.begin() + to, [&](int tri) {
            int b = static_cast<int>((centroid[static_cast<size_t>(tri) * 3 + bestAxis] - clo[bestAxis]) / extent * kBins);
            b = std::min(kBins - 1, std::max(0, b));
            return b <= bestBin;
        });
        split = static_cast<int>(mid - s.order.begin());
    }
    // Every centroid in one bin (or on one point): split down the middle so the
    // recursion still shrinks.
    if (split == from || split == to) split = (from + to) / 2;

    const int left = static_cast<int>(s.nodes.size());
    s.nodes.push_back({});
    s.nodes.push_back({});
    s.nodes[node].first = left;
    s.nodes[node].count = -1;
    build(s, centroid, left, from, split);
    build(s, centroid, left + 1, split, to);
}

// A slab product is NaN only for a zero direction component. Such a ray takes
// Math.min/Math.max's rule (NaN wins: the box is visited) via wasm's f64.min/max;
// every other ray takes the plain compare, which costs far less.
template <bool Exact> inline double jsMin(double a, double b) { return Exact ? __builtin_wasm_min_f64(a, b) : (a < b ? a : b); }
template <bool Exact> inline double jsMax(double a, double b) { return Exact ? __builtin_wasm_max_f64(a, b) : (a > b ? a : b); }

/** Slab test; the entry distance, or +inf when the box is missed within (eps, far). */
template <bool Exact>
inline double enter(const Node& n, double ox, double oy, double oz, double ix, double iy, double iz,
                    double epsilon, double far) {
    const double tx1 = (n.lo[0] - ox) * ix, tx2 = (n.hi[0] - ox) * ix;
    double tmin = jsMin<Exact>(tx1, tx2), tmax = jsMax<Exact>(tx1, tx2);
    const double ty1 = (n.lo[1] - oy) * iy, ty2 = (n.hi[1] - oy) * iy;
    tmin = jsMax<Exact>(tmin, jsMin<Exact>(ty1, ty2)); tmax = jsMin<Exact>(tmax, jsMax<Exact>(ty1, ty2));
    const double tz1 = (n.lo[2] - oz) * iz, tz2 = (n.hi[2] - oz) * iz;
    tmin = jsMax<Exact>(tmin, jsMin<Exact>(tz1, tz2)); tmax = jsMin<Exact>(tmax, jsMax<Exact>(tz1, tz2));
    if (tmax < jsMax<Exact>(tmin, epsilon) || tmin > far) return INFINITY;
    return tmin != tmin ? -INFINITY : tmin;
}

/** Möller–Trumbore, both faces, as the TypeScript BVH has it; `far` itself is a hit. */
inline bool intersect(const Scene& s, int tri, double ox, double oy, double oz,
                      double dx, double dy, double dz, double epsilon, double far, Hit& hit) {
    const float* p = s.pos + static_cast<size_t>(tri) * 9;
    const double e1x = static_cast<double>(p[3]) - p[0], e1y = static_cast<double>(p[4]) - p[1], e1z = static_cast<double>(p[5]) - p[2];
    const double e2x = static_cast<double>(p[6]) - p[0], e2y = static_cast<double>(p[7]) - p[1], e2z = static_cast<double>(p[8]) - p[2];
    const double hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const double a = e1x * hx + e1y * hy + e1z * hz;
    if (a > -1e-12 && a < 1e-12) return false;
    const double f = 1 / a;
    const double sx = ox - p[0], sy = oy - p[1], sz = oz - p[2];
    const double u = f * (sx * hx + sy * hy + sz * hz);
    if (u < 0 || u > 1) return false;
    const double qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const double v = f * (dx * qx + dy * qy + dz * qz);
    if (v < 0 || u + v > 1) return false;
    const double t = f * (e2x * qx + e2y * qy + e2z * qz);
    if (t <= epsilon || t > far) return false;
    hit.t = t; hit.u = u; hit.v = v;
    return true;
}

/** The nearest triangle in (epsilon, far], or -1; `anyHit` stops at the first. */
template <bool Exact>
int traceWith(const Scene& s, double ox, double oy, double oz, double dx, double dy, double dz,
          double far, double epsilon, bool anyHit, Hit& hit) {
    if (s.nodes.empty()) return -1;
    const double ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    int best = -1;
    double bestT = far;
    int stack[128];
    int sp = 0;
    if (enter<Exact>(s.nodes[0], ox, oy, oz, ix, iy, iz, epsilon, bestT) == INFINITY) return -1;
    stack[sp++] = 0;
    Hit h;
    while (sp > 0) {
        const Node& n = s.nodes[stack[--sp]];
        if (n.count >= 0) {
            for (int k = 0; k < n.count; ++k) {
                const int tri = s.order[n.first + k];
                if (!intersect(s, tri, ox, oy, oz, dx, dy, dz, epsilon, bestT, h)) continue;
                if (anyHit) { hit = h; return tri; }
                if (h.t == bestT && (best < 0 || tri > best)) continue;
                bestT = h.t; best = tri; hit = h;
            }
            continue;
        }
        const Node& a = s.nodes[n.first];
        const Node& b = s.nodes[n.first + 1];
        const double ta = enter<Exact>(a, ox, oy, oz, ix, iy, iz, epsilon, bestT);
        const double tb = enter<Exact>(b, ox, oy, oz, ix, iy, iz, epsilon, bestT);
        // Nearer child on top: its hits shrink `bestT` before the farther is opened.
        if (ta <= tb) {
            if (tb != INFINITY) stack[sp++] = n.first + 1;
            if (ta != INFINITY) stack[sp++] = n.first;
        } else {
            if (ta != INFINITY) stack[sp++] = n.first;
            if (tb != INFINITY) stack[sp++] = n.first + 1;
        }
    }
    if (best >= 0) hit.t = bestT;
    return best;
}

int trace(const Scene& s, double ox, double oy, double oz, double dx, double dy, double dz,
          double far, double epsilon, bool anyHit, Hit& hit) {
    return dx == 0 || dy == 0 || dz == 0
        ? traceWith<true>(s, ox, oy, oz, dx, dy, dz, far, epsilon, anyHit, hit)
        : traceWith<false>(s, ox, oy, oz, dx, dy, dz, far, epsilon, anyHit, hit);
}

inline double lengthOr1(double x, double y, double z) {
    const double len = std::sqrt(x * x + y * y + z * z);
    return len > 0 ? len : 1;
}

inline bool facesRay(const Scene& s, int tri, double dx, double dy, double dz) {
    if (s.twoSided[s.triSurface[tri]]) return true;
    const float* n = s.triNormal + static_cast<size_t>(tri) * 3;
    return n[0] * dx + n[1] * dy + n[2] * dz < 0;
}

inline uint32_t mix32(uint32_t x) {
    x = (x ^ (x >> 16)) * 0x7feb352du;
    x = (x ^ (x >> 15)) * 0x846ca68bu;
    return x ^ (x >> 16);
}

int firstHit(const Scene& s, double ox, double oy, double oz, double dx, double dy, double dz,
             double far, double epsilon, uint32_t seed, double backReach, Hit& hit) {
    double travelled = 0;
    for (int step = 0; step < 16; ++step) {
        const int tri = trace(s, ox, oy, oz, dx, dy, dz, far - travelled,
                              step == 0 ? epsilon : std::max(epsilon, kShadowEpsilon), false, hit);
        if (tri < 0) return -1;
        const bool near = travelled + hit.t < backReach && !facesRay(s, tri, dx, dy, dz);
        const double keep = s.coverage[s.triSurface[tri]];
        if (!near && (keep >= 1 || mix32(seed ^ (static_cast<uint32_t>(step + 1) * 0x9e3779b9u)) / 4294967296.0 < keep)) {
            return tri;
        }
        ox += dx * hit.t; oy += dy * hit.t; oz += dz * hit.t;
        travelled += hit.t;
    }
    return -1;
}

bool blocked(const Scene& s, double ox, double oy, double oz, double dx, double dy, double dz,
             double far, uint32_t seed) {
    Hit hit;
    if (!s.cutouts && !(s.backReach > 0)) {
        return trace(s, ox, oy, oz, dx, dy, dz, far, kShadowEpsilon, true, hit) >= 0;
    }
    return firstHit(s, ox, oy, oz, dx, dy, dz, far, kShadowEpsilon, seed, s.backReach, hit) >= 0;
}

int texelOf(const Scene& s, int tri, double u, double v, int size) {
    const float* uv = s.triUV + static_cast<size_t>(tri) * 6;
    const double w0 = 1 - u - v;
    const double uu = w0 * uv[0] + u * uv[2] + v * uv[4];
    const double vv = w0 * uv[1] + u * uv[3] + v * uv[5];
    const float* p = s.patch + static_cast<size_t>(s.triSurface[tri]) * 4;
    const bool rotated = p[3] != 0;
    const double side = p[2];
    const double x = std::floor(p[0] + (rotated ? vv : uu) * side);
    const double y = std::floor(p[1] + (rotated ? uu : vv) * side);
    if (x < 0 || y < 0 || x >= size || y >= size) return -1;
    return static_cast<int>(y) * size + static_cast<int>(x);
}

/** Cosine-weighted Hammersley directions, as solve.ts's `hemisphere`. */
std::vector<float> hemisphere(int samples) {
    std::vector<float> out(static_cast<size_t>(samples) * 3);
    for (int i = 0; i < samples; ++i) {
        uint32_t bits = static_cast<uint32_t>(i);
        bits = (bits << 16) | (bits >> 16);
        bits = ((bits & 0x55555555u) << 1) | ((bits & 0xaaaaaaaau) >> 1);
        bits = ((bits & 0x33333333u) << 2) | ((bits & 0xccccccccu) >> 2);
        bits = ((bits & 0x0f0f0f0fu) << 4) | ((bits & 0xf0f0f0f0u) >> 4);
        bits = ((bits & 0x00ff00ffu) << 8) | ((bits & 0xff00ff00u) >> 8);
        const double u = (i + 0.5) / samples;
        const double v = bits * 2.3283064365386963e-10;
        const double r = std::sqrt(u);
        const double phi = 2 * M_PI * v;
        out[i * 3] = static_cast<float>(r * std::cos(phi));
        out[i * 3 + 1] = static_cast<float>(r * std::sin(phi));
        out[i * 3 + 2] = static_cast<float>(std::sqrt(std::max(0.0, 1 - u)));
    }
    return out;
}

inline void frame(double nx, double ny, double nz, float* out) {
    const double sign = nz >= 0 ? 1 : -1;
    const double a = -1 / (sign + nz);
    const double b = nx * ny * a;
    out[0] = static_cast<float>(1 + sign * nx * nx * a); out[1] = static_cast<float>(sign * b);
    out[2] = static_cast<float>(-sign * nx); out[3] = static_cast<float>(b);
    out[4] = static_cast<float>(sign + ny * ny * a); out[5] = static_cast<float>(-ny);
}

/** The sky: kind 0 flat (rgb), kind 1 nine unconvolved coefficients turned by yaw and tinted. */
struct Sky {
    int kind = 0;
    double rgb[3] = {0, 0, 0};
    double radiance[27] = {};
    double c = 1, s = 0;
    double tint[3] = {1, 1, 1};

    void at(double dx, double dy, double dz, double* out) const {
        // Rounded to float where skyRadiance holds values in a Float32Array: the
        // basis, and what it writes out.
        if (kind == 0) { for (int k = 0; k < 3; ++k) out[k] = static_cast<float>(rgb[k]); return; }
        const double x = c * dx + s * dz, y = dy, z = -s * dx + c * dz;
        const float basis[9] = {
            0.282095f, static_cast<float>(0.488603 * y), static_cast<float>(0.488603 * z),
            static_cast<float>(0.488603 * x), static_cast<float>(1.092548 * x * y),
            static_cast<float>(1.092548 * y * z), static_cast<float>(0.315392 * (3 * z * z - 1)),
            static_cast<float>(1.092548 * x * z), static_cast<float>(0.546274 * (x * x - y * y)),
        };
        for (int k = 0; k < 3; ++k) {
            double v = 0;
            for (int i = 0; i < 9; ++i) v += radiance[i * 3 + k] * basis[i];
            out[k] = static_cast<float>(std::max(0.0, v) * tint[k]);
        }
    }
};

/** Runs `body(i)` for every i in [0, count) on `threads` threads, in chunks. */
template <typename F>
void parallelFor(int count, int threads, int minChunk, F body) {
    std::atomic<int> next{0};
    const int chunk = std::max(minChunk, count / std::max(1, threads * 32));
    auto work = [&]() {
        for (;;) {
            const int from = next.fetch_add(chunk);
            if (from >= count) return;
            const int to = std::min(count, from + chunk);
            for (int i = from; i < to; ++i) body(i);
        }
    };
    std::vector<std::thread> pool;
    for (int t = 1; t < threads; ++t) pool.emplace_back(work);
    work();
    for (auto& t : pool) t.join();
}

}  // namespace

extern "C" {

/** Adopts the triangle arrays (the caller keeps them alive) and builds the tree. */
void lm_scene(const float* pos, int triCount, const float* triUV, const int* triSurface,
              const float* patch, const float* albedo, const float* triNormal,
              const uint8_t* twoSided, const float* coverage, int surfaceCount, double backReach) {
    Scene& s = g_scene;
    s.pos = pos; s.triCount = triCount; s.triUV = triUV; s.triSurface = triSurface;
    s.patch = patch; s.albedo = albedo; s.triNormal = triNormal; s.twoSided = twoSided;
    s.coverage = coverage; s.backReach = backReach;
    s.cutouts = false;
    for (int i = 0; i < surfaceCount; ++i) if (coverage[i] < 1) s.cutouts = true;
    s.order.resize(triCount);
    for (int i = 0; i < triCount; ++i) s.order[i] = i;
    std::vector<float> centroid(static_cast<size_t>(triCount) * 3);
    for (int t = 0; t < triCount; ++t) {
        const float* p = pos + static_cast<size_t>(t) * 9;
        for (int k = 0; k < 3; ++k) centroid[static_cast<size_t>(t) * 3 + k] = (p[k] + p[3 + k] + p[6 + k]) / 3;
    }
    s.nodes.clear();
    s.nodes.reserve(static_cast<size_t>(std::max(1, triCount)) * 2);
    s.nodes.push_back({});
    if (triCount > 0) build(s, centroid, 0, 0, triCount);
    else s.nodes.clear();
}

/**
 * Direct light at every lumel. `lights` is 16 doubles each: kind (0 directional,
 * 1 point, 2 spot), position 3, direction 3, colour 3, intensity, radius,
 * inner cos, outer cos, unused.
 */
void lm_direct(const float* position, const float* normal, int count,
               const double* lights, int lightCount, float* out, int threads) {
    const Scene& s = g_scene;
    parallelFor(count, threads, 64, [&](int i) {
        const double px = position[i * 3], py = position[i * 3 + 1], pz = position[i * 3 + 2];
        const double nx = normal[i * 3], ny = normal[i * 3 + 1], nz = normal[i * 3 + 2];
        double r = 0, g = 0, b = 0;
        for (int li = 0; li < lightCount; ++li) {
            const double* L = lights + li * 16;
            const int kind = static_cast<int>(L[0]);
            double lx, ly, lz, distance, falloff = 1;
            if (kind == 0) {
                const double len = lengthOr1(L[4], L[5], L[6]);
                lx = -L[4] / len; ly = -L[5] / len; lz = -L[6] / len;
                distance = INFINITY;
            } else {
                lx = L[1] - px; ly = L[2] - py; lz = L[3] - pz;
                distance = std::sqrt(lx * lx + ly * ly + lz * lz);
                if (distance < 1e-6) continue;
                lx /= distance; ly /= distance; lz /= distance;
                const double radius = L[12];
                if (radius > 0) {
                    if (distance >= radius) continue;
                    const double k = 1 - distance / radius;
                    falloff = k * k;
                }
                if (kind == 2) {
                    const double len = lengthOr1(L[4], L[5], L[6]);
                    const double cosA = -(lx * L[4] + ly * L[5] + lz * L[6]) / len;
                    const double outer = L[14], inner = L[13];
                    if (cosA <= outer) continue;
                    falloff *= std::min(1.0, (cosA - outer) / std::max(inner - outer, 1e-4));
                }
            }
            const double lambert = nx * lx + ny * ly + nz * lz;
            if (lambert <= 0) continue;
            const double far = distance == INFINITY ? 1e7 : distance - kShadowEpsilon;
            const uint32_t seed = static_cast<uint32_t>(i) * 31u ^ static_cast<uint32_t>(li);
            if (blocked(s, px + nx * kShadowEpsilon, py + ny * kShadowEpsilon, pz + nz * kShadowEpsilon,
                        lx, ly, lz, far, seed)) continue;
            const double w = lambert * falloff * L[11];
            r += L[7] * w; g += L[8] * w; b += L[9] * w;
        }
        out[i * 3] = static_cast<float>(r); out[i * 3 + 1] = static_cast<float>(g); out[i * 3 + 2] = static_cast<float>(b);
    });
}

/**
 * Everything that reaches each lumel indirectly. `sky` is 36 doubles: kind, flat
 * rgb, yaw, tint rgb, then the 27 unconvolved coefficients (rounded to float,
 * as skyRadiance holds them).
 */
void lm_gather(const float* position, const float* normal, int count,
               const float* atlas, int atlasSize, int samples, const double* sky, float* out, int threads) {
    const Scene& s = g_scene;
    Sky skyOf;
    skyOf.kind = static_cast<int>(sky[0]);
    for (int k = 0; k < 3; ++k) { skyOf.rgb[k] = sky[1 + k]; skyOf.tint[k] = sky[5 + k]; }
    skyOf.c = std::cos(sky[4]); skyOf.s = std::sin(sky[4]);
    for (int k = 0; k < 27; ++k) skyOf.radiance[k] = sky[8 + k];
    const std::vector<float> dirs = hemisphere(samples);
    parallelFor(count, threads, 64, [&](int i) {
        const double px = position[i * 3], py = position[i * 3 + 1], pz = position[i * 3 + 2];
        const double nx = normal[i * 3], ny = normal[i * 3 + 1], nz = normal[i * 3 + 2];
        float basis[6];
        frame(nx, ny, nz, basis);
        double r = 0, g = 0, b = 0, seen[3];
        Hit hit;
        for (int k = 0; k < samples; ++k) {
            const double a = dirs[k * 3], c = dirs[k * 3 + 1], d = dirs[k * 3 + 2];
            const double dx = basis[0] * a + basis[3] * c + nx * d;
            const double dy = basis[1] * a + basis[4] * c + ny * d;
            const double dz = basis[2] * a + basis[5] * c + nz * d;
            const uint32_t seed = static_cast<uint32_t>(i) * static_cast<uint32_t>(samples) + static_cast<uint32_t>(k);
            const int tri = firstHit(s, px + nx * kShadowEpsilon, py + ny * kShadowEpsilon, pz + nz * kShadowEpsilon,
                                     dx, dy, dz, 1e7, kShadowEpsilon, seed, s.backReach, hit);
            if (tri < 0) {
                skyOf.at(dx, dy, dz, seen);
                r += seen[0]; g += seen[1]; b += seen[2];
                continue;
            }
            if (!facesRay(s, tri, dx, dy, dz)) continue;
            const int texel = texelOf(s, tri, hit.u, hit.v, atlasSize);
            if (texel < 0) continue;
            const float* alb = s.albedo + static_cast<size_t>(s.triSurface[tri]) * 3;
            r += static_cast<double>(atlas[static_cast<size_t>(texel) * 3]) * alb[0];
            g += static_cast<double>(atlas[static_cast<size_t>(texel) * 3 + 1]) * alb[1];
            b += static_cast<double>(atlas[static_cast<size_t>(texel) * 3 + 2]) * alb[2];
        }
        out[i * 3] = static_cast<float>(r / samples);
        out[i * 3 + 1] = static_cast<float>(g / samples);
        out[i * 3 + 2] = static_cast<float>(b / samples);
    });
}

/**
 * lightmapBake.ts's statsOf for each PNG, summed in its order, through the
 * caller's `toLinear` table so the conversion has one author. `files` is
 * (pointer, size) pairs; `out` is five doubles per file: 1 solved, 2 empty, or
 * 0 left to the caller (not an 8-bit PNG); then mean rgb and coverage.
 */
void lm_texture_stats(const uint32_t* files, const double* cutoffs, int count, const double* toLinear,
                      double* out, int threads) {
    parallelFor(count, threads, 1, [&](int f) {
        double* o = out + f * 5;
        o[0] = 0;
        const auto* bytes = reinterpret_cast<const stbi_uc*>(static_cast<uintptr_t>(files[f * 2]));
        const int size = static_cast<int>(files[f * 2 + 1]);
        if (stbi_is_16_bit_from_memory(bytes, size)) return;
        int w = 0, h = 0, n = 0;
        stbi_uc* data = stbi_load_from_memory(bytes, size, &w, &h, &n, 4);
        if (!data) return;
        const size_t pixels = static_cast<size_t>(w) * h;
        const double floor = cutoffs[f] > 0 ? cutoffs[f] * 255 : -1;
        double r = 0, g = 0, b = 0;
        size_t kept = 0;
        for (size_t i = 0; i < pixels; ++i) {
            if (data[i * 4 + 3] < floor) continue;
            r += toLinear[data[i * 4]];
            g += toLinear[data[i * 4 + 1]];
            b += toLinear[data[i * 4 + 2]];
            ++kept;
        }
        stbi_image_free(data);
        o[0] = pixels == 0 ? 2 : 1;
        if (kept > 0) {
            o[1] = r / kept; o[2] = g / kept; o[3] = b / kept;
            o[4] = static_cast<double>(kept) / pixels;
        } else {
            o[1] = o[2] = o[3] = o[4] = 0;
        }
    });
}

}  // extern "C"
