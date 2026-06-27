// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebSDKEntry.cpp
 * @brief   ESEngine Web SDK entry point with rendering support
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */


#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/html5.h>

#include "EngineContext.hpp"
#include "ActiveContext.hpp"
#include "ResourceManagerBindings.hpp"
#include "RendererBindings.hpp"
#include "ImmediateDrawBindings.hpp"
#include "GeometryBindings.hpp"
#ifdef ES_ENABLE_POSTPROCESS
#include "PostProcessBindings.hpp"
#endif

#include "../ecs/UILayoutSystem.hpp"
#include "../ecs/UIHitTestSystem.hpp"
#include "../ecs/UIRenderOrderSystem.hpp"
#include "../ecs/UISystem.hpp"

#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/GfxDevice.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../resource/ShaderParser.hpp"
#include "../text/SdfGenerator.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../core/World.hpp"
#include "../ecs/components/Velocity.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../ecs/components/RigidBody.hpp"
#include "../ecs/components/Collider.hpp"
#include "../ecs/components/ShapeRenderer.hpp"
#include "../animation/TweenSystem.hpp"
#ifdef ES_ENABLE_PARTICLES
#include "../particle/ParticleSystem.hpp"
#endif
#include "../core/Log.hpp"

#include <glm/glm.hpp>
#include <cstring>
#include <cstddef>

static_assert(sizeof(void*) == 4, "EM_JS pointer passing assumes wasm32 (4-byte pointers)");

namespace esengine {

static EngineContext& legacyCtx() { return EngineContext::instance(); }
// Single source of truth for the active context lives in activeCtx()
// (ActiveContext.hpp), which now carries the headless fallback uniformly — so
// this is just the file-local short alias, identical to every other binding's.
static EstellaContext& ctx() { return activeCtx(); }

#define g_initialized (ctx().state().initialized)
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())
#define g_renderContext (ctx().tryGet<RenderContext>())
#ifdef ES_ENABLE_PARTICLES
#define g_particleSystem (ctx().tryGet<particle::ParticleSystem>())
#endif

// Float component count for a std140 param type (textures have no block slot).
static u32 materialParamArity(resource::ShaderPropertyType t) {
    using PT = resource::ShaderPropertyType;
    switch (t) {
        case PT::Float: case PT::Int: return 1;
        case PT::Vec2: return 2;
        case PT::Vec3: return 3;
        case PT::Vec4: case PT::Color: return 4;
        default: return 0;
    }
}

// Build the engine-side layout from a parsed shader's #pragma param reflection: non-texture
// params into the std140 block (declared order == offset order), texture params into sampler
// slots (their reflected units, >= MATERIAL_TEXTURE_UNIT_BASE).
static MaterialUniformLayout buildMaterialLayout(const resource::ParsedShader& parsed,
                                                 const RenderContext& rc) {
    MaterialUniformLayout layout;
    layout.blockSize = parsed.materialBlockSize;
    for (const auto& p : parsed.properties) {
        if (!p.fromParam) continue;
        if (p.type == resource::ShaderPropertyType::Texture) {
            if (p.textureUnit >= 0) {
                // Resolve the param's `default(<name>)` to a built-in default texture, bound when
                // a material leaves the param unset.
                layout.textures.push_back({ p.name, static_cast<u32>(p.textureUnit),
                                            rc.defaultTextureByName(p.defaultValue) });
            }
        } else if (p.std140Offset >= 0) {
            layout.params.push_back({ p.name, static_cast<u32>(p.std140Offset), materialParamArity(p.type) });
        }
    }
    return layout;
}

// Compiles a .esshader (material shader) through the full ShaderParser path — assembling the
// auto-generated MaterialConstants block + the requested feature/switch permutation (each
// feature -> `#define NAME 1`) — and registers its param layout. @p featuresCsv is the enabled
// `#pragma switch` set (comma-separated), so a material's static switches select a permutation;
// the SDK loader caches one compiled program per (shader, switch-set). Returns the shader
// resource handle (0 on failure). Reflection-aware replacement for the loader's old regex.
u32 compileEsshader(const std::string& source, const std::string& featuresCsv) {
    auto* rm = g_resourceManager;
    if (!rm) return 0;
    resource::ParsedShader parsed = resource::ShaderParser::parse(source);
    if (!parsed.valid) {
        ES_LOG_ERROR("compileEsshader: parse failed: {}", parsed.errorMessage);
        return 0;
    }
    std::vector<std::string> features;
    for (usize start = 0; start <= featuresCsv.size();) {
        const usize comma = featuresCsv.find(',', start);
        const usize end = comma == std::string::npos ? featuresCsv.size() : comma;
        std::string f = featuresCsv.substr(start, end - start);
        // trim
        const usize a = f.find_first_not_of(" \t");
        const usize b = f.find_last_not_of(" \t");
        if (a != std::string::npos) features.push_back(f.substr(a, b - a + 1));
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    const std::string vert = resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features);
    const std::string frag = resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features);
    resource::ShaderHandle handle = rm->createShader(vert, frag);
    if (!handle.isValid()) return 0;
    if (auto* rc = g_renderContext) {
        if (Shader* s = rm->getShader(handle)) {
            rc->materials().registerLayout(s->getProgramId(), buildMaterialLayout(parsed, *rc));
            // Point each texture param's sampler at its unit, once per program (GLSL ES 300 has
            // no layout(binding=); mirrors the batch path's u_textures setup in RenderFrame).
            s->bind();
            for (const auto& p : parsed.properties) {
                if (p.fromParam && p.type == resource::ShaderPropertyType::Texture && p.textureUnit >= 0) {
                    s->setUniform(p.name, static_cast<i32>(p.textureUnit));
                }
            }
            s->unbind();
        }
    }
    return handle.id();
}

