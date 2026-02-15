#ifdef ES_PLATFORM_WEB

#include "GeometryBindings.hpp"
#include "EngineContext.hpp"
#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../renderer/Buffer.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif

#include <glm/glm.hpp>
#include <glm/gtc/type_ptr.hpp>
#include <vector>
#include <string>

namespace esengine {

static EngineContext& ctx() { return EngineContext::instance(); }

#define g_initialized (ctx().isInitialized())
#define g_geometryManager (ctx().geometryManager())
#define g_resourceManager (ctx().resourceManager())
#define g_immediateDraw (ctx().immediateDraw())
#define g_immediateDrawActive (ctx().immediateDrawActive())
#define g_currentViewProjection (ctx().currentViewProjection())

static void flushImmediateDrawIfActive() {
    if (g_immediateDrawActive && g_immediateDraw) {
        g_immediateDraw->flush();
    }
}

static void restoreImmediateDrawState() {
    if (g_immediateDrawActive) {
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        glEnable(GL_BLEND);
        glDisable(GL_DEPTH_TEST);
        glActiveTexture(GL_TEXTURE0);
    }
}

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

    static std::vector<VertexAttribute> s_attrs;
    s_attrs.clear();
    s_attrs.reserve(layoutCount);

    for (u32 i = 0; i < layoutCount; ++i) {
        ShaderDataType type = static_cast<ShaderDataType>(layoutData[i]);
        std::string name = "a_attr" + std::to_string(i);
        s_attrs.emplace_back(type, name);
    }

    VertexLayout layout;
    if (layoutCount == 1) {
        layout = { s_attrs[0] };
    } else if (layoutCount == 2) {
        layout = { s_attrs[0], s_attrs[1] };
    } else if (layoutCount == 3) {
        layout = { s_attrs[0], s_attrs[1], s_attrs[2] };
    } else if (layoutCount == 4) {
        layout = { s_attrs[0], s_attrs[1], s_attrs[2], s_attrs[3] };
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

void draw_mesh(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr) {
    if (!g_initialized || !g_geometryManager || !g_resourceManager) return;

    auto* geom = g_geometryManager->get(geometryHandle);
    if (!geom || !geom->isValid()) return;

    Shader* shader = g_resourceManager->getShader(resource::ShaderHandle(shaderHandle));
    if (!shader) return;

    flushImmediateDrawIfActive();

    const f32* transformData = reinterpret_cast<const f32*>(transformPtr);
    glm::mat4 transform = glm::make_mat4(transformData);

    shader->bind();
    shader->setUniform("u_projection", g_currentViewProjection);
    shader->setUniform("u_model", transform);

    geom->bind();

    if (geom->hasIndices()) {
        auto* ib = geom->getVAO() ? geom->getVAO()->getIndexBuffer().get() : nullptr;
        if (ib) {
            GLenum type = ib->is16Bit() ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
            glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(geom->getIndexCount()), type, nullptr);
        }
    } else {
        glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(geom->getVertexCount()));
    }

    geom->unbind();
    restoreImmediateDrawState();
}

void draw_meshWithUniforms(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr,
                           uintptr_t uniformsPtr, u32 uniformCount) {
    if (!g_initialized || !g_geometryManager || !g_resourceManager) return;

    auto* geom = g_geometryManager->get(geometryHandle);
    if (!geom || !geom->isValid()) return;

    Shader* shader = g_resourceManager->getShader(resource::ShaderHandle(shaderHandle));
    if (!shader) return;

    flushImmediateDrawIfActive();

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
        auto* ib = geom->getVAO() ? geom->getVAO()->getIndexBuffer().get() : nullptr;
        if (ib) {
            GLenum type = ib->is16Bit() ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
            glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(geom->getIndexCount()), type, nullptr);
        }
    } else {
        glDrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(geom->getVertexCount()));
    }

    geom->unbind();
    restoreImmediateDrawState();
}

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
