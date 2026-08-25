// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bench.cpp
 * @brief   Stage 0 of the AOT proposal: is compiling the system loop worth it?
 *
 * @details `docs/REARCH_AOT.md` §10 makes Stage 0 a go/no-go, and §11 names the
 *          risk it exists to retire: the speedup may be mostly the BOUNDARY COPY,
 *          not the interpreter — and the copy has a fix that costs 5% of a
 *          compiler (§12.B). A benchmark that reports one number cannot tell
 *          those apart, so this one runs the same system four ways:
 *
 *            A   today's SDK path  — fillTransform, body, writeTransform
 *            B   in-place view     — accessors onto the bytes, nothing copied
 *            B2  raw indexing      — the interpreted floor, no object layer
 *            C   native C++        — the AOT ceiling
 *
 *          A/C is the headline. A/B is what a pure SDK change buys. B/C is what
 *          COMPILING buys, and that is the number Stage 0 actually turns on.
 *
 *          Why this process and not the Bun proxy in bench/README.md: that one
 *          exists to model an iPhone from a Mac. Stage 0 does not need iOS — it
 *          needs a no-JIT interpreter and a native compiler on the SAME cpu, on
 *          the SAME bytes, in the SAME process. QuickJS is the interpreter the
 *          native host actually ships (it has no JIT on ANY platform), and it is
 *          linked right here, so the comparison has nothing left to apologise for.
 *
 *          Fairness rules, all of which matter:
 *          - every variant walks the same candidate list through the same
 *            sparse->dense indirection a real query pays;
 *          - every variant starts from an identical snapshot of the pools;
 *          - the arithmetic is f64 with an f32 store in ALL FOUR, because that
 *            is what JS `number` means and therefore what an AOT compiler would
 *            have to emit. C++ doing it in float would be a different program;
 *          - a checksum over the pool must come out identical for all four. If
 *            it does not, they are not doing the same work and no timing from
 *            the run means anything.
 */
#include "quickjs.h"

#include "esengine/ecs/components/Transform.hpp"
#include "esengine/ecs/components/Velocity.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using esengine::ecs::Transform;
using esengine::ecs::Velocity;

// The offsets variants.js hard-codes, checked against the real struct. EHT keeps
// the SDK's generated accessors honest the same way; this keeps the bench honest.
static_assert(offsetof(Transform, position) == 0, "variants.js T_POS");
static_assert(offsetof(Transform, rotation) == 12, "variants.js T_ROT");
static_assert(offsetof(Transform, scale) == 28, "variants.js T_SCL");
static_assert(offsetof(Transform, worldPosition) == 40, "variants.js T_WPOS");
static_assert(offsetof(Transform, worldRotation) == 52, "variants.js T_WROT");
static_assert(offsetof(Transform, worldScale) == 68, "variants.js T_WSCL");
static_assert(offsetof(Velocity, linear) == 0, "variants.js V_LIN");
static_assert(offsetof(Velocity, angular) == 12, "variants.js V_ANG");

namespace {

// --------------------------------------------------------------------------
// config
// --------------------------------------------------------------------------
int intEnv(const char* name, int def) {
    const char* v = std::getenv(name);
    if (!v || !*v) return def;
    char* end = nullptr;
    long n = std::strtol(v, &end, 10);
    return (end && *end == 0 && n > 0) ? static_cast<int>(n) : def;
}
bool strEnvIs(const char* name, const char* want) {
    const char* v = std::getenv(name);
    return v && std::strcmp(v, want) == 0;
}

const int   ENTITIES = intEnv("BENCH_ENTITIES", 5000);
const int   FRAMES   = intEnv("BENCH_FRAMES", 600);
const int   WARMUP   = intEnv("BENCH_WARMUP", 60);
const double DT      = 1.0 / 60.0;

// --------------------------------------------------------------------------
// world
// --------------------------------------------------------------------------
struct World {
    std::vector<Transform> transforms;      // the dense pool
    std::vector<Velocity>  velocities;      // the dense pool
    std::vector<uint32_t>  sparse;          // entity id -> dense row
    std::vector<uint32_t>  ents;            // the candidate list a query walks
    std::vector<uint8_t>   changed;         // world.markChanged's bit

    std::vector<Transform> pristineT;
    std::vector<Velocity>  pristineV;