// Materials are engine-side data: the SDK pushes a material's resolved render state here when
// it is created or edited, and the render path reads it by the handle a component carries
// (Sprite::material, etc.). `shaderHandle` is the SDK shader resource handle, translated here
// to the GL program id the render path binds. flags packs depthTest (bit 0), depthWrite
// (bit 1) and CullMode (bits 2-3). Per-material uniform values arrive via setMaterialUniform.
void defineMaterial(u32 materialId, u32 shaderHandle, u32 blendMode, u32 flags) {
    auto* rc = g_renderContext;
    if (!rc) return;
    u32 programId = 0;
    if (shaderHandle != 0) {
        if (auto* rm = g_resourceManager) {
            if (Shader* s = rm->getShader(resource::ShaderHandle(shaderHandle))) {
                programId = s->getProgramId();
            }
        }
    }
    MaterialRecord rec;
    rec.shader = programId;
    rec.blend = static_cast<BlendMode>(blendMode);
    rec.depthTest = (flags & 0x1u) != 0;
    rec.depthWrite = (flags & 0x2u) != 0;
    rec.cull = static_cast<CullMode>((flags >> 2) & 0x3u);
    rc->materials().define(materialId, rec);
}

// Packs a named param's float components into the material's std140 buffer (by reflected
// offset). A no-op for materials whose shader declares no matching #pragma param.
void setMaterialUniform(u32 materialId, const std::string& name, u32 arity,
                        f32 v0, f32 v1, f32 v2, f32 v3) {
    auto* rc = g_renderContext;
    if (!rc) return;
    const f32 vals[4] = { v0, v1, v2, v3 };
    rc->materials().setUniform(materialId, name, vals, arity);
}

// Binds a texture param to its sampler unit. `textureHandle` is the SDK texture resource
// handle, resolved here to the GL texture id the render path binds. No-op for an unknown param.
void setMaterialTexture(u32 materialId, const std::string& name, u32 textureHandle) {
    auto* rc = g_renderContext;
    if (!rc) return;
    u32 glTex = 0;
    if (textureHandle != 0) {
        if (auto* rm = g_resourceManager) {
            if (Texture* t = rm->getTexture(resource::TextureHandle(textureHandle))) {
                glTex = t->getId();
            }
        }
    }
    rc->materials().setTexture(materialId, name, glTex);
}

void undefineMaterial(u32 materialId) {
    if (auto* rc = g_renderContext) rc->materials().undefine(materialId);
}

bool initRendererInternal(const char* canvasSelector) {
    if (g_initialized) return true;

    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.alpha = true;
    attrs.depth = true;
    attrs.stencil = true;
    attrs.antialias = true;
    attrs.premultipliedAlpha = true;
    attrs.preserveDrawingBuffer = false;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_DEFAULT;
    attrs.failIfMajorPerformanceCaveat = false;

    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE webglCtx = emscripten_webgl_create_context(canvasSelector, &attrs);
    if (webglCtx <= 0) {
        ES_LOG_ERROR("Failed to create WebGL2 context for '{}': {}", canvasSelector, webglCtx);
        return false;
    }

    ES_LOG_INFO("WebGL2 context created for '{}'", canvasSelector);

    // Build provenance signature — kept self-contained (not via the umbrella
    // header) so the literal is guaranteed to land in this translation unit and
    // survive in the shipped binary. Emitted once at init as an origin marker.
    static constexpr const char* kEstellaBuildProvenance =
        "estella-build:9abbd5b4-06f3-47df-b968-826763c6879a";
    ES_LOG_INFO("Estella runtime provenance {}", kEstellaBuildProvenance);

    g_activeContext = &legacyCtx().context();
    return g_activeContext->init(static_cast<int>(webglCtx));
}

