// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Engine-level backend parity harness (REARCH_WGSL Phase 2) — NOT a
 *        doctest harness.
 *
 * Boots the REAL engine — EstellaContext with every subsystem — on either
 * backend, selected by the page URL (?backend=gl or ?backend=webgpu), and
 * renders one ECS scene through the production path: TransformSystem →
 * RenderFrame begin/collectAll/flush/end. The WebGPU run receives an injected
 * WebGPUDevice with a configured surface; the GL run creates a WebGL2 context —
 * both through the same EstellaContext::init seams the SDK uses.
 *
 * The scene exercises the embedded pipelines that have WGSL twins: sprites
 * (batch, multi-texture: a 2x2 checker + a solid texture) and an SDF shape
 * circle. The electron runner (desktop/scripts/engine-parity.mjs) loads the
 * page once per backend and asserts the SAME pixel expectations on both — the
 * two backends' outputs are each other's gold.
 */
#include "esengine/core/EstellaContext.hpp"
#include "esengine/core/World.hpp"
#include "esengine/ecs/Registry.hpp"
#include "esengine/ecs/TransformSystem.hpp"
#include "esengine/ecs/components/Transform.hpp"
#include "esengine/ecs/components/Sprite.hpp"
#include "esengine/ecs/components/ShapeRenderer.hpp"
#include "esengine/ecs/components/Light2D.hpp"
#include "esengine/renderer/RenderContext.hpp"
#include "esengine/renderer/RenderFrame.hpp"
#include "esengine/renderer/webgpu/WebGPUDevice.hpp"
#include "esengine/resource/ResourceManager.hpp"
#include "esengine/resource/ShaderParser.hpp"

#include <emscripten.h>
#include <emscripten/html5.h>

#include <glm/gtc/matrix_transform.hpp>

#include <cstdio>

using namespace esengine;