    void reset() {
        transforms = pristineT;
        velocities = pristineV;
        std::fill(changed.begin(), changed.end(), uint8_t{0});
    }
};

// mulberry32, same generator the existing bench uses, so both build the same scene.
struct Rand {
    uint32_t a;
    explicit Rand(uint32_t seed) : a(seed) {}
    double operator()() {
        a += 0x6D2B79F5u;
        uint32_t t = a;
        t = (t ^ (t >> 15)) * (1u | t);
        t += (t ^ (t >> 7)) * (61u | t);
        return static_cast<double>((t ^ (t >> 14))) / 4294967296.0;
    }
};

World buildWorld(int n, bool scattered) {
    World w;
    w.transforms.resize(n);
    w.velocities.resize(n);
    w.sparse.resize(n);
    w.ents.resize(n);
    w.changed.assign(n, 0);

    // Dense rows in entity order, or permuted. A world that has spawned and
    // despawned does not keep its pool sorted by entity id, and walking it out of
    // order is a different memory workload — one every variant pays equally.
    std::vector<uint32_t> rows(n);
    for (int i = 0; i < n; i++) rows[i] = static_cast<uint32_t>(i);
    if (scattered) {
        Rand shuffle(0xC0FFEEu);
        for (int i = n - 1; i > 0; i--) {
            int j = static_cast<int>(shuffle() * (i + 1));
            std::swap(rows[i], rows[j]);
        }
    }

    Rand rand(0x1234abcdu);
    for (int e = 0; e < n; e++) {
        w.ents[e] = static_cast<uint32_t>(e);
        w.sparse[e] = rows[e];
        Transform& t = w.transforms[rows[e]];
        t.position = {static_cast<float>((rand() - 0.5) * 2000.0),
                      static_cast<float>((rand() - 0.5) * 2000.0), 0.0f};
        Velocity& v = w.velocities[rows[e]];
        v.linear = {static_cast<float>((rand() - 0.5) * 120.0),
                    static_cast<float>((rand() - 0.5) * 120.0), 0.0f};
    }
    w.pristineT = w.transforms;
    w.pristineV = w.velocities;
    return w;
}

// FNV-1a over the pools. Every variant must produce the same digest.
uint64_t checksum(const World& w) {
    uint64_t h = 1469598103934665603ull;
    auto feed = [&h](const void* p, size_t n) {
        const uint8_t* b = static_cast<const uint8_t*>(p);
        for (size_t i = 0; i < n; i++) { h ^= b[i]; h *= 1099511628211ull; }
    };
    feed(w.transforms.data(), w.transforms.size() * sizeof(Transform));
    feed(w.changed.data(), w.changed.size());
    return h;
}

// --------------------------------------------------------------------------
// variant C — native. The ceiling.
//
// f64 math with an f32 store, matching JS `number` semantics exactly. An AOT
// compiler could only narrow this to f32 by PROVING the narrowing safe, which it
// cannot do for a `number`, so this is the honest ceiling — not a faster program
// that happens to compute something else.
// --------------------------------------------------------------------------
void variantC(World& w, double dt) {
    const int n = ENTITIES;
    const uint32_t* ents = w.ents.data();
    const uint32_t* sparse = w.sparse.data();
    Transform* tf = w.transforms.data();
    const Velocity* vf = w.velocities.data();
    uint8_t* changed = w.changed.data();

    for (int i = 0; i < n; i++) {
        const uint32_t e = ents[i];
        const uint32_t row = sparse[e];
        Transform& t = tf[row];
        const Velocity& v = vf[row];
        t.position.x = static_cast<float>(static_cast<double>(t.position.x) + static_cast<double>(v.linear.x) * dt);
        t.position.y = static_cast<float>(static_cast<double>(t.position.y) + static_cast<double>(v.linear.y) * dt);
        t.position.z = static_cast<float>(static_cast<double>(t.position.z) + static_cast<double>(v.linear.z) * dt);
        changed[e] = 1;
    }
}

// The thick body — see the header comment in variants.js. Same arithmetic, same
// order, same branches, so it stays bit-identical to the three JS variants.
constexpr double MAXSPEED = 50.0;   // must match variants.js
constexpr double MAXSPEED2 = MAXSPEED * MAXSPEED;
constexpr double BOUND = 1000.0;
constexpr double BOUND2 = BOUND * 2.0;

void variantCThick(World& w, double dt) {
    const int n = ENTITIES;
    const uint32_t* ents = w.ents.data();
    const uint32_t* sparse = w.sparse.data();
    Transform* tf = w.transforms.data();
    const Velocity* vf = w.velocities.data();
    uint8_t* changed = w.changed.data();

    for (int i = 0; i < n; i++) {
        const uint32_t e = ents[i];
        const uint32_t row = sparse[e];
        Transform& t = tf[row];
        const Velocity& v = vf[row];

        double vx = v.linear.x, vy = v.linear.y, vz = v.linear.z;
        const double sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > MAXSPEED2) { const double s = MAXSPEED / std::sqrt(sp2); vx *= s; vy *= s; vz *= s; }
        double px = static_cast<double>(t.position.x) + vx * dt;
        double py = static_cast<double>(t.position.y) + vy * dt;
        const double pz = static_cast<double>(t.position.z) + vz * dt;
        if (px > BOUND) px -= BOUND2; else if (px < -BOUND) px += BOUND2;
        if (py > BOUND) py -= BOUND2; else if (py < -BOUND) py += BOUND2;
        t.position.x = static_cast<float>(px);
        t.position.y = static_cast<float>(py);
        t.position.z = static_cast<float>(pz);

        changed[e] = 1;
    }
}