void initRenderer() {
    initRendererInternal("#canvas");
}

bool initRendererWithCanvas(const std::string& canvasSelector) {
    return initRendererInternal(canvasSelector.c_str());
}

bool initRendererWithContext(int contextHandle) {
    if (g_initialized) return true;
    if (contextHandle <= 0) {
        ES_LOG_ERROR("Invalid WebGL context handle: {}", contextHandle);
        return false;
    }

    g_activeContext = &legacyCtx().context();
    return g_activeContext->init(contextHandle);
}

void shutdownRenderer() {
    if (g_activeContext) {
        g_activeContext->shutdown();
        g_activeContext = nullptr;
    }
}

resource::ResourceManager* getResourceManager() {
    return g_resourceManager;
}

// Runtime glyph atlas: convert a Canvas2D-rasterized alpha
// bitmap to a signed distance field. Both buffers are caller-allocated in WASM
// linear memory (TS passes HEAPU8 pointers); `alpha` and `out` are width*height.
void web_sdfFromAlpha(uintptr_t alphaPtr, uintptr_t outPtr, u32 width, u32 height, f32 spread) {
    const u8* alpha = reinterpret_cast<const u8*>(alphaPtr);
    u8* out = reinterpret_cast<u8*>(outPtr);
    text::sdfFromAlpha(alpha, out, width, height, spread);
}

// =============================================================================
// Pointer-based Component Access
// =============================================================================

// NOTE: Per-field component layout offsets are asserted for ALL components in
// WebBindings.generated.cpp (generated by EHT's PtrLayoutGenerator), which is
// the single source of truth for the pointer ABI. Do not hand-maintain
// static_assert(offsetof(...)) here — they drifted and only covered 8 of N
// components.

int getTransformPtr(ecs::Registry& r, u32 e) {
    auto* t = r.tryGet<ecs::Transform>(Entity::fromRaw(e));
    if (!t) return 0;
    t->ensureDecomposed();
    return static_cast<int>(reinterpret_cast<uintptr_t>(t));
}

int getSpritePtr(ecs::Registry& r, u32 e) {
    auto* s = r.tryGet<ecs::Sprite>(Entity::fromRaw(e));
    if (!s) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(s));
}

int getVelocityPtr(ecs::Registry& r, u32 e) {
    auto* v = r.tryGet<ecs::Velocity>(Entity::fromRaw(e));
    if (!v) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(v));
}

int getCameraPtr(ecs::Registry& r, u32 e) {
    auto* c = r.tryGet<ecs::Camera>(Entity::fromRaw(e));
    if (!c) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(c));
}

int getRigidBodyPtr(ecs::Registry& r, u32 e) {
    auto* rb = r.tryGet<ecs::RigidBody>(Entity::fromRaw(e));
    if (!rb) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(rb));
}

int getBoxColliderPtr(ecs::Registry& r, u32 e) {
    auto* bc = r.tryGet<ecs::BoxCollider>(Entity::fromRaw(e));
    if (!bc) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(bc));
}

int getCircleColliderPtr(ecs::Registry& r, u32 e) {
    auto* cc = r.tryGet<ecs::CircleCollider>(Entity::fromRaw(e));
    if (!cc) return 0;
    return static_cast<int>(reinterpret_cast<uintptr_t>(cc));
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_ptr_access) {
    emscripten::function("getTransformPtr", &esengine::getTransformPtr);
    emscripten::function("getSpritePtr", &esengine::getSpritePtr);
    emscripten::function("getVelocityPtr", &esengine::getVelocityPtr);
    emscripten::function("getCameraPtr", &esengine::getCameraPtr);
    emscripten::function("getRigidBodyPtr", &esengine::getRigidBodyPtr);
    emscripten::function("getBoxColliderPtr", &esengine::getBoxColliderPtr);
    emscripten::function("getCircleColliderPtr", &esengine::getCircleColliderPtr);
}

// Engine instancing: expose EstellaContext as
// a JS-newable instance + an explicit active-context setter, so the editor can
// own / create / destroy isolated engine contexts rather than every App being
// hard-bound to the process singleton (EngineContext::instance()). PURE ADDITION
// — the existing initRenderer paths are untouched until N3 routes through these.
// JS owns the instance (new module.EstellaContext() ... ctx.delete()), exactly
// like new module.Registry().
EMSCRIPTEN_BINDINGS(esengine_context) {
    emscripten::class_<esengine::EstellaContext>("EstellaContext")
        .constructor<>()
        .function("init", &esengine::EstellaContext::init)
        .function("shutdown", &esengine::EstellaContext::shutdown)
        .function("isInitialized", &esengine::EstellaContext::isInitialized);
    // Pointer (not reference) so JS can pass null to clear the active context.
    emscripten::function(
        "setActiveContext",
        +[](esengine::EstellaContext* c) { esengine::g_activeContext = c; },
        emscripten::allow_raw_pointers());
}