namespace {

constexpr u32 kSize = 256;

EstellaContext* g_context = nullptr;
ecs::Registry* g_registry = nullptr;
int g_frames = 0;
f32 g_elapsed = 0.0f;

void renderFrame() {
    auto& ctx = *g_context;
    auto& registry = *g_registry;

    g_elapsed += 1.0f / 60.0f;
    ctx.require<RenderContext>().setFrameTime(g_elapsed, kSize, kSize);

    World world{registry, ctx.services(), 1.0f / 60.0f};
    ctx.require<ecs::TransformSystem>().update(world);

    // World units are pixels, y up — the same ortho the SDK's default camera
    // derives for a 256x256 view centered on (128,128).
    const glm::mat4 viewProjection =
        glm::ortho(0.0f, static_cast<f32>(kSize), 0.0f, static_cast<f32>(kSize));

    auto& renderFrame = ctx.require<RenderFrame>();
    renderFrame.begin(viewProjection, 0,
                      RenderFrame::PassClear{true, true, glm::vec4(0.05f, 0.05f, 0.30f, 1.0f)});
    renderFrame.collectAll(registry);
    renderFrame.flush();
    renderFrame.end();

    if (++g_frames == 3) {
        std::printf("PARITY_FRAMES_OK\n");
        emscripten_cancel_main_loop();
    }
}

// Dual-emission compile probe (REARCH_WGSL Phase 3): ONE ParsedShader —
// Lit2D domain + block params + a texture param + a feature — assembled and
// compiled in each backend's language. It exercises every WGSL injection the
// emitter owns (canonical vertex, VSOut, batch texture contract, Time/
// Material constants, material texture bindings, the Lit2D header, and the
// assembly-time feature preprocessor) plus the language constructs the SDK's
// template/filter twins rely on (sampleNormal, textureDimensions, nested
// loops with continue, select) against the REAL compiler: a WGSL error
// surfaces as a device validation error (the runner counts those); a GLSL
// error fails shader creation here.
const char* kEmitterProbe = R"(#pragma shader "EmitterProbe"
#pragma version 300 es
#pragma domain Lit2D
#pragma feature GLOW
#pragma param u_progress float default(0.5)
#pragma param u_tint color default(1,1,1,1)
#pragma param u_mask texture default(white)

#pragma fragment
precision mediump float;
in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
uniform sampler2D u_textures[8];
out vec4 fragColor;
void main() {
    vec4 c = texture(u_textures[0], v_texCoord) * v_color * u_tint;
    vec3 N = sampleNormal(u_mask, v_texCoord);
    highp vec2 texel = 1.0 / vec2(textureSize(u_textures[0], 0));
    float acc = 0.0;
    for (float x = -1.0; x <= 1.0; x += 1.0) {
        for (float y = -1.0; y <= 1.0; y += 1.0) {
            if (x == 0.0 && y == 0.0) continue;
            acc = max(acc, texture(u_textures[0], v_texCoord + vec2(x, y) * texel).a);
        }
    }
    vec3 litRgb = applyLighting2D(c.rgb, N, v_worldPos);
    vec3 edged = (acc > 1.5) ? u_tint.rgb : litRgb;
    vec2 sp = gl_FragCoord.xy * u_viewport.zw;
    vec3 graded = clamp(edged + sp.x * 0.0, 0.0, 1.0);
#ifdef GLOW
    fragColor = vec4(graded * u_progress, c.a);
#else
    fragColor = vec4(graded, c.a);
#endif
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    var c = textureSampleLevel(t0, s0, v.v_texCoord, 0.0) * v.v_color * mc.u_tint;
    let N = sampleNormal(u_mask, u_mask_s, v.v_texCoord);
    let texel = 1.0 / vec2f(textureDimensions(t0, 0));
    var acc = 0.0;
    for (var x = -1.0; x <= 1.0; x += 1.0) {
        for (var y = -1.0; y <= 1.0; y += 1.0) {
            if (x == 0.0 && y == 0.0) { continue; }
            acc = max(acc, textureSampleLevel(t0, s0, v.v_texCoord + vec2f(x, y) * texel, 0.0).a);
        }
    }
    let litRgb = applyLighting2D(c.rgb, N, v.v_worldPos);
    let edged = select(litRgb, mc.u_tint.rgb, acc > 1.5);
    let sp = vec2f(v.pos.x, tc.u_viewport.y - v.pos.y) * tc.u_viewport.zw;
    let graded = saturate(edged + sp.x * 0.0);
#ifdef GLOW
    return vec4f(graded * mc.u_progress, c.a);
#else
    return vec4f(graded, c.a);
#endif
}
#pragma end
)";

// A PostProcess-domain probe: the canonical fullscreen vertex, the loose
// engine samplers (u_texture/u_sceneTexture on GLSL; the t0/s0 + t1/s1 pairs
// in the twin), a reflected param, a LUT-style texture param, and the injected
// u_viewport standing in for the old per-pass resolution.
const char* kEmitterProbePP = R"(#pragma shader "EmitterProbePP"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_intensity float default(1)
#pragma param u_lut texture default(white)

#pragma fragment
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform sampler2D u_sceneTexture;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_texture, v_texCoord + u_viewport.zw);
    vec4 scene = texture(u_sceneTexture, v_texCoord);
    vec4 lut = texture(u_lut, v_texCoord);
    fragColor = mix(scene, c * lut, u_intensity);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let c = textureSampleLevel(t0, s0, v.v_texCoord + tc.u_viewport.zw, 0.0);
    let scene = textureSampleLevel(t1, s1, v.v_texCoord, 0.0);
    let lut = textureSampleLevel(u_lut, u_lut_s, v.v_texCoord, 0.0);
    return mix(scene, c * lut, mc.u_intensity);
}
#pragma end
)";