// --------------------------------------------------------------------------
// stats
// --------------------------------------------------------------------------
struct Result {
    const char* name;
    const char* what;
    double median;   // ms/frame
    double p95;
    double mean;
    uint64_t digest;
};

double percentile(std::vector<double>& sorted, double p) {
    if (sorted.empty()) return 0.0;
    size_t idx = static_cast<size_t>((p / 100.0) * sorted.size());
    if (idx >= sorted.size()) idx = sorted.size() - 1;
    return sorted[idx];
}

using Clock = std::chrono::steady_clock;
double msSince(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

// --------------------------------------------------------------------------
// QuickJS plumbing
// --------------------------------------------------------------------------
std::string readFile(const char* path) {
    FILE* f = std::fopen(path, "rb");
    if (!f) return {};
    std::fseek(f, 0, SEEK_END);
    long n = std::ftell(f);
    std::fseek(f, 0, SEEK_SET);
    std::string s(static_cast<size_t>(n > 0 ? n : 0), '\0');
    if (n > 0 && std::fread(s.data(), 1, static_cast<size_t>(n), f) != static_cast<size_t>(n)) s.clear();
    std::fclose(f);
    return s;
}

void reportException(JSContext* ctx) {
    JSValue e = JS_GetException(ctx);
    const char* s = JS_ToCString(ctx, e);
    std::fprintf(stderr, "js error: %s\n", s ? s : "(unprintable)");
    if (s) JS_FreeCString(ctx, s);
    JS_FreeValue(ctx, e);
}

// An ArrayBuffer aliasing memory we own. free_func = nullptr, so QuickJS never
// frees it — the same trick es_<Component>_buffer uses to hand the SDK the pool.
JSValue aliasBuffer(JSContext* ctx, void* p, size_t bytes) {
    return JS_NewArrayBuffer(ctx, static_cast<uint8_t*>(p), bytes, nullptr, nullptr, false);
}

}  // namespace