EMSCRIPTEN_BINDINGS(esengine_renderer) {
    emscripten::function("initRenderer", &esengine::initRenderer);
    emscripten::function("initRendererWithCanvas", &esengine::initRendererWithCanvas);
    emscripten::function("initRendererWithContext", &esengine::initRendererWithContext);
    emscripten::function("shutdownRenderer", &esengine::shutdownRenderer);
    emscripten::function("renderFrame", &esengine::renderFrame);
    emscripten::function("renderFrameWithMatrix", &esengine::renderFrameWithMatrix);
    emscripten::function("getResourceManager", &esengine::getResourceManager, emscripten::allow_raw_pointers());
    emscripten::function("sdfFromAlpha", &esengine::web_sdfFromAlpha);

    emscripten::class_<esengine::resource::ResourceManager>("ResourceManager")
        .function("createTexture", &esengine::rm_createTexture)
        .function("createTextureEx", &esengine::rm_createTextureEx)
        .function("createShader", &esengine::rm_createShader)
        .function("registerExternalTexture", &esengine::rm_registerExternalTexture)
        .function("releaseTexture", &esengine::rm_releaseTexture)
        .function("getTextureRefCount", &esengine::rm_getTextureRefCount)
        .function("releaseShader", &esengine::rm_releaseShader)
        .function("getShaderRefCount", &esengine::rm_getShaderRefCount)
        .function("getTextureGLId", &esengine::rm_getTextureGLId)
        .function("getTextureDimensions", &esengine::rm_getTextureDimensions)
        .function("setTextureMetadata", &esengine::rm_setTextureMetadata)
        .function("updateTextureSubregion", &esengine::rm_updateTextureSubregion)
        .function("registerTextureWithPath", &esengine::rm_registerTextureWithPath)
#ifdef ES_ENABLE_BITMAP_TEXT
        .function("loadBitmapFont", &esengine::rm_loadBitmapFont)
        .function("createLabelAtlasFont", &esengine::rm_createLabelAtlasFont)
        .function("releaseBitmapFont", &esengine::rm_releaseBitmapFont)
        .function("getBitmapFontRefCount", &esengine::rm_getBitmapFontRefCount)
        .function("measureBitmapText", &esengine::rm_measureBitmapText)
#endif
        ;

#ifdef ES_ENABLE_SPINE
    // Spine renders via the side modules — only the mesh-submit bindings the
    // SDK SpineManager calls remain. Native spine_* / spine_native_* are gone.
    emscripten::function("renderer_submitSpineBatch", &esengine::renderer_submitSpineBatch);
    emscripten::function("renderer_submitSpineBatchByEntity", &esengine::renderer_submitSpineBatchByEntity);
#endif
    emscripten::function("renderer_submitTextBatch", &esengine::renderer_submitTextBatch);

    emscripten::function("compileEsshader", &esengine::compileEsshader);
    emscripten::function("defineMaterial", &esengine::defineMaterial);
    emscripten::function("setMaterialUniform", &esengine::setMaterialUniform);
    emscripten::function("setMaterialTexture", &esengine::setMaterialTexture);
    emscripten::function("undefineMaterial", &esengine::undefineMaterial);

    emscripten::function("draw_begin", &esengine::draw_begin);
    emscripten::function("draw_end", &esengine::draw_end);
    emscripten::function("draw_line", &esengine::draw_line);
    emscripten::function("draw_rect", &esengine::draw_rect);
    emscripten::function("draw_rectOutline", &esengine::draw_rectOutline);
    emscripten::function("draw_circle", &esengine::draw_circle);
    emscripten::function("draw_circleOutline", &esengine::draw_circleOutline);
    emscripten::function("draw_texture", &esengine::draw_texture);
    emscripten::function("draw_textureRotated", &esengine::draw_textureRotated);
    emscripten::function("draw_setLayer", &esengine::draw_setLayer);
    emscripten::function("draw_setDepth", &esengine::draw_setDepth);
    emscripten::function("draw_getDrawCallCount", &esengine::draw_getDrawCallCount);
    emscripten::function("draw_getPrimitiveCount", &esengine::draw_getPrimitiveCount);
    emscripten::function("draw_setBlendMode", &esengine::draw_setBlendMode);
    emscripten::function("draw_setDepthTest", &esengine::draw_setDepthTest);
    emscripten::function("draw_mesh", &esengine::draw_mesh);
    emscripten::function("draw_meshWithUniforms", &esengine::draw_meshWithUniforms);

    emscripten::function("geometry_create", &esengine::geometry_create);
    emscripten::function("geometry_init", &esengine::geometry_init);
    emscripten::function("geometry_setIndices16", &esengine::geometry_setIndices16);
    emscripten::function("geometry_setIndices32", &esengine::geometry_setIndices32);
    emscripten::function("geometry_updateVertices", &esengine::geometry_updateVertices);
    emscripten::function("geometry_release", &esengine::geometry_release);
    emscripten::function("geometry_isValid", &esengine::geometry_isValid);

#ifdef ES_ENABLE_POSTPROCESS
    emscripten::function("postprocess_init", &esengine::postprocess_init);
    emscripten::function("postprocess_shutdown", &esengine::postprocess_shutdown);
    emscripten::function("postprocess_resize", &esengine::postprocess_resize);
    emscripten::function("postprocess_addPass", &esengine::postprocess_addPass);
    emscripten::function("postprocess_removePass", &esengine::postprocess_removePass);
    emscripten::function("postprocess_setPassEnabled", &esengine::postprocess_setPassEnabled);
    emscripten::function("postprocess_isPassEnabled", &esengine::postprocess_isPassEnabled);
    emscripten::function("postprocess_setUniformFloat", &esengine::postprocess_setUniformFloat);
    emscripten::function("postprocess_setUniformVec4", &esengine::postprocess_setUniformVec4);
    emscripten::function("postprocess_begin", &esengine::postprocess_begin);
    emscripten::function("postprocess_end", &esengine::postprocess_end);
    emscripten::function("postprocess_getPassCount", &esengine::postprocess_getPassCount);
    emscripten::function("postprocess_isInitialized", &esengine::postprocess_isInitialized);
    emscripten::function("postprocess_setBypass", &esengine::postprocess_setBypass);
    emscripten::function("postprocess_isBypassed", &esengine::postprocess_isBypassed);
    emscripten::function("postprocess_clearPasses", &esengine::postprocess_clearPasses);
    emscripten::function("postprocess_setOutputTarget", &esengine::postprocess_setOutputTarget);
    emscripten::function("postprocess_setOutputViewport", &esengine::postprocess_setOutputViewport);
    emscripten::function("postprocess_beginScreenCapture", &esengine::postprocess_beginScreenCapture);
    emscripten::function("postprocess_endScreenCapture", &esengine::postprocess_endScreenCapture);
    emscripten::function("postprocess_executeScreenPasses", &esengine::postprocess_executeScreenPasses);
    emscripten::function("postprocess_addScreenPass", &esengine::postprocess_addScreenPass);
    emscripten::function("postprocess_clearScreenPasses", &esengine::postprocess_clearScreenPasses);
    emscripten::function("postprocess_setScreenUniformFloat", &esengine::postprocess_setScreenUniformFloat);
    emscripten::function("postprocess_setScreenUniformVec4", &esengine::postprocess_setScreenUniformVec4);
#endif

    emscripten::function("renderer_init", &esengine::renderer_init);
    emscripten::function("renderer_resize", &esengine::renderer_resize);
    emscripten::function("renderer_beginFrame", &esengine::renderer_beginFrame);
    emscripten::function("renderer_begin", &esengine::renderer_begin);
    emscripten::function("renderer_flush", &esengine::renderer_flush);
    emscripten::function("renderer_end", &esengine::renderer_end);
    emscripten::function("renderer_submitSprites", &esengine::renderer_submitSprites);
    emscripten::function("renderer_submitUIElements", &esengine::renderer_submitUIElements);
#ifdef ES_ENABLE_BITMAP_TEXT
    emscripten::function("renderer_submitBitmapText", &esengine::renderer_submitBitmapText);
#endif
    emscripten::function("renderer_submitShapes", &esengine::renderer_submitShapes);
#ifdef ES_ENABLE_SPINE
    emscripten::function("renderer_submitSpine", &esengine::renderer_submitSpine);
#endif
#ifdef ES_ENABLE_PARTICLES
    emscripten::function("renderer_submitParticles", &esengine::renderer_submitParticles);
#endif
    emscripten::function("renderer_updateTransforms", &esengine::renderer_updateTransforms);
    emscripten::function("renderer_submitAll", &esengine::renderer_submitAll);
#ifdef ES_ENABLE_PARTICLES
    emscripten::function("particle_update", &esengine::particle_update);
    emscripten::function("particle_play", &esengine::particle_play);
    emscripten::function("particle_stop", &esengine::particle_stop);
    emscripten::function("particle_reset", &esengine::particle_reset);
    emscripten::function("particle_getAliveCount", &esengine::particle_getAliveCount);
    emscripten::function("particle_set_color_lut", &esengine::particle_set_color_lut);
    emscripten::function("particle_set_size_lut", &esengine::particle_set_size_lut);
#endif
    emscripten::function("renderer_setStage", &esengine::renderer_setStage);
    emscripten::function("renderer_createTarget", &esengine::renderer_createTarget);
    emscripten::function("renderer_releaseTarget", &esengine::renderer_releaseTarget);
    emscripten::function("renderer_getTargetTexture", &esengine::renderer_getTargetTexture);
    emscripten::function("renderer_getTargetDepthTexture", &esengine::renderer_getTargetDepthTexture);
    emscripten::function("renderer_getDrawCalls", &esengine::renderer_getDrawCalls);
    emscripten::function("renderer_getTriangles", &esengine::renderer_getTriangles);
    emscripten::function("renderer_getSprites", &esengine::renderer_getSprites);
#ifdef ES_ENABLE_SPINE
    emscripten::function("renderer_getSpine", &esengine::renderer_getSpine);
#endif
    emscripten::function("renderer_getText", &esengine::renderer_getText);
    emscripten::function("renderer_getMeshes", &esengine::renderer_getMeshes);
    emscripten::function("renderer_getCulled", &esengine::renderer_getCulled);
    emscripten::function("renderer_setDeltaTime", &esengine::renderer_setDeltaTime);
    emscripten::function("renderer_setClearColor", &esengine::renderer_setClearColor);
    emscripten::function("renderer_setViewport", &esengine::renderer_setViewport);
    emscripten::function("renderer_setScissor", &esengine::renderer_setScissor);
    emscripten::function("renderer_clearBuffers", &esengine::renderer_clearBuffers);
    emscripten::function("renderer_setEntityClipRect", &esengine::renderer_setEntityClipRect);
    emscripten::function("renderer_clearEntityClipRect", &esengine::renderer_clearEntityClipRect);
    emscripten::function("renderer_clearAllClipRects", &esengine::renderer_clearAllClipRects);

    emscripten::function("renderer_clearStencil", &esengine::renderer_clearStencil);
    emscripten::function("renderer_setEntityStencilMask", &esengine::renderer_setEntityStencilMask);
    emscripten::function("renderer_setEntityStencilTest", &esengine::renderer_setEntityStencilTest);
    emscripten::function("renderer_clearEntityStencilMask", &esengine::renderer_clearEntityStencilMask);
    emscripten::function("renderer_clearAllStencilMasks", &esengine::renderer_clearAllStencilMasks);

    emscripten::function("registry_getCanvasEntity", &esengine::registry_getCanvasEntity);
    emscripten::function("registry_getCameraEntities", &esengine::registry_getCameraEntities);
    emscripten::function("getChildEntities", &esengine::getChildEntities);
    emscripten::function("registry_getGeneration", &esengine::registry_getGeneration);
    emscripten::function("registry_batchSyncPhysicsTransforms", &esengine::registry_batchSyncPhysicsTransforms);

    emscripten::function("gl_enableErrorCheck", &esengine::gl_enableErrorCheck);
    emscripten::function("gl_checkErrors", &esengine::gl_checkErrors);
    emscripten::function("renderer_diagnose", &esengine::renderer_diagnose);

    emscripten::function("renderer_captureNextFrame", &esengine::renderer_captureNextFrame);
    emscripten::function("renderer_getCapturedFrameSize", &esengine::renderer_getCapturedFrameSize);
    emscripten::function("renderer_getCapturedFrameData", &esengine::renderer_getCapturedFrameData);
    emscripten::function("renderer_getCapturedEntities", &esengine::renderer_getCapturedEntities);
    emscripten::function("renderer_getCapturedEntityCount", &esengine::renderer_getCapturedEntityCount);
    emscripten::function("renderer_getCapturedCameraCount", &esengine::renderer_getCapturedCameraCount);
    emscripten::function("renderer_hasCapturedData", &esengine::renderer_hasCapturedData);
    emscripten::function("renderer_replayToDrawCall", &esengine::renderer_replayToDrawCall);
    emscripten::function("renderer_getSnapshotPtr", &esengine::renderer_getSnapshotPtr);
    emscripten::function("renderer_getSnapshotSize", &esengine::renderer_getSnapshotSize);
    emscripten::function("renderer_getSnapshotWidth", &esengine::renderer_getSnapshotWidth);
    emscripten::function("renderer_getSnapshotHeight", &esengine::renderer_getSnapshotHeight);
    emscripten::function("renderer_renderMaterialPreview", &esengine::renderer_renderMaterialPreview);
    emscripten::function("renderer_getPreviewPtr", &esengine::renderer_getPreviewPtr);
    emscripten::function("renderer_getPreviewSize", &esengine::renderer_getPreviewSize);
    emscripten::function("renderer_getPreviewWidth", &esengine::renderer_getPreviewWidth);
    emscripten::function("renderer_getPreviewHeight", &esengine::renderer_getPreviewHeight);
    emscripten::function("renderer_setTextureParams", &esengine::renderer_setTextureParams);
}

