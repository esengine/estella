/**
 * @file    UIBatchRenderer.cpp
 * @brief   Batched UI rendering implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "UIBatchRenderer.hpp"
#include "../../core/Log.hpp"
#include "../../renderer/Buffer.hpp"
#include "../../renderer/RenderCommand.hpp"
#include "../../renderer/RenderContext.hpp"
#include "../../renderer/Shader.hpp"
#include "../layout/SizeValue.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/SDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../font/BitmapFont.hpp"
#endif

#include <array>
#include <cmath>
#include <vector>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
    #ifndef GL_VIEWPORT
        #define GL_VIEWPORT 0x0BA2
    #endif
#endif

namespace esengine::ui {

// =============================================================================
// Constants
// =============================================================================

constexpr u32 MAX_QUADS = 5000;
constexpr u32 MAX_VERTICES = MAX_QUADS * 4;
constexpr u32 MAX_INDICES = MAX_QUADS * 6;
constexpr u32 MAX_TEXTURE_SLOTS = 8;

// =============================================================================
// Vertex Structure
// =============================================================================

struct UIVertex {
    glm::vec3 position;
    glm::vec4 color;
    glm::vec2 texCoord;
    glm::vec4 cornerRadii;
    glm::vec2 rectSize;
    glm::vec2 localPos;
    f32 texIndex;
    f32 borderThickness;
};


// =============================================================================
// Shader Sources
// =============================================================================

#ifdef ES_PLATFORM_WEB
// WebGL 1.0 shaders (GLSL ES 1.0)
static const char* UI_VERTEX_SHADER = R"(
    attribute vec3 a_position;
    attribute vec4 a_color;
    attribute vec2 a_texCoord;
    attribute vec4 a_cornerRadii;
    attribute vec2 a_rectSize;
    attribute vec2 a_localPos;
    attribute float a_texIndex;
    attribute float a_borderThickness;

    uniform mat4 u_projection;

    varying vec4 v_color;
    varying vec2 v_texCoord;
    varying vec4 v_cornerRadii;
    varying vec2 v_rectSize;
    varying vec2 v_localPos;
    varying float v_texIndex;
    varying float v_borderThickness;

    void main() {
        gl_Position = u_projection * vec4(a_position, 1.0);
        v_color = a_color;
        v_texCoord = a_texCoord;
        v_cornerRadii = a_cornerRadii;
        v_rectSize = a_rectSize;
        v_localPos = a_localPos;
        v_texIndex = a_texIndex;
        v_borderThickness = a_borderThickness;
    }
)";

static const char* UI_FRAGMENT_SHADER = R"(
    precision mediump float;

    varying vec4 v_color;
    varying vec2 v_texCoord;
    varying vec4 v_cornerRadii;
    varying vec2 v_rectSize;
    varying vec2 v_localPos;
    varying float v_texIndex;
    varying float v_borderThickness;

    uniform sampler2D u_textures[8];

    float sdRoundedBox(vec2 p, vec2 b, vec4 r) {
        r.xy = (p.x > 0.0) ? r.xy : r.wz;
        r.x = (p.y > 0.0) ? r.x : r.y;
        vec2 q = abs(p) - b + r.x;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
    }

    void main() {
        vec4 texColor = vec4(1.0);
        int index = int(v_texIndex);

        if (index == 0) texColor = texture2D(u_textures[0], v_texCoord);
        else if (index == 1) texColor = texture2D(u_textures[1], v_texCoord);
        else if (index == 2) texColor = texture2D(u_textures[2], v_texCoord);
        else if (index == 3) texColor = texture2D(u_textures[3], v_texCoord);
        else if (index == 4) texColor = texture2D(u_textures[4], v_texCoord);
        else if (index == 5) texColor = texture2D(u_textures[5], v_texCoord);
        else if (index == 6) texColor = texture2D(u_textures[6], v_texCoord);
        else if (index == 7) texColor = texture2D(u_textures[7], v_texCoord);

        vec4 color;

        // SDF text rendering: borderThickness < -1.0 indicates SDF mode
        if (v_borderThickness < -1.0) {
            float screenPxRange = -v_borderThickness - 1.0;
            float sd = texColor.r;
            float edgeWidth = 0.5 / max(screenPxRange, 1.0);
            float alpha = smoothstep(0.5 - edgeWidth, 0.5 + edgeWidth, sd);
            color = vec4(v_color.rgb, alpha * v_color.a);
        }
        // Bitmap font rendering
        else if (texColor.g == 0.0 && texColor.b == 0.0 && texColor.a == 1.0) {
            color = vec4(v_color.rgb, texColor.r * v_color.a);
        } else {
            color = texColor * v_color;
        }

        if (v_cornerRadii.x > 0.0 || v_cornerRadii.y > 0.0 ||
            v_cornerRadii.z > 0.0 || v_cornerRadii.w > 0.0) {
            vec2 halfSize = v_rectSize * 0.5;
            float dist = sdRoundedBox(v_localPos, halfSize, v_cornerRadii);

            float smoothing = 1.0;
            float alpha = 1.0 - smoothstep(-smoothing, smoothing, dist);

            if (v_borderThickness > 0.0) {
                float innerDist = dist + v_borderThickness;
                float innerAlpha = 1.0 - smoothstep(-smoothing, smoothing, innerDist);
                alpha = alpha - innerAlpha;
            }

            color.a *= alpha;
        }

        if (color.a < 0.01) discard;

        gl_FragColor = color;
    }
)";

#else
// OpenGL 3.3 Core shaders
static const char* UI_VERTEX_SHADER = R"(
    #version 330 core

    layout(location = 0) in vec3 a_position;
    layout(location = 1) in vec4 a_color;
    layout(location = 2) in vec2 a_texCoord;
    layout(location = 3) in vec4 a_cornerRadii;
    layout(location = 4) in vec2 a_rectSize;
    layout(location = 5) in vec2 a_localPos;
    layout(location = 6) in float a_texIndex;
    layout(location = 7) in float a_borderThickness;

    uniform mat4 u_projection;

    out vec4 v_color;
    out vec2 v_texCoord;
    out vec4 v_cornerRadii;
    out vec2 v_rectSize;
    out vec2 v_localPos;
    flat out int v_texIndex;
    out float v_borderThickness;

    void main() {
        gl_Position = u_projection * vec4(a_position, 1.0);
        v_color = a_color;
        v_texCoord = a_texCoord;
        v_cornerRadii = a_cornerRadii;
        v_rectSize = a_rectSize;
        v_localPos = a_localPos;
        v_texIndex = int(a_texIndex);
        v_borderThickness = a_borderThickness;
    }
)";

static const char* UI_FRAGMENT_SHADER = R"(
    #version 330 core

    in vec4 v_color;
    in vec2 v_texCoord;
    in vec4 v_cornerRadii;
    in vec2 v_rectSize;
    in vec2 v_localPos;
    flat in int v_texIndex;
    in float v_borderThickness;

    uniform sampler2D u_textures[8];

    out vec4 fragColor;

    float sdRoundedBox(vec2 p, vec2 b, vec4 r) {
        r.xy = (p.x > 0.0) ? r.xy : r.wz;
        r.x = (p.y > 0.0) ? r.x : r.y;
        vec2 q = abs(p) - b + r.x;
        return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
    }

    void main() {
        vec4 texColor = texture(u_textures[v_texIndex], v_texCoord);
        vec4 color;

        // SDF text rendering: borderThickness < -1.0 indicates SDF mode
        // The absolute value encodes the screen pixel range
        if (v_borderThickness < -1.0) {
            float screenPxRange = -v_borderThickness - 1.0;
            float sd = texColor.r;
            // FreeType SDF: 0.5 = edge, >0.5 = inside, <0.5 = outside
            float edgeWidth = 0.5 / max(screenPxRange, 1.0);
            float alpha = smoothstep(0.5 - edgeWidth, 0.5 + edgeWidth, sd);
            color = vec4(v_color.rgb, alpha * v_color.a);
        }
        // Bitmap font rendering (R8 texture)
        else if (texColor.g == 0.0 && texColor.b == 0.0 && texColor.a == 1.0) {
            color = vec4(v_color.rgb, texColor.r * v_color.a);
        } else {
            color = texColor * v_color;
        }

        if (v_cornerRadii.x > 0.0 || v_cornerRadii.y > 0.0 ||
            v_cornerRadii.z > 0.0 || v_cornerRadii.w > 0.0) {
            vec2 halfSize = v_rectSize * 0.5;
            float dist = sdRoundedBox(v_localPos, halfSize, v_cornerRadii);

            float smoothing = 1.0;
            float alpha = 1.0 - smoothstep(-smoothing, smoothing, dist);

            if (v_borderThickness > 0.0) {
                float innerDist = dist + v_borderThickness;
                float innerAlpha = 1.0 - smoothstep(-smoothing, smoothing, innerDist);
                alpha = alpha - innerAlpha;
            }

            color.a *= alpha;
        }

        if (color.a < 0.01) discard;

        fragColor = color;
    }
)";
#endif

// =============================================================================
// BatchData Implementation
// =============================================================================

struct UIBatchRenderer::BatchData {
    Unique<VertexArray> vao;
    Shared<VertexBuffer> vbo;
    Unique<Shader> shader;

    std::vector<UIVertex> vertices;
    u32 indexCount = 0;

    std::array<u32, MAX_TEXTURE_SLOTS> textureSlots{};
    u32 textureSlotIndex = 1;

    glm::mat4 projection{1.0f};
    f32 devicePixelRatio = 1.0f;

    std::vector<Rect> clipStack;
    Rect currentClip;
    bool clipEnabled = false;

    UIRenderStats stats;
    bool initialized = false;
    bool inFrame = false;
};

// =============================================================================
// Constructor / Destructor
// =============================================================================

UIBatchRenderer::UIBatchRenderer(RenderContext& context)
    : context_(context), data_(makeUnique<BatchData>()) {}

UIBatchRenderer::~UIBatchRenderer() {
    if (data_ && data_->initialized) {
        shutdown();
    }
}

// =============================================================================
// Lifecycle
// =============================================================================

void UIBatchRenderer::init() {
    if (data_->initialized) return;

    data_->vertices.reserve(MAX_VERTICES);

#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    data_->vao = VertexArray::create();

    data_->vbo = makeShared<VertexBuffer>();
    *data_->vbo = std::move(*VertexBuffer::create(MAX_VERTICES * sizeof(UIVertex)));
    data_->vbo->setLayout({
        {ShaderDataType::Float3, "a_position"},
        {ShaderDataType::Float4, "a_color"},
        {ShaderDataType::Float2, "a_texCoord"},
        {ShaderDataType::Float4, "a_cornerRadii"},
        {ShaderDataType::Float2, "a_rectSize"},
        {ShaderDataType::Float2, "a_localPos"},
        {ShaderDataType::Float, "a_texIndex"},
        {ShaderDataType::Float, "a_borderThickness"}
    });

    data_->vao->addVertexBuffer(data_->vbo);

    std::vector<u32> indices(MAX_INDICES);
    u32 offset = 0;
    for (u32 i = 0; i < MAX_INDICES; i += 6) {
        indices[i + 0] = offset + 0;
        indices[i + 1] = offset + 1;
        indices[i + 2] = offset + 2;
        indices[i + 3] = offset + 2;
        indices[i + 4] = offset + 3;
        indices[i + 5] = offset + 0;
        offset += 4;
    }
    auto ibo = IndexBuffer::create(indices.data(), MAX_INDICES);
    data_->vao->setIndexBuffer(Shared<IndexBuffer>(std::move(ibo)));

    data_->shader = Shader::create(UI_VERTEX_SHADER, UI_FRAGMENT_SHADER);
    ES_LOG_DEBUG("UIBatchRenderer shader ID: {}", data_->shader ? data_->shader->getProgramId() : 0);

    data_->textureSlots[0] = context_.getWhiteTextureId();
    ES_LOG_DEBUG("UIBatchRenderer white texture ID: {}", data_->textureSlots[0]);
    for (u32 i = 1; i < MAX_TEXTURE_SLOTS; ++i) {
        data_->textureSlots[i] = 0;
    }
#endif

    data_->initialized = true;
    ES_LOG_INFO("UIBatchRenderer initialized (max {} quads per batch)", MAX_QUADS);
}

void UIBatchRenderer::shutdown() {
    if (!data_ || !data_->initialized) return;

    data_->vao.reset();
    data_->vbo.reset();
    data_->shader.reset();
    data_->initialized = false;

    ES_LOG_INFO("UIBatchRenderer shutdown");
}

bool UIBatchRenderer::isInitialized() const {
    return data_ && data_->initialized;
}

// =============================================================================
// Frame Management
// =============================================================================

void UIBatchRenderer::begin(const glm::mat4& projection, f32 devicePixelRatio) {
    data_->projection = projection;
    data_->devicePixelRatio = devicePixelRatio > 0.0f ? devicePixelRatio : 1.0f;
    data_->inFrame = true;
    data_->stats.reset();

    data_->vertices.clear();
    data_->indexCount = 0;
    data_->textureSlotIndex = 1;

    data_->clipStack.clear();
    data_->clipEnabled = false;

#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    RenderCommand::setDepthTest(false);
    RenderCommand::setBlending(true);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
#endif
}

void UIBatchRenderer::end() {
    flush();
    data_->inFrame = false;

#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glDisable(GL_SCISSOR_TEST);
#endif
}

void UIBatchRenderer::flush() {
    flushQuadBatch();
}

void UIBatchRenderer::flushQuadBatch() {
    if (data_->vertices.empty()) return;

#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    data_->vbo->setDataRaw(data_->vertices.data(),
                           static_cast<u32>(data_->vertices.size() * sizeof(UIVertex)));

    for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
        glActiveTexture(GL_TEXTURE0 + i);
        glBindTexture(GL_TEXTURE_2D, data_->textureSlots[i]);
    }

    data_->shader->bind();
    data_->shader->setUniform("u_projection", data_->projection);

    i32 samplers[MAX_TEXTURE_SLOTS] = {0, 1, 2, 3, 4, 5, 6, 7};
    if (!data_->shader) {
        return;
    }
    GLint loc = glGetUniformLocation(data_->shader->getProgramId(), "u_textures");
    glUniform1iv(loc, MAX_TEXTURE_SLOTS, samplers);

    RenderCommand::drawIndexed(*data_->vao, data_->indexCount);

    data_->stats.drawCalls++;
#endif

    data_->vertices.clear();
    data_->indexCount = 0;
    data_->textureSlotIndex = 1;
}

void UIBatchRenderer::flushTextBatch() {
    flushQuadBatch();
}

// =============================================================================
// Clipping
// =============================================================================

void UIBatchRenderer::pushClipRect(const Rect& rect) {
    flush();

    Rect newClip = rect;
    if (!data_->clipStack.empty()) {
        newClip = data_->currentClip.intersect(rect);
    }

    data_->clipStack.push_back(rect);
    data_->currentClip = newClip;
    data_->clipEnabled = true;
    data_->stats.clipChanges++;

    applyScissor();
}

void UIBatchRenderer::popClipRect() {
    if (data_->clipStack.empty()) return;

    flush();

    data_->clipStack.pop_back();
    data_->stats.clipChanges++;

    if (data_->clipStack.empty()) {
        data_->clipEnabled = false;
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
        glDisable(GL_SCISSOR_TEST);
#endif
    } else {
        data_->currentClip = data_->clipStack[0];
        for (usize i = 1; i < data_->clipStack.size(); ++i) {
            data_->currentClip = data_->currentClip.intersect(data_->clipStack[i]);
        }
        applyScissor();
    }
}

Rect UIBatchRenderer::getCurrentClipRect() const {
    return data_->clipEnabled ? data_->currentClip : Rect();
}

void UIBatchRenderer::applyScissor() {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    if (!data_->clipEnabled || data_->currentClip.isEmpty()) {
        glDisable(GL_SCISSOR_TEST);
        return;
    }

    glEnable(GL_SCISSOR_TEST);

    f32 dpr = data_->devicePixelRatio;
    i32 x = static_cast<i32>(data_->currentClip.x * dpr);
    i32 y = static_cast<i32>(data_->currentClip.y * dpr);
    i32 w = static_cast<i32>(data_->currentClip.width * dpr);
    i32 h = static_cast<i32>(data_->currentClip.height * dpr);

    GLint viewport[4];
    glGetIntegerv(GL_VIEWPORT, viewport);
    i32 viewportHeight = viewport[3];

    glScissor(x, viewportHeight - y - h, w, h);
#endif
}

// =============================================================================
// Primitive Drawing
// =============================================================================

void UIBatchRenderer::addQuadVertices(const Rect& rect, const glm::vec4& color,
                                       const glm::vec4& radii, f32 borderThickness,
                                       u32 textureIndex, const glm::vec2& uvMin,
                                       const glm::vec2& uvMax) {
    if (data_->vertices.size() >= MAX_VERTICES) {
        flush();
    }

    f32 texIdx = static_cast<f32>(textureIndex);
    glm::vec2 rectSize = {rect.width, rect.height};
    glm::vec2 halfSize = rectSize * 0.5f;

    UIVertex vertices[4];

    vertices[0].position = {rect.x, rect.y, 0.0f};
    vertices[0].texCoord = uvMin;
    vertices[0].localPos = {-halfSize.x, -halfSize.y};

    vertices[1].position = {rect.right(), rect.y, 0.0f};
    vertices[1].texCoord = {uvMax.x, uvMin.y};
    vertices[1].localPos = {halfSize.x, -halfSize.y};

    vertices[2].position = {rect.right(), rect.bottom(), 0.0f};
    vertices[2].texCoord = uvMax;
    vertices[2].localPos = halfSize;

    vertices[3].position = {rect.x, rect.bottom(), 0.0f};
    vertices[3].texCoord = {uvMin.x, uvMax.y};
    vertices[3].localPos = {-halfSize.x, halfSize.y};

    for (auto& v : vertices) {
        v.color = color;
        v.cornerRadii = radii;
        v.rectSize = rectSize;
        v.texIndex = texIdx;
        v.borderThickness = borderThickness;
        data_->vertices.push_back(v);
    }

    data_->indexCount += 6;
    data_->stats.quadCount++;
}

void UIBatchRenderer::drawRect(const Rect& rect, const glm::vec4& color) {
    addQuadVertices(rect, color, {0, 0, 0, 0}, 0.0f, 0, {0, 0}, {1, 1});
}

void UIBatchRenderer::drawRoundedRect(const Rect& rect, const glm::vec4& color,
                                       const CornerRadii& radii) {
    addQuadVertices(rect, color, radii.toVec4(), 0.0f, 0, {0, 0}, {1, 1});
}

void UIBatchRenderer::drawRoundedRectOutline(const Rect& rect, const glm::vec4& color,
                                              const CornerRadii& radii, f32 thickness) {
    addQuadVertices(rect, color, radii.toVec4(), thickness, 0, {0, 0}, {1, 1});
}

void UIBatchRenderer::drawTexturedRect(const Rect& rect, u32 textureId, const glm::vec4& tint,
                                        const glm::vec2& uvMin, const glm::vec2& uvMax) {
    if (data_->vertices.size() >= MAX_VERTICES) {
        flush();
    }

    u32 texIndex = 0;
    if (textureId != 0) {
        bool found = false;
        for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
            if (data_->textureSlots[i] == textureId) {
                texIndex = i;
                found = true;
                break;
            }
        }
        if (!found) {
            if (data_->textureSlotIndex >= MAX_TEXTURE_SLOTS) {
                flush();
            }
            data_->textureSlots[data_->textureSlotIndex] = textureId;
            texIndex = data_->textureSlotIndex;
            data_->textureSlotIndex++;
        }
    }

    addQuadVertices(rect, tint, {0, 0, 0, 0}, 0.0f, texIndex, uvMin, uvMax);
}

void UIBatchRenderer::drawLine(const glm::vec2& p1, const glm::vec2& p2, const glm::vec4& color,
                                f32 thickness) {
    glm::vec2 dir = p2 - p1;
    f32 length = glm::length(dir);
    if (length < 0.001f) return;

    dir /= length;
    glm::vec2 normal = {-dir.y, dir.x};

    glm::vec2 offset = normal * (thickness * 0.5f);

    if (data_->vertices.size() >= MAX_VERTICES) {
        flush();
    }

    UIVertex vertices[4];

    vertices[0].position = {p1.x - offset.x, p1.y - offset.y, 0.0f};
    vertices[0].texCoord = {0, 0};
    vertices[0].localPos = {0, 0};

    vertices[1].position = {p1.x + offset.x, p1.y + offset.y, 0.0f};
    vertices[1].texCoord = {0, 1};
    vertices[1].localPos = {0, 0};

    vertices[2].position = {p2.x + offset.x, p2.y + offset.y, 0.0f};
    vertices[2].texCoord = {1, 1};
    vertices[2].localPos = {0, 0};

    vertices[3].position = {p2.x - offset.x, p2.y - offset.y, 0.0f};
    vertices[3].texCoord = {1, 0};
    vertices[3].localPos = {0, 0};

    for (auto& v : vertices) {
        v.color = color;
        v.cornerRadii = {0, 0, 0, 0};
        v.rectSize = {0, 0};
        v.texIndex = 0;
        v.borderThickness = 0;
        data_->vertices.push_back(v);
    }

    data_->indexCount += 6;
    data_->stats.quadCount++;
}

// =============================================================================
// Text Drawing
// =============================================================================

namespace {

u32 nextCodepoint(const std::string& text, usize& i) {
    u8 c = static_cast<u8>(text[i]);
    u32 codepoint = 0;

    if ((c & 0x80) == 0) {
        codepoint = c;
        i += 1;
    } else if ((c & 0xE0) == 0xC0) {
        codepoint = c & 0x1F;
        if (i + 1 < text.size()) {
            codepoint = (codepoint << 6) | (static_cast<u8>(text[i + 1]) & 0x3F);
        }
        i += 2;
    } else if ((c & 0xF0) == 0xE0) {
        codepoint = c & 0x0F;
        if (i + 2 < text.size()) {
            codepoint = (codepoint << 6) | (static_cast<u8>(text[i + 1]) & 0x3F);
            codepoint = (codepoint << 6) | (static_cast<u8>(text[i + 2]) & 0x3F);
        }
        i += 3;
    } else if ((c & 0xF8) == 0xF0) {
        codepoint = c & 0x07;
        if (i + 3 < text.size()) {
            codepoint = (codepoint << 6) | (static_cast<u8>(text[i + 1]) & 0x3F);
            codepoint = (codepoint << 6) | (static_cast<u8>(text[i + 2]) & 0x3F);
            codepoint = (codepoint << 6) | (static_cast<u8>(text[i + 3]) & 0x3F);
        }
        i += 4;
    } else {
        i += 1;
    }
    return codepoint;
}

}  // namespace

#if ES_FEATURE_SDF_FONT
void UIBatchRenderer::drawText(const std::string& text, const glm::vec2& position,
                                SDFFont& font, f32 fontSize, const glm::vec4& color) {
    if (text.empty()) return;

    f32 x = position.x;
    f32 y = position.y;
    f32 scale = fontSize / font.getSDFSize();

    u32 atlasTexture = font.getAtlasTextureId();
    if (atlasTexture == 0) return;

    u32 texIndex = 0;
    bool found = false;
    for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
        if (data_->textureSlots[i] == atlasTexture) {
            texIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        if (data_->textureSlotIndex >= MAX_TEXTURE_SLOTS) {
            flush();
        }
        data_->textureSlots[data_->textureSlotIndex] = atlasTexture;
        texIndex = data_->textureSlotIndex;
        data_->textureSlotIndex++;
    }

    // Calculate screen pixel range for SDF sharpness
    // screenPxRange = fontSize / sdfSize * sdfSpread
    f32 screenPxRange = fontSize / font.getSDFSize() * font.getSDFSpread();
    // Encode as negative borderThickness: value = -(screenPxRange + 1.0)
    f32 sdfBorderFlag = -(screenPxRange + 1.0f);

    usize i = 0;
    while (i < text.size()) {
        u32 codepoint = nextCodepoint(text, i);

        if (codepoint == '\n') {
            x = position.x;
            y += fontSize * 1.2f;
            continue;
        }

        const auto* glyph = font.getGlyph(codepoint);
        if (!glyph) continue;

        f32 xPos = std::round(x + glyph->bearingX * scale);
        f32 yPos = std::round(y + (font.getAscent() - glyph->bearingY) * scale);
        f32 w = glyph->width * scale;
        f32 h = glyph->height * scale;

        if (w > 0 && h > 0) {
            if (data_->vertices.size() >= MAX_VERTICES) {
                flush();
            }

            f32 texIdx = static_cast<f32>(texIndex);
            Rect glyphRect(xPos, yPos, w, h);
            glm::vec2 rectSize = {w, h};
            glm::vec2 halfSize = rectSize * 0.5f;

            UIVertex vertices[4];

            vertices[0].position = {glyphRect.x, glyphRect.y, 0.0f};
            vertices[0].texCoord = {glyph->u0, glyph->v0};
            vertices[0].localPos = {-halfSize.x, -halfSize.y};

            vertices[1].position = {glyphRect.right(), glyphRect.y, 0.0f};
            vertices[1].texCoord = {glyph->u1, glyph->v0};
            vertices[1].localPos = {halfSize.x, -halfSize.y};

            vertices[2].position = {glyphRect.right(), glyphRect.bottom(), 0.0f};
            vertices[2].texCoord = {glyph->u1, glyph->v1};
            vertices[2].localPos = halfSize;

            vertices[3].position = {glyphRect.x, glyphRect.bottom(), 0.0f};
            vertices[3].texCoord = {glyph->u0, glyph->v1};
            vertices[3].localPos = {-halfSize.x, halfSize.y};

            for (auto& v : vertices) {
                v.color = color;
                v.cornerRadii = {0, 0, 0, 0};
                v.rectSize = rectSize;
                v.texIndex = texIdx;
                v.borderThickness = sdfBorderFlag;
                data_->vertices.push_back(v);
            }

            data_->indexCount += 6;
            data_->stats.textQuadCount++;
        }

        x += glyph->advance * scale;
    }
}

void UIBatchRenderer::drawTextInBounds(const std::string& text, const Rect& bounds,
                                        SDFFont& font, f32 fontSize, const glm::vec4& color,
                                        HAlign hAlign, VAlign vAlign) {
    if (text.empty()) return;

    glm::vec2 textSize = font.measureText(text, fontSize);
    f32 scale = fontSize / font.getSDFSize();
    f32 ascent = font.getAscent() * scale;
    f32 descent = font.getDescent() * scale;
    f32 visualHeight = ascent + descent;

    f32 x = bounds.x;
    f32 y = bounds.y;

    switch (hAlign) {
        case HAlign::Left:
            break;
        case HAlign::Center:
            x += (bounds.width - textSize.x) * 0.5f;
            break;
        case HAlign::Right:
            x += bounds.width - textSize.x;
            break;
        case HAlign::Stretch:
            break;
    }

    switch (vAlign) {
        case VAlign::Top:
            break;
        case VAlign::Center:
            y += (bounds.height - visualHeight) * 0.5f;
            break;
        case VAlign::Bottom:
            y += bounds.height - visualHeight;
            break;
        case VAlign::Stretch:
            break;
    }

    x = std::round(x);
    y = std::round(y);
    drawText(text, {x, y}, font, fontSize, color);
}
#endif  // ES_FEATURE_SDF_FONT

#if ES_FEATURE_BITMAP_FONT
void UIBatchRenderer::drawText(const std::string& text, const glm::vec2& position,
                                BitmapFont& font, f32 fontSize, const glm::vec4& color) {
    if (text.empty()) return;

    f32 x = position.x;
    f32 y = position.y;
    f32 scale = fontSize / font.getFontSize();

    u32 atlasTexture = font.getTextureId();
    if (atlasTexture == 0) return;

    u32 texIndex = 0;
    bool found = false;
    for (u32 i = 0; i < data_->textureSlotIndex; ++i) {
        if (data_->textureSlots[i] == atlasTexture) {
            texIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        if (data_->textureSlotIndex >= MAX_TEXTURE_SLOTS) {
            flush();
        }
        data_->textureSlots[data_->textureSlotIndex] = atlasTexture;
        texIndex = data_->textureSlotIndex;
        data_->textureSlotIndex++;
    }

    usize i = 0;
    while (i < text.size()) {
        u32 codepoint = nextCodepoint(text, i);

        if (codepoint == '\n') {
            x = position.x;
            y += fontSize * 1.2f;
            continue;
        }

        const auto* glyph = font.getGlyph(codepoint);
        if (!glyph) continue;

        f32 xPos = std::round(x + glyph->bearingX * scale);
        f32 yPos = std::round(y + (font.getAscent() - glyph->bearingY) * scale);
        f32 w = glyph->width * scale;
        f32 h = glyph->height * scale;

        if (w > 0 && h > 0) {
            if (data_->vertices.size() >= MAX_VERTICES) {
                flush();
            }

            f32 texIdx = static_cast<f32>(texIndex);
            Rect glyphRect(xPos, yPos, w, h);
            glm::vec2 rectSize = {w, h};
            glm::vec2 halfSize = rectSize * 0.5f;

            UIVertex vertices[4];

            vertices[0].position = {glyphRect.x, glyphRect.y, 0.0f};
            vertices[0].texCoord = {glyph->u0, glyph->v0};
            vertices[0].localPos = {-halfSize.x, -halfSize.y};

            vertices[1].position = {glyphRect.right(), glyphRect.y, 0.0f};
            vertices[1].texCoord = {glyph->u1, glyph->v0};
            vertices[1].localPos = {halfSize.x, -halfSize.y};

            vertices[2].position = {glyphRect.right(), glyphRect.bottom(), 0.0f};
            vertices[2].texCoord = {glyph->u1, glyph->v1};
            vertices[2].localPos = halfSize;

            vertices[3].position = {glyphRect.x, glyphRect.bottom(), 0.0f};
            vertices[3].texCoord = {glyph->u0, glyph->v1};
            vertices[3].localPos = {-halfSize.x, halfSize.y};

            for (auto& v : vertices) {
                v.color = color;
                v.cornerRadii = {0, 0, 0, 0};
                v.rectSize = rectSize;
                v.texIndex = texIdx;
                v.borderThickness = 0.0f;  // Bitmap font uses regular texture sampling
                data_->vertices.push_back(v);
            }

            data_->indexCount += 6;
            data_->stats.textQuadCount++;
        }

        x += glyph->advance * scale;
    }
}

void UIBatchRenderer::drawTextInBounds(const std::string& text, const Rect& bounds,
                                        BitmapFont& font, f32 fontSize, const glm::vec4& color,
                                        HAlign hAlign, VAlign vAlign) {
    if (text.empty()) return;

    glm::vec2 textSize = font.measureText(text, fontSize);
    f32 scale = fontSize / font.getFontSize();
    f32 ascent = font.getAscent() * scale;
    f32 descent = font.getDescent() * scale;
    f32 visualHeight = ascent + descent;

    f32 x = bounds.x;
    f32 y = bounds.y;

    switch (hAlign) {
        case HAlign::Left:
            break;
        case HAlign::Center:
            x += (bounds.width - textSize.x) * 0.5f;
            break;
        case HAlign::Right:
            x += bounds.width - textSize.x;
            break;
        case HAlign::Stretch:
            break;
    }

    switch (vAlign) {
        case VAlign::Top:
            break;
        case VAlign::Center:
            y += (bounds.height - visualHeight) * 0.5f;
            break;
        case VAlign::Bottom:
            y += bounds.height - visualHeight;
            break;
        case VAlign::Stretch:
            break;
    }

    x = std::round(x);
    y = std::round(y);
    drawText(text, {x, y}, font, fontSize, color);
}
#endif  // ES_FEATURE_BITMAP_FONT

// =============================================================================
// Statistics
// =============================================================================

const UIRenderStats& UIBatchRenderer::getStats() const {
    return data_->stats;
}

void UIBatchRenderer::resetStats() {
    data_->stats.reset();
}

}  // namespace esengine::ui
