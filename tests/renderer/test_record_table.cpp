// The device's record tables: a record is found by its id at once, ids are never reused, a record a caller holds stays
// where it is while others are added, iteration walks the live records in creation order (as the map it replaced did),
// and a pipeline description names one pipeline however many times it is asked for.

#include "esengine/renderer/rhi/GfxResourceRegistry.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

struct Thing { int value = 0; };

int main() {
    {
        GfxRecordTable<Thing> table;
        const u32 a = table.insert({1});
        const u32 b = table.insert({2});
        const u32 c = table.insert({3});
        CHECK(a == 1 && b == 2 && c == 3, "ids are handed out in order from 1");
        CHECK(table.find(b) && table.find(b)->value == 2, "a record is found by its id");
        CHECK(table.find(0) == nullptr && table.find(4) == nullptr, "no id and an id not yet handed out find nothing");
        CHECK(table.size() == 3, "size counts the records");

        Thing* held = table.find(a);
        for (int i = 0; i < 5000; ++i) table.insert({100 + i});
        CHECK(held == table.find(a) && held->value == 1, "a record a caller holds stays where it is while thousands are added");

        CHECK(table.erase(b), "a record can be erased");
        CHECK(!table.erase(b), "and not twice");
        CHECK(table.find(b) == nullptr, "an erased record is not found");
        const u32 d = table.insert({4});
        CHECK(d == 5004, "an erased id is not handed out again");
        CHECK(table.size() == 5003, "size counts only the live records");

        std::vector<u32> ids;
        for (auto& [id, record] : table.all()) {
            ids.push_back(id);
            record.value += 0;  // a mutable reference, as over the map
        }
        bool ordered = ids.size() == 5003;
        for (size_t i = 1; i < ids.size(); ++i) ordered = ordered && ids[i - 1] < ids[i];
        CHECK(ordered && ids.front() == 1 && ids[1] == 3, "iteration walks the live records in creation order, past the erased");

        for (auto& [id, record] : table.all()) if (id == c) record.value = 30;
        CHECK(table.find(c)->value == 30, "a record changed through iteration is changed");

        const GfxRecordTable<Thing>& constant = table;
        int sum = 0;
        for (const auto& [id, record] : constant.all()) if (id <= 3) sum += record.value;
        CHECK(sum == 31, "a const table iterates too");
    }

    {
        GfxResourceRegistry registry;
        PipelineDesc desc{};
        desc.program = ShaderHandle{7};
        desc.vertexLayout = VertexLayoutHandle{3};
        desc.depthTest = true;
        const u32 first = registry.internPipeline(desc);
        CHECK(first != 0, "a pipeline is made for a description");
        CHECK(registry.internPipeline(desc) == first, "the same description names the same pipeline");
        CHECK(registry.findPipeline(desc) == first, "and is found without making another");

        PipelineDesc other = desc;
        other.cullFront = true;
        const u32 second = registry.internPipeline(other);
        CHECK(second != first, "a description that differs in one field is another pipeline");
        other = desc;
        other.depthBias = -2;
        CHECK(registry.internPipeline(other) != first && registry.internPipeline(other) != second, "and so is one with another depth bias");
        CHECK(registry.pipelines.size() == 3, "three descriptions, three pipelines, however often asked");
        CHECK(registry.pipelines.find(first)->desc == desc, "a pipeline holds the description it was made for");

        PipelineDesc unknown = desc;
        unknown.program = ShaderHandle{99};
        CHECK(registry.findPipeline(unknown) == 0, "a description never asked for finds nothing");

        // Many pipelines, as a scene of many materials makes: each still found by its own description.
        bool all = true;
        for (u32 p = 100; p < 2100; ++p) {
            PipelineDesc many = desc;
            many.program = ShaderHandle{p};
            const u32 id = registry.internPipeline(many);
            all = all && registry.findPipeline(many) == id;
        }
        CHECK(all, "two thousand pipelines are each found by their description");
    }

    std::printf("\n%s (%d failure%s)\n", g_failures ? "FAILED" : "PASSED", g_failures, g_failures == 1 ? "" : "s");
    return g_failures ? 1 : 0;
}