// =============================================================================
// UI Systems
// =============================================================================

namespace esengine {

void uiLayout_update(ecs::Registry& registry, f32 camLeft, f32 camBottom, f32 camRight, f32 camTop) {
    ctx().require<ecs::UISystem>().layoutUpdate(registry, camLeft, camBottom, camRight, camTop);
}

void uiHitTest_update(ecs::Registry& registry, f32 mouseWorldX, f32 mouseWorldY,
                       bool mouseDown, bool mousePressed, bool mouseReleased) {
    ctx().require<ecs::UISystem>().hitTestUpdate(registry, mouseWorldX, mouseWorldY, mouseDown, mousePressed, mouseReleased);
}

u32 uiHitTest_getHitEntity() {
    return ctx().require<ecs::UISystem>().getHitEntity();
}

u32 uiHitTest_getHitEntityPrev() {
    return ctx().require<ecs::UISystem>().getPrevHitEntity();
}

// Resolved (Yoga-pass) pixel size of a UI node, for the editor's selection outline.
// The node's world box is this size, pivot-centered on its Transform.
f32 uiNode_computedWidth(ecs::Registry& r, u32 e) {
    auto* n = r.tryGet<ecs::UINode>(Entity::fromRaw(e));
    return n ? n->computed_size_.x : 0.0f;
}
f32 uiNode_computedHeight(ecs::Registry& r, u32 e) {
    auto* n = r.tryGet<ecs::UINode>(Entity::fromRaw(e));
    return n ? n->computed_size_.y : 0.0f;
}

void uiRenderOrder_update(ecs::Registry& registry) {
    ecs::uiRenderOrderUpdate(registry);
}

// The SDF text path (TS) reads an entity's UI
// draw order so glyph quads interleave with UI quads. uiRenderOrderUpdate
// assigns uiOrder to every UIVisual in the UI tree (text nodes carry a
// visualType=None UIVisual purely to be ordered). -1 = not a UI node.
i32 ui_getRenderOrder(ecs::Registry& registry, u32 entity) {
    auto* ui = registry.tryGet<ecs::UIVisual>(Entity::fromRaw(entity));
    return ui ? ui->uiOrder : -1;
}

void uiFlexLayout_update(ecs::Registry& registry) {
    // Flex layout is now integrated into uiLayout_update via unified layout pass.
    // Kept as no-op for backward compatibility with TS plugin.
    (void)registry;
}

void uiTree_markStructureDirty() {
    ctx().require<ecs::UISystem>().treeMarkStructureDirty();
}

void uiTree_markDirty(u32 entity) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    ctx().require<ecs::UISystem>().treeMarkDirty(e);
}