int main() {
    const bool scattered = strEnvIs("BENCH_ORDER", "scattered");
    const bool thick = strEnvIs("BENCH_BODY", "thick");

    std::printf("================================================================\n");
    std::printf("Estella AOT — Stage 0 loop benchmark   (REARCH_AOT.md §10)\n");
    std::printf("  interpreter : QuickJS %d.%d.%d (no JIT, on any platform)\n",
                QJS_VERSION_MAJOR, QJS_VERSION_MINOR, QJS_VERSION_PATCH);
    std::printf("  entities    : %d\n", ENTITIES);
    std::printf("  frames      : %d (+%d warmup)\n", FRAMES, WARMUP);
    std::printf("  pool order  : %s\n", scattered ? "scattered (post-churn)" : "dense (best case)");
    std::printf("  strides     : Transform %zu B   Velocity %zu B\n",
                sizeof(Transform), sizeof(Velocity));
    std::printf("================================================================\n");

    World w = buildWorld(ENTITIES, scattered);

    JSRuntime* rt = JS_NewRuntime();
    JSContext* ctx = JS_NewContext(rt);
    if (!rt || !ctx) { std::fprintf(stderr, "could not create the QuickJS runtime\n"); return 1; }

#ifndef BENCH_VARIANTS_DEFAULT
#define BENCH_VARIANTS_DEFAULT "variants.js"
#endif
    const char* srcPath = std::getenv("BENCH_VARIANTS");
    std::string path = srcPath ? srcPath : BENCH_VARIANTS_DEFAULT;
    std::string src = readFile(path.c_str());
    if (src.empty()) {
        std::fprintf(stderr, "could not read %s — set BENCH_VARIANTS to its path\n", path.c_str());
        return 1;
    }
    JSValue ev = JS_Eval(ctx, src.c_str(), src.size(), path.c_str(), JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(ev)) { reportException(ctx); return 1; }
    JS_FreeValue(ctx, ev);

    JSValue global = JS_GetGlobalObject(ctx);

    // Hand JS the pools. Zero copy — the same bytes variant C walks.
    {
        JSValue setup = JS_GetPropertyStr(ctx, global, "setup");
        JSValue args[8] = {
            JS_NewInt32(ctx, ENTITIES),
            aliasBuffer(ctx, w.ents.data(), w.ents.size() * sizeof(uint32_t)),
            aliasBuffer(ctx, w.sparse.data(), w.sparse.size() * sizeof(uint32_t)),
            aliasBuffer(ctx, w.transforms.data(), w.transforms.size() * sizeof(Transform)),
            aliasBuffer(ctx, w.velocities.data(), w.velocities.size() * sizeof(Velocity)),
            aliasBuffer(ctx, w.changed.data(), w.changed.size()),
            JS_NewInt32(ctx, static_cast<int32_t>(sizeof(Transform))),
            JS_NewInt32(ctx, static_cast<int32_t>(sizeof(Velocity))),
        };
        JSValue r = JS_Call(ctx, setup, JS_UNDEFINED, 8, args);
        if (JS_IsException(r)) { reportException(ctx); return 1; }
        JS_FreeValue(ctx, r);
        for (JSValue& a : args) JS_FreeValue(ctx, a);
        JS_FreeValue(ctx, setup);
    }

    std::vector<Result> results;

    // One JS variant: reset, warm, time FRAMES calls of fn(dt).
    auto runJs = [&](const char* name, const char* what, const char* fnName) {
        JSValue fn = JS_GetPropertyStr(ctx, global, fnName);
        if (!JS_IsFunction(ctx, fn)) {
            std::fprintf(stderr, "%s is not a function in variants.js\n", fnName);
            std::exit(1);
        }
        w.reset();
        JSValue dt = JS_NewFloat64(ctx, DT);
        for (int f = 0; f < WARMUP; f++) {
            JSValue r = JS_Call(ctx, fn, JS_UNDEFINED, 1, &dt);
            if (JS_IsException(r)) { reportException(ctx); std::exit(1); }
            JS_FreeValue(ctx, r);
        }
        w.reset();
        std::vector<double> samples;
        samples.reserve(static_cast<size_t>(FRAMES));
        for (int f = 0; f < FRAMES; f++) {
            auto t0 = Clock::now();
            JSValue r = JS_Call(ctx, fn, JS_UNDEFINED, 1, &dt);
            samples.push_back(msSince(t0));
            if (JS_IsException(r)) { reportException(ctx); std::exit(1); }
            JS_FreeValue(ctx, r);
        }
        JS_FreeValue(ctx, fn);
        uint64_t digest = checksum(w);
        double mean = 0.0;
        for (double s : samples) mean += s;
        mean /= static_cast<double>(samples.size());
        std::sort(samples.begin(), samples.end());
        results.push_back({name, what, percentile(samples, 50), percentile(samples, 95), mean, digest});
    };

    auto runNative = [&](const char* name, const char* what) {
        auto fn = thick ? &variantCThick : &variantC;
        w.reset();
        for (int f = 0; f < WARMUP; f++) fn(w, DT);
        w.reset();
        std::vector<double> samples;
        samples.reserve(static_cast<size_t>(FRAMES));
        for (int f = 0; f < FRAMES; f++) {
            auto t0 = Clock::now();
            fn(w, DT);
            samples.push_back(msSince(t0));
        }
        uint64_t digest = checksum(w);
        double mean = 0.0;
        for (double s : samples) mean += s;
        mean /= static_cast<double>(samples.size());
        std::sort(samples.begin(), samples.end());
        results.push_back({name, what, percentile(samples, 50), percentile(samples, 95), mean, digest});
    };

    runJs("A",  "SDK today (fill + body + write-back)", thick ? "variantA_thick"  : "variantA");
    runJs("B",  "in-place view (SDK fix, §12.B)",       thick ? "variantB_thick"  : "variantB");
    runJs("B2", "raw indexing (interpreted floor)",     thick ? "variantB2_thick" : "variantB2");
    runNative("C", "native C++ (the AOT ceiling)");

    JS_FreeValue(ctx, global);

    // ----------------------------------------------------------------------
    // report
    // ----------------------------------------------------------------------
    std::printf("\n  variant  %-38s %10s %10s\n", "what it is", "ms/frame", "p95");
    std::printf("  -------  %-38s %10s %10s\n",
                "--------------------------------------", "----------", "----------");
    for (const Result& r : results) {
        std::printf("  %-7s  %-38s %10.4f %10.4f\n", r.name, r.what, r.median, r.p95);
    }

    const uint64_t want = results.front().digest;
    bool agree = true;
    for (const Result& r : results) if (r.digest != want) agree = false;
    std::printf("\n  checksum  %016llx  %s\n",
                static_cast<unsigned long long>(want),
                agree ? "all four variants agree"
                      : "*** MISMATCH — the variants are NOT doing the same work ***");
    if (!agree) {
        for (const Result& r : results) {
            std::printf("      %-3s %016llx\n", r.name, static_cast<unsigned long long>(r.digest));
        }
        std::printf("\n  Timings above are meaningless until this is fixed.\n");
        JS_FreeContext(ctx);
        JS_FreeRuntime(rt);
        return 2;
    }

    const double A = results[0].median, B = results[1].median;
    const double B2 = results[2].median, C = results[3].median;
    const double total = A / C, sdkFix = A / B, viewCost = B / B2, compiled = B / C;

    std::printf("\n  where the speedup actually comes from\n");
    std::printf("  ------------------------------------------------------------\n");
    std::printf("    A -> B   %6.2fx   what a pure SDK change buys  (§12.B)\n", sdkFix);
    std::printf("    B -> B2  %6.2fx   what the accessor layer costs\n", viewCost);
    std::printf("    B -> C   %6.2fx   what COMPILING buys  <-- the Stage 0 question\n", compiled);
    std::printf("    A -> C   %6.2fx   total AOT ceiling\n", total);
    std::printf("    throughput  A %.2f  C %.2f  M entity-updates/s\n",
                ENTITIES * (1000.0 / A) / 1e6, ENTITIES * (1000.0 / C) / 1e6);

    // REARCH_AOT §10: >= 5x total, and at least half of it must NOT be the copy.
    // "Half" in a ratio is geometric: sqrt(5) on each side.
    const double NEED_TOTAL = 5.0;
    const double NEED_COMPILED = 2.2360679775;   // sqrt(5)
    const bool passTotal = total >= NEED_TOTAL;
    const bool passCompiled = compiled >= NEED_COMPILED;

    std::printf("\n  Stage 0 exit criteria\n");
    std::printf("  ------------------------------------------------------------\n");
    std::printf("    A -> C  >= %.2fx   %6.2fx   %s\n", NEED_TOTAL, total, passTotal ? "PASS" : "FAIL");
    std::printf("    B -> C  >= %.2fx   %6.2fx   %s\n", NEED_COMPILED, compiled, passCompiled ? "PASS" : "FAIL");
    std::printf("\n  VERDICT: %s\n", (passTotal && passCompiled)
        ? "GO — compiling buys more than the SDK fix alone. Proceed to Stage 1."
        : "STOP — take REARCH_AOT.md §12 instead, starting with B. Re-read the split above.");
    std::printf("================================================================\n");

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return 0;
}
