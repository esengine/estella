// A retained label's quads are clipped against the view by the engine; the text path that hands every label over each frame clips them in TS.
// Both must keep the same quads. tools/gen-retained-text-cases.mjs runs the TS one on random batches, views and models and writes what it kept
// to tests/renderer/data/retained_text_cases.txt; this runs the engine's on the same inputs. Header-only, so no engine link.
//
//   test_retained_text [path to retained_text_cases.txt]

#include "esengine/renderer/draw/RetainedText.hpp"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
    } while (0)

static std::vector<f32> floats(const std::string& line, usize skip) {
    std::istringstream in(line);
    std::string word;
    for (usize i = 0; i < skip; ++i) in >> word;
    std::vector<f32> out;
    while (in >> word) out.push_back(std::strtof(word.c_str(), nullptr));
    return out;
}

int main(int argc, char** argv) {
    const std::string path = argc > 1 ? argv[1] : "tests/renderer/data/retained_text_cases.txt";
    std::ifstream file(path);
    if (!file) {
        std::printf("FAIL: cannot open %s\n", path.c_str());
        return 1;
    }
    // The file is checked out with whatever line ending the checkout has; a trailing carriage return is not part of any field.
    const auto next = [&file](std::string& out) {
        const bool got = static_cast<bool>(std::getline(file, out));
        if (got && !out.empty() && out.back() == '\r') out.pop_back();
        return got;
    };
    std::string line;
    int cases = 0, none = 0, all = 0, subset = 0;
    RetainedTextClip scratch;
    while (next(line)) {
        if (line.rfind("case ", 0) != 0) continue;
        std::istringstream header(line);
        std::string word;
        u32 quads = 0;
        int planesOk = 0;
        header >> word >> quads >> planesOk;
        std::string viewLine, modelLine, xyLine, keptLine;
        next(viewLine);
        next(modelLine);
        next(xyLine);
        next(keptLine);
        const std::vector<f32> view = floats(viewLine, 1), model = floats(modelLine, 1), xy = floats(xyLine, 1);
        CHECK(view.size() == 16 && model.size() == 16 && xy.size() == quads * 4 * 2, "a case is well formed");
        if (view.size() != 16 || model.size() != 16 || xy.size() != quads * 4 * 2) continue;

        std::vector<f32> vertices(static_cast<usize>(quads) * RETAINED_TEXT_QUAD_FLOATS, 0.0f);
        std::vector<u16> indices(static_cast<usize>(quads) * 6);
        for (u32 v = 0; v < quads * 4; ++v) {
            vertices[static_cast<usize>(v) * TEXT_VERTEX_FLOATS] = xy[static_cast<usize>(v) * 2];
            vertices[static_cast<usize>(v) * TEXT_VERTEX_FLOATS + 1] = xy[static_cast<usize>(v) * 2 + 1];
        }
        for (u32 q = 0; q < quads; ++q) {
            const u16 b = static_cast<u16>(q * 4);
            const u16 quad[6] = {b, static_cast<u16>(b + 1), static_cast<u16>(b + 2), static_cast<u16>(b + 2), static_cast<u16>(b + 3), b};
            std::copy(quad, quad + 6, indices.begin() + static_cast<usize>(q) * 6);
        }
        RetainedTextStore store;
        store.begin(1, true, false, false, 0, 0.0f, 0.0f);
        CHECK(store.add(1, vertices.data(), static_cast<i32>(quads * 4), indices.data(), static_cast<i32>(quads * 6), 7), "the batch is whole quads");
        const RetainedTextBatch& batch = store.entries().at(1).batches.at(0);

        double planes[36];
        const bool ok = retainedTextClipPlanes(planes, view.data(), model.data());
        CHECK(ok == (planesOk != 0), "the planes exist when the TS planes do");
        const RetainedTextKept kept = retainedTextClip(batch, ok ? planes : nullptr, scratch);

        const std::string expected = keptLine.substr(5);
        if (expected == "none") {
            CHECK(kept == RetainedTextKept::None, "TS kept nothing, so must the engine");
            ++none;
        } else if (expected == "all") {
            CHECK(kept == RetainedTextKept::All, "TS kept every quad, so must the engine");
            ++all;
        } else {
            CHECK(kept == RetainedTextKept::Subset, "TS kept some quads, so must the engine");
            std::vector<u32> want;
            std::istringstream list(expected);
            std::string id;
            while (std::getline(list, id, ',')) want.push_back(static_cast<u32>(std::strtoul(id.c_str(), nullptr, 10)));
            std::vector<u32> got;
            for (u32 q = 0; q < quads; ++q) if (scratch.visible[q]) got.push_back(q);
            CHECK(got == want, "the same quads survive");
            // And what is copied out is those quads, in order, with their indices made to point at the copy.
            CHECK(scratch.vertices.size() == want.size() * RETAINED_TEXT_QUAD_FLOATS && scratch.indices.size() == want.size() * 6, "the copy is the survivors");
            bool copied = scratch.vertices.size() == want.size() * RETAINED_TEXT_QUAD_FLOATS && scratch.indices.size() == want.size() * 6;
            for (usize n = 0; copied && n < want.size(); ++n) {
                for (u32 i = 0; i < RETAINED_TEXT_QUAD_FLOATS; ++i) {
                    copied = copied && scratch.vertices[n * RETAINED_TEXT_QUAD_FLOATS + i] == vertices[static_cast<usize>(want[n]) * RETAINED_TEXT_QUAD_FLOATS + i];
                }
                for (u32 i = 0; i < 6; ++i) {
                    copied = copied && scratch.indices[n * 6 + i] == indices[static_cast<usize>(want[n]) * 6 + i] - want[n] * 4 + n * 4;
                }
            }
            CHECK(copied, "the survivors' vertices and re-based indices are copied whole");
            ++subset;
        }
        ++cases;
    }
    CHECK(cases >= 100, "the cases file has its cases");
    CHECK(none > 0 && all > 0 && subset > 0, "the cases cover nothing, all and some");
    std::printf("%d cases: %d none, %d all, %d some quads kept\n", cases, none, all, subset);
    std::printf(g_failures ? "\n%d check(s) failed\n" : "\nall checks passed\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