void uiTree_markAllDirty() {
    ctx().require<ecs::UISystem>().tree.markAllDirty();
}

// UINode (CSS box) computed size — its internal computed_size_ is not
// embind-readable, so expose it for TS uiHelpers.
f32 getUINodeComputedWidth(ecs::Registry& registry, u32 entity) {
    auto* node = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity));
    if (!node) return 0.0f;
    return node->computed_size_.x;
}

f32 getUINodeComputedHeight(ecs::Registry& registry, u32 entity) {
    auto* node = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity));
    if (!node) return 0.0f;
    return node->computed_size_.y;
}

void transform_update(ecs::Registry& registry) {
    esengine::World world{registry, ctx().services(), 0.0f};
    if (auto* ts = ctx().tryGet<ecs::TransformSystem>()) {
        ts->update(world);
    } else {
        ecs::TransformSystem fallback;
        fallback.update(world);
    }
}

// Per-frame clear of UINode tween anim-override flags (set by the tween system,
// read by the layout pass). Name kept (ui_*) for the TS binding.
void uiRect_clearAnimOverrides(ecs::Registry& registry) {
    for (auto entity : registry.view<ecs::UINode>()) {
        registry.get<ecs::UINode>(entity).anim_override_ = 0;
    }
}

void uiRect_setAnimOverride(ecs::Registry& registry, u32 entity, u8 flags) {
    if (auto* n = registry.tryGet<ecs::UINode>(Entity::fromRaw(entity))) {
        n->anim_override_ |= flags;
    }
}

