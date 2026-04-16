#ifdef ES_PLATFORM_WEB
#ifdef ES_ENABLE_POSTPROCESS

#include "PostProcessBindings.hpp"
#include "ActiveContext.hpp"
#include "../renderer/OpenGLHeaders.hpp"
#include "../renderer/GfxDevice.hpp"
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

static EstellaContext& ctx() { return activeCtx(); }

#define g_device (ctx().tryGet<GfxDevice>())
#define g_initialized (ctx().state().initialized)
#define g_renderContext (ctx().tryGet<RenderContext>())
#define g_resourceManager (ctx().tryGet<resource::ResourceManager>())
#define g_postProcessPipeline (ctx().tryGet<PostProcessPipeline>())

bool postprocess_init(u32 width, u32 height) {
    if (!g_initialized || !g_renderContext || !g_resourceManager) return false;

    if (!g_postProcessPipeline) {
        ctx().services().registerOwned<PostProcessPipeline>(
            makeUnique<PostProcessPipeline>(ctx().require<GfxDevice>(), *g_renderContext, *g_resourceManager));
    }

    g_postProcessPipeline->init(width, height);
    g_device->bindFramebuffer(0);

    return g_postProcessPipeline->isInitialized();
}

void postprocess_shutdown() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->shutdown();
        ctx().services().removeService<PostProcessPipeline>();
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

void postprocess_clearPasses() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->clearPasses();
    }
}

void postprocess_setOutputTarget(u32 fboId) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setOutputTarget(fboId);
    }
}

void postprocess_setOutputViewport(u32 x, u32 y, u32 w, u32 h) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setOutputViewport(x, y, w, h);
    }
}

void postprocess_beginScreenCapture() {
    if (!g_postProcessPipeline) return;
    g_postProcessPipeline->beginScreenCapture();
}

void postprocess_endScreenCapture() {
    if (!g_postProcessPipeline) return;
    g_postProcessPipeline->endScreenCapture();
}

void postprocess_executeScreenPasses() {
    if (!g_postProcessPipeline) return;
    g_postProcessPipeline->executeScreenPasses();
}

u32 postprocess_addScreenPass(const std::string& name, u32 shaderHandle) {
    if (!g_postProcessPipeline) return 0;
    return g_postProcessPipeline->addScreenPass(name, resource::ShaderHandle(shaderHandle));
}

void postprocess_clearScreenPasses() {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->clearScreenPasses();
    }
}

void postprocess_setScreenUniformFloat(const std::string& passName,
                                        const std::string& uniform, f32 value) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setScreenPassUniformFloat(passName, uniform, value);
    }
}

void postprocess_setScreenUniformVec4(const std::string& passName,
                                       const std::string& uniform,
                                       f32 x, f32 y, f32 z, f32 w) {
    if (g_postProcessPipeline) {
        g_postProcessPipeline->setScreenPassUniformVec4(passName, uniform, glm::vec4(x, y, z, w));
    }
}

}  // namespace esengine

#endif  // ES_ENABLE_POSTPROCESS
#endif  // ES_PLATFORM_WEB
