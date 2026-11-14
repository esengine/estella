// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "../renderer/MockGfxDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/renderer/store/MaterialStore.hpp"
#include "esengine/renderer/rhi/Shader.hpp"
#include "esengine/resource/ShaderParser.hpp"
#include "esengine/core/Log.hpp"
#include <cstdio>
using namespace esengine;
static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FAIL: %s\n", m); ++failures; } else std::printf("ok: %s\n", m); } while (0)
static const char* source = R"(#pragma shader "Lifetime"
#pragma version 300 es
#pragma domain Unlit
#pragma fragment
precision mediump float;
in vec4 v_color;
out vec4 fragColor;
void main() { fragColor = v_color; }
#pragma end
)";
int main() {
    // --- A material's revision moves with every change to it, and only then ---
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
        auto shader = rm.createShader("vertex", "fragment", false);
        auto other = rm.createShader("vertex", "fragment", false);
        MaterialUniformLayout layout;
        layout.blockSize = 16;
        layout.params.push_back(MaterialParamSlot{"u_tint", 0, 4});
        MaterialTextureSlot tex;
        tex.name = "u_tex";
        tex.unit = 0;
        layout.textures.push_back(tex);
        store.registerLayout(shader, layout);
        store.registerLayout(other, {});
        CHECK(store.revisionOf(1) == 0, "no material, no revision");
        MaterialRecord record; record.shaderRef = shader; store.define(1, record);
        MaterialRecord second; second.shaderRef = other; store.define(2, second);
        const u64 defined = store.revisionOf(1);
        CHECK(defined != 0 && defined != store.revisionOf(2), "a defined material has a revision of its own");
        store.find(1); store.layoutFor(shader);
        CHECK(store.revisionOf(1) == defined, "reading it changes nothing");
        const f32 tint[4] = {1, 0, 0, 1};
        store.setUniform(1, "u_tint", tint, 4);
        const u64 tinted = store.revisionOf(1);
        CHECK(tinted != defined, "a param moves it");
        store.setUniform(1, "u_missing", tint, 4);
        CHECK(store.revisionOf(1) == tinted, "a param it does not have does not");
        store.setTexture(1, "u_tex", resource::TextureHandle(3));
        const u64 textured = store.revisionOf(1);
        CHECK(textured != tinted, "a texture moves it");
        record.blend = BlendMode::Additive; store.define(1, record);
        const u64 redefined = store.revisionOf(1);
        CHECK(redefined != textured, "its state pushed again moves it");
        const u64 otherBefore = store.revisionOf(2);
        store.registerLayout(shader, layout);
        CHECK(store.revisionOf(1) != redefined, "its shader's layout replaced moves it");
        CHECK(store.revisionOf(2) == otherBefore, "and leaves a material on another shader alone");

        // The store's own revision: whatever any material does, or a material added or removed, and not a read.
        const u64 whole = store.revision();
        CHECK(whole != 0, "the store has a revision");
        store.find(2); store.revisionOf(1);
        CHECK(store.revision() == whole, "reading it changes nothing");
        store.setUniform(1, "u_tint", tint, 4);
        CHECK(store.revision() != whole && store.revision() == store.revisionOf(1), "a material's change moves it, to that revision");
        const u64 changed = store.revision();
        store.setUniform(1, "u_missing", tint, 4);
        CHECK(store.revision() == changed, "a write that changes nothing does not");
        MaterialRecord third; third.shaderRef = other; store.define(3, third);
        CHECK(store.revision() != changed, "a material added moves it");
        const u64 added = store.revision();
        store.undefine(3);
        CHECK(store.revision() != added, "and one removed");
        const u64 removed = store.revision();
        store.undefine(3);
        CHECK(store.revision() == removed, "removing one it does not have does not");
        store.clear();
        CHECK(store.revision() != removed, "and so does clearing it");
        rm.releaseShader(shader); rm.releaseShader(other); rm.shutdown();
    }
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
        auto shader = rm.createShader("vertex", "fragment", false);
        store.registerLayout(shader, {}); store.rememberSource(shader, source, "");
        MaterialRecord record; record.shaderRef = shader; store.define(1, record);
        CHECK(store.meshProgram(1, rm) != 0, "mesh variant compiles");
        CHECK(store.particleProgram(1, rm) != 0, "2D particle variant compiles");
        CHECK(rm.getStats().shaderCount == 3, "base and two variants have real pool ownership");
        rm.releaseShader(shader);
        CHECK(rm.getStats().shaderCount == 0, "final base release also retires both variants");
        CHECK(store.layoutFor(shader) == nullptr, "retired shader layout is gone");
        CHECK(store.builtVariantCount() == 0, "retired shader variant entries are gone");
        store.clear(); rm.shutdown();
    }
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
        auto shader = rm.createShader("vertex", "fragment", false);
        store.rememberSource(shader, source, "");
        MaterialRecord record; record.shaderRef = shader; store.define(1, record);
        const auto program = store.particleProgram(1, rm);
        bool shared = true;
        for (int i = 0; i < 10000; ++i) shared &= store.particleProgram(1, rm) == program;
        CHECK(shared, "10000 warm particle lookups share the program");
        store.clear();
        CHECK(rm.getStats().shaderCount == 1, "clear releases owned variants, not caller-owned base");
        CHECK(store.builtVariantCount() == 0, "clear forgets variant cache");
        store.define(1, record);
        CHECK(store.particleProgram(1, rm) == 0, "clear forgets source rather than rebuilding from retired bytes");
        store.clear(); rm.releaseShader(shader); rm.shutdown();
    }
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
        auto a = rm.createShader("vertex", "fragment", false);
        auto b = rm.createShader("vertex", "fragment", false);
        for (auto shader : {a, b}) { store.registerLayout(shader, {}); store.rememberSource(shader, source, ""); }
        MaterialRecord record; record.shaderRef = a; store.define(1, record); store.define(2, record);
        record.shaderRef = b; store.define(3, record);
        CHECK(store.particleProgram(1, rm) == store.particleProgram(2, rm), "two materials share one source variant");
        const auto other = store.particleProgram(3, rm);
        CHECK(rm.getStats().shaderCount == 4, "two source eras own two variants");
        rm.releaseShader(a);
        CHECK(rm.getStats().shaderCount == 2, "retiring one source releases only its variant");
        CHECK(store.layoutFor(b) != nullptr && store.particleProgram(3, rm) == other, "another source remains usable");
        rm.shutdown();
        CHECK(store.layoutFor(b) == nullptr && store.builtVariantCount() == 0, "pool shutdown retires remaining metadata and variants");
    }
    {
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        auto shader = rm.createShader("vertex", "fragment", false);
        {
            MaterialStore store; store.setDevice(&device); store.setResourceManager(&rm);
            store.rememberSource(shader, source, "");
            MaterialRecord record; record.shaderRef = shader; store.define(1, record);
            store.particleProgram(1, rm);
        }
        CHECK(rm.getStats().shaderCount == 1, "store destruction releases owned variants but preserves external base");
        rm.releaseShader(shader);
        CHECK(rm.getStats().shaderCount == 0, "retirement after store destruction invokes no dead observer");
        rm.shutdown();
    }
    {
        // A variant that does not read one of the material's textures (a depth program) has it optimized out: seeding skips it, and says nothing.
        MockGfxDevice device; resource::ResourceManager rm; rm.init(device);
        device.absentUniforms = {"u_detail"};
        auto handle = rm.createShader("vertex", "fragment", false);
        Shader* shader = rm.getShader(handle);
        const resource::ParsedShader parsed = resource::ShaderParser::parse(
            "#pragma shader \"Seeds\"\n#pragma version 300 es\n#pragma domain Unlit\n"
            "#pragma param u_base texture default(white)\n#pragma param u_detail texture default(white)\n"
            "#pragma fragment\nprecision mediump float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }\n#pragma end\n");
        int notFound = 0;
        const u32 sink = Log::addSink([&](const LogEntry& entry) {
            if (entry.level == LogLevel::Warn && entry.message.find("not found") != std::string::npos) ++notFound;
        });
        const int before = device.setUniform1iCalls;
        CHECK(parsed.valid && shader != nullptr, "a shader with two texture params");
        if (shader) MaterialStore::seedSamplers(*shader, parsed);
        Log::removeSink(sink);
        CHECK(device.setUniform1iCalls == before + 1, "the texture the program reads is seeded");
        CHECK(notFound == 0, "the one it optimized out is skipped without a warning");
        rm.releaseShader(handle); rm.shutdown();
    }
    std::printf("Material shader lifetime: %d failures\n", failures);
    return failures ? 1 : 0;
}
