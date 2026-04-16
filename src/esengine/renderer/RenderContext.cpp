/**
 * @file    RenderContext.cpp
 * @brief   Rendering context implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "RenderContext.hpp"
#include "GfxDevice.hpp"
#include "ShaderEmbeds.generated.hpp"
#include "../resource/ShaderParser.hpp"
#include "../core/Log.hpp"

namespace esengine {

RenderContext::RenderContext(GfxDevice& device)
    : device_(device) {
}

RenderContext::~RenderContext() {
    if (initialized_) {
        shutdown();
    }
}

void RenderContext::init() {
    if (initialized_) {
        ES_LOG_WARN("RenderContext already initialized");
        return;
    }

    device_.init();
    initQuadData();
    initShaders();
    initWhiteTexture();

    initialized_ = true;
}

void RenderContext::shutdown() {
    if (!initialized_) {
        return;
    }

    if (whiteTextureId_ != 0) {
        device_.deleteTexture(whiteTextureId_);
        whiteTextureId_ = 0;
    }

    quadVAO_.reset();
    colorShader_.reset();
    textureShader_.reset();
    extMeshShader_.reset();

    device_.shutdown();
    initialized_ = false;
    ES_LOG_INFO("RenderContext shutdown");
}

void RenderContext::initQuadData() {
    float vertices[] = {
        -0.5f, -0.5f,       0.0f, 0.0f,
         0.5f, -0.5f,       1.0f, 0.0f,
         0.5f,  0.5f,       1.0f, 1.0f,
        -0.5f,  0.5f,       0.0f, 1.0f
    };

    u16 indices[] = { 0, 1, 2, 2, 3, 0 };

    quadVAO_ = VertexArray::create();

    auto vbo = VertexBuffer::createRaw(vertices, sizeof(vertices));
    vbo->setLayout({
        { ShaderDataType::Float2, "a_position" },
        { ShaderDataType::Float2, "a_texCoord" }
    });

    auto ibo = IndexBuffer::create(indices, 6);

    quadVAO_->addVertexBuffer(Shared<VertexBuffer>(std::move(vbo)));
    quadVAO_->setIndexBuffer(Shared<IndexBuffer>(std::move(ibo)));

    ES_LOG_DEBUG("Quad VAO initialized");
}

void RenderContext::initShaders() {
    auto colorParsed = resource::ShaderParser::parse(ShaderEmbeds::COLOR);
    colorShader_ = Shader::create(
        resource::ShaderParser::assembleStage(colorParsed, resource::ShaderStage::Vertex),
        resource::ShaderParser::assembleStage(colorParsed, resource::ShaderStage::Fragment)
    );

    auto spriteParsed = resource::ShaderParser::parse(ShaderEmbeds::SPRITE);
    textureShader_ = Shader::create(
        resource::ShaderParser::assembleStage(spriteParsed, resource::ShaderStage::Vertex),
        resource::ShaderParser::assembleStage(spriteParsed, resource::ShaderStage::Fragment)
    );

    extMeshShader_ = Shader::createWithBindings(
        ShaderSources::EXT_MESH_VERTEX,
        ShaderSources::EXT_MESH_FRAGMENT,
        {{0, "a_position"}, {1, "a_texCoord"}, {2, "a_color"}}
    );

    ES_LOG_DEBUG("Shaders initialized");
}

void RenderContext::initWhiteTexture() {
    whiteTextureId_ = device_.createTexture();

    u32 whiteData = 0xFFFFFFFF;
    device_.texImage2D(whiteTextureId_, 1, 1, GfxPixelFormat::RGBA8, &whiteData);
    device_.setTextureParams(whiteTextureId_, TextureFilter::Nearest, TextureFilter::Nearest,
                             TextureWrap::ClampToEdge, TextureWrap::ClampToEdge);

    ES_LOG_DEBUG("White texture created (ID: {})", whiteTextureId_);
}

}  // namespace esengine
