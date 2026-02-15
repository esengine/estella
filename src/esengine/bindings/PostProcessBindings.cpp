#ifdef ES_PLATFORM_WEB

#include "PostProcessBindings.hpp"
#include "EngineContext.hpp"
#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/PostProcessPipeline.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif

#include <glm/glm.hpp>

namespace esengine {

static EngineContext& ctx() { return EngineContext::instance(); }

#define g_initialized (ctx().isInitialized())
#define g_renderContext (ctx().renderContext())
#define g_resourceManager (ctx().resourceManager())
#define g_postProcessPipeline (ctx().postProcessPipeline())

bool postprocess_init(u32 width, u32 height) {
    if (!g_initialized || !g_renderContext || !g_resourceManager) return false;

    if (!g_postProcessPipeline) {
        ctx().setPostProcessPipeline(makeUnique<PostProcessPipeline>(*g_renderContext, *g_resourceManager));
    }

    g_postProcessPipeline->init(width, height);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);

    return g_postProcessPipeline->isInitialized();
}

void postprocess_shutdown() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->shutdown();
        ctx().setPostProcessPipeline(nullptr);
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

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