bool compileEmitterProbe(EstellaContext& ctx, bool useGL) {
    using resource::ShaderParser;
    using resource::ShaderStage;
    using resource::ShaderTargetLanguage;

    auto& rm = ctx.require<resource::ResourceManager>();
    const auto target = useGL ? ShaderTargetLanguage::GLSL_ES300 : ShaderTargetLanguage::WGSL;
    const auto language = useGL ? GfxShaderLanguage::GLSL_ES300 : GfxShaderLanguage::WGSL;

    for (const char* source : {kEmitterProbe, kEmitterProbePP}) {
        resource::ParsedShader parsed = ShaderParser::parse(source);
        if (!parsed.valid) {
            std::printf("PARITY_FAIL emitter probe parse: %s\n", parsed.errorMessage.c_str());
            return false;
        }
        const std::string vs = ShaderParser::assembleStage(parsed, ShaderStage::Vertex, "", {"GLOW"}, target);
        const std::string fs = ShaderParser::assembleStage(parsed, ShaderStage::Fragment, "", {"GLOW"}, target);
        if (vs.empty() || fs.empty()) {
            std::printf("PARITY_FAIL emitter probe assembly (%s)\n", parsed.name.c_str());
            return false;
        }
        const auto handle = rm.createShader(vs, fs, /*rewriteLoose=*/false, language);
        if (!handle.isValid()) {
            std::printf("PARITY_FAIL emitter probe compile (%s)\n", parsed.name.c_str());
            return false;
        }
        rm.releaseShader(handle);
    }
    return true;
}

bool buildScene(EstellaContext& ctx, ecs::Registry& registry) {
    auto& rm = ctx.require<resource::ResourceManager>();

    // 2x2 red/blue checker; asserted at texel centers, so the expectation is
    // filter-independent and purely about UV orientation parity.
    const u8 checker[16] = {
        255, 0, 0, 255,   0, 0, 255, 255,   // row 0: red, blue
        0, 0, 255, 255,   255, 0, 0, 255,   // row 1: blue, red
    };
    auto checkerTex = rm.createTexture(2, 2, ConstSpan<u8>(checker, sizeof(checker)),
                                       TextureFormat::RGBA8);
    const u8 green[4] = {0, 255, 0, 255};
    auto greenTex = rm.createTexture(1, 1, ConstSpan<u8>(green, sizeof(green)),
                                     TextureFormat::RGBA8);
    if (!checkerTex.isValid() || !greenTex.isValid()) return false;

    // Sprite A: the checker, left-top area (world center 64,176, size 64).
    {
        auto e = registry.create();
        auto& t = registry.emplace<ecs::Transform>(e);
        t.position = {64.0f, 176.0f, 0.0f};
        auto& s = registry.emplace<ecs::Sprite>(e);
        s.texture = checkerTex;
        s.size = {64.0f, 64.0f};
    }

    // Sprite B: solid green (world center 192,176, size 48).
    {
        auto e = registry.create();
        auto& t = registry.emplace<ecs::Transform>(e);
        t.position = {192.0f, 176.0f, 0.0f};
        auto& s = registry.emplace<ecs::Sprite>(e);
        s.texture = greenTex;
        s.size = {48.0f, 48.0f};
    }

    // Shape: a magenta SDF circle, bottom-center (world center 128,80, size 64).
    {
        auto e = registry.create();
        auto& t = registry.emplace<ecs::Transform>(e);
        t.position = {128.0f, 80.0f, 0.0f};
        auto& s = registry.emplace<ecs::ShapeRenderer>(e);
        s.shapeType = 0;  // circle
        s.color = {1.0f, 0.0f, 1.0f, 1.0f};
        s.size = {64.0f, 64.0f};
    }

    // Lit sprite: white, bottom-left (world center 64,80, size 48) — drives
    // the batch LIT variant through the production path. Lighting is pinned by
    // the two explicit lights below: white * (0.2 ambient + red point) ≈
    // (255, 51, 51) at the sprite center on BOTH backends.
    const u8 white[4] = {255, 255, 255, 255};
    auto whiteTex = rm.createTexture(1, 1, ConstSpan<u8>(white, sizeof(white)),
                                     TextureFormat::RGBA8);
    if (!whiteTex.isValid()) return false;
    {
        auto e = registry.create();
        auto& t = registry.emplace<ecs::Transform>(e);
        t.position = {64.0f, 80.0f, 0.0f};
        auto& s = registry.emplace<ecs::Sprite>(e);
        s.texture = whiteTex;
        s.size = {48.0f, 48.0f};
        s.lit = true;
    }
    {
        auto e = registry.create();
        auto& t = registry.emplace<ecs::Transform>(e);
        t.position = {64.0f, 80.0f, 0.0f};  // centered on the lit sprite: ndotl = 1, atten = 1
        auto& l = registry.emplace<ecs::Light2D>(e);
        l.type = static_cast<i32>(ecs::Light2DType::Point);
        l.color = {1.0f, 0.0f, 0.0f, 1.0f};
        l.intensity = 1.0f;
        l.radius = 200.0f;
    }
    {
        auto e = registry.create();
        registry.emplace<ecs::Transform>(e);
        auto& l = registry.emplace<ecs::Light2D>(e);
        l.type = static_cast<i32>(ecs::Light2DType::Ambient);
        l.color = {1.0f, 1.0f, 1.0f, 1.0f};
        l.intensity = 0.2f;
    }
    return true;
}

}  // namespace

