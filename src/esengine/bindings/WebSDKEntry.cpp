/**
 * @file    WebSDKEntry.cpp
 * @brief   ESEngine Web SDK entry point with rendering support
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#ifdef ES_PLATFORM_WEB

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/html5.h>

#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/RenderCommand.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/Texture.hpp"
#include "../renderer/BlendMode.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../renderer/PostProcessPipeline.hpp"
#include "../renderer/RenderStage.hpp"
#include "../resource/ResourceManager.hpp"
#include "../resource/TextureMetadata.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/TransformSystem.hpp"
#include "../ecs/components/Camera.hpp"
#include "../ecs/components/Transform.hpp"
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

namespace esengine {

static Unique<RenderContext> g_renderContext;
static Unique<RenderFrame> g_renderFrame;
static Unique<ecs::TransformSystem> g_transformSystem;
static Unique<resource::ResourceManager> g_resourceManager;
static Unique<spine::SpineResourceManager> g_spineResourceManager;
static Unique<spine::SpineSystem> g_spineSystem;
static Unique<ImmediateDraw> g_immediateDraw;
static Unique<GeometryManager> g_geometryManager;
static Unique<PostProcessPipeline> g_postProcessPipeline;
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE g_webglContext = 0;
static bool g_initialized = false;
static bool g_immediateDrawActive = false;
static u32 g_viewportWidth = 1280;
static u32 g_viewportHeight = 720;

bool initRendererInternal(const char* canvasSelector) {
    if (g_initialized) return true;

    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.alpha = true;
    attrs.depth = true;
    attrs.stencil = false;
    attrs.antialias = true;
    attrs.premultipliedAlpha = true;
    attrs.preserveDrawingBuffer = false;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_DEFAULT;
    attrs.failIfMajorPerformanceCaveat = false;

    g_webglContext = emscripten_webgl_create_context(canvasSelector, &attrs);
    if (g_webglContext <= 0) {
        ES_LOG_ERROR("Failed to create WebGL2 context for '{}': {}", canvasSelector, g_webglContext);
        return false;
    }

    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(g_webglContext);
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }

    ES_LOG_INFO("WebGL2 context created for '{}'", canvasSelector);

    g_resourceManager = makeUnique<resource::ResourceManager>();
    g_resourceManager->init();

    g_renderContext = makeUnique<RenderContext>();
    g_renderContext->init();

    g_transformSystem = makeUnique<ecs::TransformSystem>();

    g_spineResourceManager = makeUnique<spine::SpineResourceManager>(*g_resourceManager);
    g_spineResourceManager->init();

    g_spineSystem = makeUnique<spine::SpineSystem>(*g_spineResourceManager);

    g_immediateDraw = makeUnique<ImmediateDraw>(*g_renderContext, *g_resourceManager);
    g_immediateDraw->init();

    g_geometryManager = makeUnique<GeometryManager>();

    g_renderFrame = makeUnique<RenderFrame>(*g_renderContext, *g_resourceManager);
    g_renderFrame->init(1280, 720);

    g_initialized = true;

    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    return true;
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

    g_webglContext = contextHandle;

    EMSCRIPTEN_RESULT result = emscripten_webgl_make_context_current(g_webglContext);
    if (result != EMSCRIPTEN_RESULT_SUCCESS) {
        ES_LOG_ERROR("Failed to make WebGL context current: {}", result);
        return false;
    }

    ES_LOG_INFO("WebGL context set from external handle: {}", contextHandle);

    g_resourceManager = makeUnique<resource::ResourceManager>();
    g_resourceManager->init();

    g_renderContext = makeUnique<RenderContext>();
    g_renderContext->init();

    g_transformSystem = makeUnique<ecs::TransformSystem>();

    g_spineResourceManager = makeUnique<spine::SpineResourceManager>(*g_resourceManager);
    g_spineResourceManager->init();

    g_spineSystem = makeUnique<spine::SpineSystem>(*g_spineResourceManager);

    g_immediateDraw = makeUnique<ImmediateDraw>(*g_renderContext, *g_resourceManager);
    g_immediateDraw->init();

    g_geometryManager = makeUnique<GeometryManager>();

    g_renderFrame = makeUnique<RenderFrame>(*g_renderContext, *g_resourceManager);
    g_renderFrame->init(1280, 720);

    g_initialized = true;

    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    return true;
}

void shutdownRenderer() {
    if (!g_initialized) return;

    g_geometryManager.reset();

    if (g_renderFrame) {
        g_renderFrame->shutdown();
        g_renderFrame.reset();
    }

    if (g_immediateDraw) {
        g_immediateDraw->shutdown();
        g_immediateDraw.reset();
    }

    g_spineSystem.reset();
    g_spineResourceManager->shutdown();
    g_spineResourceManager.reset();

    g_transformSystem.reset();
    g_renderContext->shutdown();
    g_renderContext.reset();
    g_resourceManager->shutdown();
    g_resourceManager.reset();

    if (g_webglContext > 0) {
        emscripten_webgl_destroy_context(g_webglContext);
        g_webglContext = 0;
    }

    g_initialized = false;
}

resource::ResourceManager* getResourceManager() {
    return g_resourceManager.get();
}

u32 rm_createTexture(resource::ResourceManager& rm, u32 width, u32 height,
                      uintptr_t pixelsPtr, u32 pixelsLen, i32 format) {
    const u8* pixels = reinterpret_cast<const u8*>(pixelsPtr);
    ConstSpan<u8> pixelSpan(pixels, pixelsLen);

    TextureFormat texFormat = TextureFormat::RGBA8;
    if (format == 0) texFormat = TextureFormat::RGB8;
    else if (format == 1) texFormat = TextureFormat::RGBA8;

    auto handle = rm.createTexture(width, height, pixelSpan, texFormat);
    return handle.id();
}

u32 rm_createShader(resource::ResourceManager& rm,
                     const std::string& vertSrc, const std::string& fragSrc) {
    auto handle = rm.createShader(vertSrc, fragSrc);
    return handle.id();
}

void rm_releaseTexture(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseTexture(resource::TextureHandle(handleId));
}

void rm_registerTextureWithPath(resource::ResourceManager& rm, u32 handleId, const std::string& path) {
    rm.registerTextureWithPath(resource::TextureHandle(handleId), path);
}

void rm_releaseShader(resource::ResourceManager& rm, u32 handleId) {
    rm.releaseShader(resource::ShaderHandle(handleId));
}

void rm_setTextureMetadata(resource::ResourceManager& rm, u32 handleId,
                            f32 left, f32 right, f32 top, f32 bottom) {
    resource::TextureMetadata metadata;
    metadata.sliceBorder.left = left;
    metadata.sliceBorder.right = right;
    metadata.sliceBorder.top = top;
    metadata.sliceBorder.bottom = bottom;
    rm.setTextureMetadata(resource::TextureHandle(handleId), metadata);
}

void renderFrame(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight) {
    if (!g_initialized || !g_renderFrame) return;

    if (g_transformSystem) {
        g_transformSystem->update(registry, 0.0f);
    }

    if (g_spineSystem) {
        g_spineSystem->update(registry, 0.016f);
    }

    g_viewportWidth = static_cast<u32>(viewportWidth);
    g_viewportHeight = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    glViewport(0, 0, viewportWidth, viewportHeight);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    glm::mat4 viewProjection = glm::mat4(1.0f);

    auto cameraView = registry.view<ecs::Camera, ecs::LocalTransform>();

    for (auto entity : cameraView) {
        auto& camera = registry.get<ecs::Camera>(entity);
        if (!camera.isActive) continue;

        auto& transform = registry.get<ecs::LocalTransform>(entity);
        glm::mat4 view = glm::inverse(glm::translate(glm::mat4(1.0f), transform.position));

        glm::mat4 projection;
        f32 aspect = static_cast<f32>(viewportWidth) / static_cast<f32>(viewportHeight);

        if (camera.projectionType == ecs::ProjectionType::Orthographic) {
            f32 halfHeight = camera.orthoSize;
            f32 halfWidth = halfHeight * aspect;
            projection = glm::ortho(-halfWidth, halfWidth, -halfHeight, halfHeight,
                                    camera.nearPlane, camera.farPlane);
        } else {
            projection = glm::perspective(
                glm::radians(camera.fov),
                static_cast<f32>(viewportWidth) / static_cast<f32>(viewportHeight),
                camera.nearPlane, camera.farPlane
            );
        }

        viewProjection = projection * view;
        break;
    }

    g_renderFrame->begin(viewProjection);
    g_renderFrame->submitSprites(registry);
    g_renderFrame->submitSpine(registry, *g_spineSystem);
    g_renderFrame->end();
}

void renderFrameWithMatrix(ecs::Registry& registry, i32 viewportWidth, i32 viewportHeight,
                           uintptr_t matrixPtr) {
    if (!g_initialized || !g_renderFrame) return;

    if (g_transformSystem) {
        g_transformSystem->update(registry, 0.0f);
    }

    if (g_spineSystem) {
        g_spineSystem->update(registry, 0.016f);
    }

    g_viewportWidth = static_cast<u32>(viewportWidth);
    g_viewportHeight = static_cast<u32>(viewportHeight);
    g_renderFrame->resize(g_viewportWidth, g_viewportHeight);

    glViewport(0, 0, viewportWidth, viewportHeight);
    glClearColor(0.1f, 0.1f, 0.1f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    g_renderFrame->begin(viewProjection);
    g_renderFrame->submitSprites(registry);
    g_renderFrame->submitSpine(registry, *g_spineSystem);
    g_renderFrame->end();
}

struct SpineBounds {
    f32 x = 0;
    f32 y = 0;
    f32 width = 0;
    f32 height = 0;
    bool valid = false;
};

SpineBounds getSpineBounds(ecs::Registry& registry, Entity entity) {
    SpineBounds bounds;
    if (!g_spineSystem) return bounds;

    if (g_spineSystem->getSkeletonBounds(entity, bounds.x, bounds.y,
                                          bounds.width, bounds.height)) {
        bounds.valid = true;
    }
    return bounds;
}

// =============================================================================
// ImmediateDraw API
// =============================================================================

static glm::mat4 g_currentViewProjection{1.0f};

void draw_begin(uintptr_t matrixPtr) {
    if (!g_initialized || !g_immediateDraw) return;

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    g_currentViewProjection = glm::make_mat4(matrixData);
    g_immediateDraw->begin(g_currentViewProjection);
    g_immediateDrawActive = true;
}

void draw_end() {
    if (!g_initialized || !g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->end();
    g_immediateDrawActive = false;
}

void draw_line(f32 fromX, f32 fromY, f32 toX, f32 toY,
               f32 r, f32 g, f32 b, f32 a, f32 thickness) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->line(
        glm::vec2(fromX, fromY),
        glm::vec2(toX, toY),
        glm::vec4(r, g, b, a),
        thickness
    );
}

void draw_rect(f32 x, f32 y, f32 width, f32 height,
               f32 r, f32 g, f32 b, f32 a, bool filled) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->rect(
        glm::vec2(x, y),
        glm::vec2(width, height),
        glm::vec4(r, g, b, a),
        filled
    );
}

void draw_rectOutline(f32 x, f32 y, f32 width, f32 height,
                      f32 r, f32 g, f32 b, f32 a, f32 thickness) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->rectOutline(
        glm::vec2(x, y),
        glm::vec2(width, height),
        glm::vec4(r, g, b, a),
        thickness
    );
}

void draw_circle(f32 centerX, f32 centerY, f32 radius,
                 f32 r, f32 g, f32 b, f32 a, bool filled, i32 segments) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->circle(
        glm::vec2(centerX, centerY),
        radius,
        glm::vec4(r, g, b, a),
        filled,
        segments
    );
}

void draw_circleOutline(f32 centerX, f32 centerY, f32 radius,
                        f32 r, f32 g, f32 b, f32 a, f32 thickness, i32 segments) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->circleOutline(
        glm::vec2(centerX, centerY),
        radius,
        glm::vec4(r, g, b, a),
        thickness,
        segments
    );
}

void draw_texture(f32 x, f32 y, f32 width, f32 height, u32 textureId,
                  f32 r, f32 g, f32 b, f32 a) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->texture(
        glm::vec2(x, y),
        glm::vec2(width, height),
        textureId,
        glm::vec4(r, g, b, a)
    );
}

void draw_textureRotated(f32 x, f32 y, f32 width, f32 height, f32 rotation,
                         u32 textureId, f32 r, f32 g, f32 b, f32 a) {
    if (!g_immediateDraw || !g_immediateDrawActive) return;

    g_immediateDraw->textureRotated(
        glm::vec2(x, y),
        glm::vec2(width, height),
        rotation,
        textureId,
        glm::vec4(r, g, b, a)
    );
}

void draw_setLayer(i32 layer) {
    if (!g_immediateDraw) return;
    g_immediateDraw->setLayer(layer);
}

void draw_setDepth(f32 depth) {
    if (!g_immediateDraw) return;
    g_immediateDraw->setDepth(depth);
}

u32 draw_getDrawCallCount() {
    if (!g_immediateDraw) return 0;
    return g_immediateDraw->getDrawCallCount();
}

u32 draw_getPrimitiveCount() {
    if (!g_immediateDraw) return 0;
    return g_immediateDraw->getPrimitiveCount();
}

void draw_setBlendMode(i32 mode) {
    RenderCommand::setBlendMode(static_cast<BlendMode>(mode));
}

void draw_setDepthTest(bool enabled) {
    RenderCommand::setDepthTest(enabled);
}

// =============================================================================
// Geometry API
// =============================================================================

u32 geometry_create() {
    if (!g_geometryManager) return 0;
    return g_geometryManager->create();
}

void geometry_init(u32 handle, uintptr_t verticesPtr, u32 vertexCount,
                   uintptr_t layoutPtr, u32 layoutCount, bool dynamic) {
    if (!g_geometryManager) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    const f32* vertices = reinterpret_cast<const f32*>(verticesPtr);
    const i32* layoutData = reinterpret_cast<const i32*>(layoutPtr);

    std::vector<VertexAttribute> attrs;

    for (u32 i = 0; i < layoutCount; ++i) {
        ShaderDataType type = static_cast<ShaderDataType>(layoutData[i]);
        std::string name = "a_attr" + std::to_string(i);
        attrs.emplace_back(type, name);
    }

    VertexLayout layout;
    if (layoutCount == 1) {
        layout = { attrs[0] };
    } else if (layoutCount == 2) {
        layout = { attrs[0], attrs[1] };
    } else if (layoutCount == 3) {
        layout = { attrs[0], attrs[1], attrs[2] };
    } else if (layoutCount == 4) {
        layout = { attrs[0], attrs[1], attrs[2], attrs[3] };
    }

    geom->init(vertices, vertexCount, layout, dynamic);
}

void geometry_setIndices16(u32 handle, uintptr_t indicesPtr, u32 indexCount) {
    if (!g_geometryManager) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    const u16* indices = reinterpret_cast<const u16*>(indicesPtr);
    geom->setIndices(indices, indexCount);
}

void geometry_setIndices32(u32 handle, uintptr_t indicesPtr, u32 indexCount) {
    if (!g_geometryManager) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    const u32* indices = reinterpret_cast<const u32*>(indicesPtr);
    geom->setIndices(indices, indexCount);
}

void geometry_updateVertices(u32 handle, uintptr_t verticesPtr, u32 vertexCount, u32 offset) {
    if (!g_geometryManager) return;

    auto* geom = g_geometryManager->get(handle);
    if (!geom) return;

    const f32* vertices = reinterpret_cast<const f32*>(verticesPtr);
    geom->updateVertices(vertices, vertexCount, offset);
}

void geometry_release(u32 handle) {
    if (!g_geometryManager) return;
    g_geometryManager->release(handle);
}

bool geometry_isValid(u32 handle) {
    if (!g_geometryManager) return false;
    return g_geometryManager->isValid(handle);
}

// =============================================================================
// Draw Mesh API
// =============================================================================

void draw_mesh(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr) {
    if (!g_initialized || !g_geometryManager || !g_resourceManager) return;

    auto* geom = g_geometryManager->get(geometryHandle);
    if (!geom || !geom->isValid()) return;

    Shader* shader = g_resourceManager->getShader(resource::ShaderHandle(shaderHandle));
    if (!shader) return;

    const f32* transformData = reinterpret_cast<const f32*>(transformPtr);
    glm::mat4 transform = glm::make_mat4(transformData);

    shader->bind();
    shader->setUniform("u_projection", g_currentViewProjection);
    shader->setUniform("u_model", transform);

    geom->bind();

    if (geom->hasIndices()) {
        auto* vao = geom->getVAO();
        if (vao) {
            RenderCommand::drawIndexed(*vao, geom->getIndexCount());
        }
    } else {
        RenderCommand::drawArrays(geom->getVertexCount());
    }

    geom->unbind();
}

void draw_meshWithUniforms(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr,
                           uintptr_t uniformsPtr, u32 uniformCount) {
    if (!g_initialized || !g_geometryManager || !g_resourceManager) return;

    auto* geom = g_geometryManager->get(geometryHandle);
    if (!geom || !geom->isValid()) return;

    Shader* shader = g_resourceManager->getShader(resource::ShaderHandle(shaderHandle));
    if (!shader) return;

    const f32* transformData = reinterpret_cast<const f32*>(transformPtr);
    glm::mat4 transform = glm::make_mat4(transformData);

    shader->bind();
    shader->setUniform("u_projection", g_currentViewProjection);
    shader->setUniform("u_model", transform);

    static constexpr const char* UNIFORM_NAMES[] = {
        "u_time", "u_color", "u_intensity", "u_scale", "u_offset",
        "u_param0", "u_param1", "u_param2", "u_param3", "u_param4",
        "u_vec0", "u_vec1", "u_vec2", "u_vec3",
        "u_texture0", "u_texture1", "u_texture2", "u_texture3"
    };
    static constexpr u32 UNIFORM_NAME_COUNT = sizeof(UNIFORM_NAMES) / sizeof(UNIFORM_NAMES[0]);

    const f32* uniforms = reinterpret_cast<const f32*>(uniformsPtr);
    u32 idx = 0;

    while (idx < uniformCount) {
        auto type = static_cast<i32>(uniforms[idx++]);
        auto nameId = static_cast<i32>(uniforms[idx++]);

        const char* name = (nameId >= 0 && static_cast<u32>(nameId) < UNIFORM_NAME_COUNT)
                         ? UNIFORM_NAMES[nameId] : "u_unknown";

        switch (type) {
            case 1: {
                f32 value = uniforms[idx++];
                shader->setUniform(name, value);
                break;
            }
            case 2: {
                glm::vec2 value(uniforms[idx], uniforms[idx + 1]);
                idx += 2;
                shader->setUniform(name, value);
                break;
            }
            case 3: {
                glm::vec3 value(uniforms[idx], uniforms[idx + 1], uniforms[idx + 2]);
                idx += 3;
                shader->setUniform(name, value);
                break;
            }
            case 4: {
                glm::vec4 value(uniforms[idx], uniforms[idx + 1],
                               uniforms[idx + 2], uniforms[idx + 3]);
                idx += 4;
                shader->setUniform(name, value);
                break;
            }
            case 10: {
                i32 slot = static_cast<i32>(uniforms[idx++]);
                u32 textureId = static_cast<u32>(uniforms[idx++]);
                glActiveTexture(GL_TEXTURE0 + slot);
                glBindTexture(GL_TEXTURE_2D, textureId);
                shader->setUniform(name, slot);
                break;
            }
            default:
                break;
        }
    }

    geom->bind();

    if (geom->hasIndices()) {
        auto* vao = geom->getVAO();
        if (vao) {
            RenderCommand::drawIndexed(*vao, geom->getIndexCount());
        }
    } else {
        RenderCommand::drawArrays(geom->getVertexCount());
    }

    geom->unbind();
}

// =============================================================================
// PostProcess API
// =============================================================================

bool postprocess_init(u32 width, u32 height) {
    if (!g_initialized || !g_renderContext || !g_resourceManager) return false;

    if (!g_postProcessPipeline) {
        g_postProcessPipeline = makeUnique<PostProcessPipeline>(*g_renderContext, *g_resourceManager);
    }

    g_postProcessPipeline->init(width, height);
    return g_postProcessPipeline->isInitialized();
}

void postprocess_shutdown() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->shutdown();
        g_postProcessPipeline.reset();
    }
}

void postprocess_resize(u32 width, u32 height) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->resize(width, height);
    }
}

u32 postprocess_addPass(const std::string& name, u32 shaderHandle) {
    if (!g_postProcessPipeline) return 0;
    return g_postProcessPipeline->addPass(name, resource::ShaderHandle(shaderHandle));
}

void postprocess_removePass(const std::string& name) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->removePass(name);
    }
}

void postprocess_setPassEnabled(const std::string& name, bool enabled) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPassEnabled(name, enabled);
    }
}

bool postprocess_isPassEnabled(const std::string& name) {
    if (!g_postProcessPipeline) return false;
    return g_postProcessPipeline->isPassEnabled(name);
}

void postprocess_setUniformFloat(const std::string& passName,
                                  const std::string& uniform, f32 value) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPassUniformFloat(passName, uniform, value);
    }
}

void postprocess_setUniformVec4(const std::string& passName,
                                 const std::string& uniform,
                                 f32 x, f32 y, f32 z, f32 w) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setPassUniformVec4(passName, uniform, glm::vec4(x, y, z, w));
    }
}

void postprocess_begin() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->begin();
    }
}

void postprocess_end() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->end();
    }
}

u32 postprocess_getPassCount() {
    if (!g_postProcessPipeline) return 0;
    return g_postProcessPipeline->getPassCount();
}

bool postprocess_isInitialized() {
    if (!g_postProcessPipeline) return false;
    return g_postProcessPipeline->isInitialized();
}

void postprocess_setBypass(bool bypass) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setBypass(bypass);
    }
}

bool postprocess_isBypassed() {
    if (!g_postProcessPipeline) return true;
    return g_postProcessPipeline->isBypassed();
}

void renderer_init(u32 width, u32 height) {
    if (!g_renderFrame) return;
    g_viewportWidth = width;
    g_viewportHeight = height;
    g_renderFrame->resize(width, height);
}

void renderer_resize(u32 width, u32 height) {
    if (!g_renderFrame) return;
    g_viewportWidth = width;
    g_viewportHeight = height;
    g_renderFrame->resize(width, height);
}

void renderer_begin(uintptr_t matrixPtr, u32 targetHandle) {
    if (!g_renderFrame) return;

    const f32* matrixData = reinterpret_cast<const f32*>(matrixPtr);
    glm::mat4 viewProjection = glm::make_mat4(matrixData);

    glViewport(0, 0, g_viewportWidth, g_viewportHeight);
    glClearColor(0.0f, 0.0f, 0.0f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    g_renderFrame->begin(viewProjection, targetHandle);
}

void renderer_end() {
    if (!g_renderFrame) return;
    g_renderFrame->end();
}

void renderer_submitSprites(ecs::Registry& registry) {
    if (!g_renderFrame || !g_transformSystem) return;
    g_transformSystem->update(registry, 0.0f);
    g_renderFrame->submitSprites(registry);
}

void renderer_submitSpine(ecs::Registry& registry) {
    if (!g_renderFrame || !g_spineSystem) return;
    g_spineSystem->update(registry, 0.016f);
    g_renderFrame->submitSpine(registry, *g_spineSystem);
}

void renderer_setStage(i32 stage) {
    if (!g_renderFrame) return;
    g_renderFrame->setStage(static_cast<RenderStage>(stage));
}

u32 renderer_createTarget(u32 width, u32 height) {
    if (!g_renderFrame) return 0;
    return g_renderFrame->targetManager().create(width, height);
}

void renderer_releaseTarget(u32 handle) {
    if (!g_renderFrame) return;
    g_renderFrame->targetManager().release(handle);
}

u32 renderer_getTargetTexture(u32 handle) {
    if (!g_renderFrame) return 0;
    auto* target = g_renderFrame->targetManager().get(handle);
    return target ? target->getColorTexture() : 0;
}

u32 renderer_getDrawCalls() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().draw_calls;
}

u32 renderer_getTriangles() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().triangles;
}

u32 renderer_getSprites() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().sprites;
}

u32 renderer_getSpine() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().spine;
}

u32 renderer_getMeshes() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().meshes;
}

u32 renderer_getCulled() {
    if (!g_renderFrame) return 0;
    return g_renderFrame->stats().culled;
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_renderer) {
    emscripten::function("initRenderer", &esengine::initRenderer);
    emscripten::function("initRendererWithCanvas", &esengine::initRendererWithCanvas);
    emscripten::function("initRendererWithContext", &esengine::initRendererWithContext);
    emscripten::function("shutdownRenderer", &esengine::shutdownRenderer);
    emscripten::function("renderFrame", &esengine::renderFrame);
    emscripten::function("renderFrameWithMatrix", &esengine::renderFrameWithMatrix);
    emscripten::function("getResourceManager", &esengine::getResourceManager, emscripten::allow_raw_pointers());

    emscripten::class_<esengine::resource::ResourceManager>("ResourceManager")
        .function("createTexture", &esengine::rm_createTexture)
        .function("createShader", &esengine::rm_createShader)
        .function("releaseTexture", &esengine::rm_releaseTexture)
        .function("releaseShader", &esengine::rm_releaseShader)
        .function("setTextureMetadata", &esengine::rm_setTextureMetadata)
        .function("registerTextureWithPath", &esengine::rm_registerTextureWithPath);

    emscripten::value_object<esengine::SpineBounds>("SpineBounds")
        .field("x", &esengine::SpineBounds::x)
        .field("y", &esengine::SpineBounds::y)
        .field("width", &esengine::SpineBounds::width)
        .field("height", &esengine::SpineBounds::height)
        .field("valid", &esengine::SpineBounds::valid);

    emscripten::function("getSpineBounds", &esengine::getSpineBounds);

    // ImmediateDraw API
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

    // Geometry API
    emscripten::function("geometry_create", &esengine::geometry_create);
    emscripten::function("geometry_init", &esengine::geometry_init);
    emscripten::function("geometry_setIndices16", &esengine::geometry_setIndices16);
    emscripten::function("geometry_setIndices32", &esengine::geometry_setIndices32);
    emscripten::function("geometry_updateVertices", &esengine::geometry_updateVertices);
    emscripten::function("geometry_release", &esengine::geometry_release);
    emscripten::function("geometry_isValid", &esengine::geometry_isValid);

    // PostProcess API
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

    // Renderer API (RenderFrame)
    emscripten::function("renderer_init", &esengine::renderer_init);
    emscripten::function("renderer_resize", &esengine::renderer_resize);
    emscripten::function("renderer_begin", &esengine::renderer_begin);
    emscripten::function("renderer_end", &esengine::renderer_end);
    emscripten::function("renderer_submitSprites", &esengine::renderer_submitSprites);
    emscripten::function("renderer_submitSpine", &esengine::renderer_submitSpine);
    emscripten::function("renderer_setStage", &esengine::renderer_setStage);
    emscripten::function("renderer_createTarget", &esengine::renderer_createTarget);
    emscripten::function("renderer_releaseTarget", &esengine::renderer_releaseTarget);
    emscripten::function("renderer_getTargetTexture", &esengine::renderer_getTargetTexture);
    emscripten::function("renderer_getDrawCalls", &esengine::renderer_getDrawCalls);
    emscripten::function("renderer_getTriangles", &esengine::renderer_getTriangles);
    emscripten::function("renderer_getSprites", &esengine::renderer_getSprites);
    emscripten::function("renderer_getSpine", &esengine::renderer_getSpine);
    emscripten::function("renderer_getMeshes", &esengine::renderer_getMeshes);
    emscripten::function("renderer_getCulled", &esengine::renderer_getCulled);
}

int main() {
    return 0;
}

#endif  // ES_PLATFORM_WEB