void transform_patchPosition(ecs::Registry& registry, u32 entity,
                             f32 x, f32 y, f32 z) {
    auto* transform = registry.tryGet<ecs::Transform>(Entity::fromRaw(entity));
    if (!transform) return;
    transform->position = {x, y, z};
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_ui_systems) {
    emscripten::function("uiLayout_update", &esengine::uiLayout_update);
    emscripten::function("uiHitTest_update", &esengine::uiHitTest_update);
    emscripten::function("uiHitTest_getHitEntity", &esengine::uiHitTest_getHitEntity);
    emscripten::function("uiHitTest_getHitEntityPrev", &esengine::uiHitTest_getHitEntityPrev);
    emscripten::function("uiNode_computedWidth", &esengine::uiNode_computedWidth);
    emscripten::function("uiNode_computedHeight", &esengine::uiNode_computedHeight);
    emscripten::function("uiRenderOrder_update", &esengine::uiRenderOrder_update);
    emscripten::function("ui_getRenderOrder", &esengine::ui_getRenderOrder);
    emscripten::function("uiFlexLayout_update", &esengine::uiFlexLayout_update);
    emscripten::function("getUINodeComputedWidth", &esengine::getUINodeComputedWidth);
    emscripten::function("getUINodeComputedHeight", &esengine::getUINodeComputedHeight);
    emscripten::function("uiTree_markStructureDirty", &esengine::uiTree_markStructureDirty);
    emscripten::function("uiTree_markDirty", &esengine::uiTree_markDirty);
    emscripten::function("uiTree_markAllDirty", &esengine::uiTree_markAllDirty);
    emscripten::function("transform_update", &esengine::transform_update);
    emscripten::function("uiRect_clearAnimOverrides", &esengine::uiRect_clearAnimOverrides);
    emscripten::function("uiRect_setAnimOverride", &esengine::uiRect_setAnimOverride);
    emscripten::function("transform_patchPosition", &esengine::transform_patchPosition);
}