int main() {
    const bool useGL =
        EM_ASM_INT({ return location.search.indexOf('backend=gl') >= 0 ? 1 : 0; }) != 0;

    static EstellaContext context;
    g_context = &context;
    context.state().viewport_width = kSize;
    context.state().viewport_height = kSize;

    if (useGL) {
        EmscriptenWebGLContextAttributes attrs;
        emscripten_webgl_init_context_attributes(&attrs);
        attrs.majorVersion = 2;
        attrs.minorVersion = 0;
        attrs.alpha = false;
        attrs.depth = true;
        attrs.stencil = true;
        attrs.antialias = false;
        const auto handle = emscripten_webgl_create_context("#canvas", &attrs);
        if (handle <= 0) {
            std::printf("PARITY_FAIL webgl context\n");
            return 1;
        }
        if (!context.init(static_cast<int>(handle))) {
            std::printf("PARITY_FAIL gl init\n");
            return 1;
        }
        std::printf("PARITY_BACKEND gl\n");
    } else {
        WGPUDevice raw = emscripten_webgpu_get_device();
        if (!raw) {
            std::printf("PARITY_FAIL no preinitialized device\n");
            return 1;
        }
        auto device = makeUnique<WebGPUDevice>(raw);
        if (!device->configureSurface("#canvas", kSize, kSize)) {
            std::printf("PARITY_FAIL surface\n");
            return 1;
        }
        if (!context.init(std::move(device))) {
            std::printf("PARITY_FAIL webgpu init\n");
            return 1;
        }
        std::printf("PARITY_BACKEND webgpu\n");
    }

    static ecs::Registry registry;
    g_registry = &registry;
    if (!buildScene(context, registry)) {
        std::printf("PARITY_FAIL scene\n");
        return 1;
    }
    if (!compileEmitterProbe(context, useGL)) {
        return 1;
    }
    // The batch feature variants compile in both languages now (SDF has no
    // scene here — a text glyph atlas is out of scope — but a bad module
    // surfaces as a validation error the runner counts; LIT also renders via
    // the lit sprite above).
    auto& rf = context.require<RenderFrame>();
    if (rf.batchProgram({"SDF"}) == 0 || rf.batchProgram({"LIT"}) == 0) {
        std::printf("PARITY_FAIL batch variants\n");
        return 1;
    }

    std::printf("PARITY_INIT_OK\n");
    emscripten_set_main_loop(renderFrame, 0, /*simulate_infinite_loop=*/false);
    return 0;
}