// =============================================================================
// Animation Bindings
// =============================================================================

namespace esengine {

u32 anim_createTween(ecs::Registry& registry, u32 entity, u32 targetProp,
                     f32 from, f32 to, f32 duration,
                     u32 easing, f32 delay,
                     u32 loopMode, i32 loopCount) {
    auto* sys = ctx().tryGet<animation::TweenSystem>();
    if (!sys) {
        return INVALID_ENTITY.id();
    }
    auto tweenEntity = sys->createTween(
        registry, Entity::fromRaw(entity),
        static_cast<animation::TweenTarget>(targetProp),
        from, to, duration,
        static_cast<animation::EasingType>(easing));

    auto& tween = registry.get<animation::TweenData>(tweenEntity);
    tween.delay = delay;
    tween.loop_mode = static_cast<animation::LoopMode>(loopMode);
    tween.loop_count = loopCount;
    tween.loops_remaining = loopCount;
    return tweenEntity.id();
}

void anim_cancelTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->cancelTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_cancelAllTweens(ecs::Registry& registry, u32 targetEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->cancelAllTweens(registry, Entity::fromRaw(targetEntity));
    }
}

void anim_pauseTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->pauseTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_resumeTween(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->resumeTween(registry, Entity::fromRaw(tweenEntity));
    }
}

void anim_setTweenBezier(ecs::Registry& registry, u32 tweenEntity,
                          f32 p1x, f32 p1y, f32 p2x, f32 p2y) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        tween->easing = animation::EasingType::CubicBezier;
        tween->bezier_p1x = p1x;
        tween->bezier_p1y = p1y;
        tween->bezier_p2x = p2x;
        tween->bezier_p2y = p2y;
    }
}

void anim_setSequenceNext(ecs::Registry& registry, u32 tweenEntity, u32 nextEntity) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        tween->sequence_next = Entity::fromRaw(nextEntity);
    }
}

void anim_updateTweens(ecs::Registry& registry, f32 deltaTime) {
    if (auto* sys = ctx().tryGet<animation::TweenSystem>()) {
        sys->update(registry, deltaTime);
    }
}

i32 anim_getTweenState(ecs::Registry& registry, u32 tweenEntity) {
    if (auto* tween = registry.tryGet<animation::TweenData>(Entity::fromRaw(tweenEntity))) {
        return static_cast<i32>(tween->state);
    }
    return static_cast<i32>(animation::TweenState::Completed);
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_animation) {
    emscripten::function("_anim_createTween", &esengine::anim_createTween);
    emscripten::function("_anim_cancelTween", &esengine::anim_cancelTween);
    emscripten::function("_anim_cancelAllTweens", &esengine::anim_cancelAllTweens);
    emscripten::function("_anim_pauseTween", &esengine::anim_pauseTween);
    emscripten::function("_anim_resumeTween", &esengine::anim_resumeTween);
    emscripten::function("_anim_setTweenBezier", &esengine::anim_setTweenBezier);
    emscripten::function("_anim_setSequenceNext", &esengine::anim_setSequenceNext);
    emscripten::function("_anim_updateTweens", &esengine::anim_updateTweens);
    emscripten::function("_anim_getTweenState", &esengine::anim_getTweenState);
}

int main() {
    return 0;
}

