#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/Types.hpp"
#include <string>

namespace esengine {

bool postprocess_init(u32 width, u32 height);
void postprocess_shutdown();
void postprocess_resize(u32 width, u32 height);
u32 postprocess_addPass(const std::string& name, u32 shaderHandle);
void postprocess_removePass(const std::string& name);
void postprocess_setPassEnabled(const std::string& name, bool enabled);
bool postprocess_isPassEnabled(const std::string& name);
void postprocess_setUniformFloat(const std::string& passName,
                                  const std::string& uniform, f32 value);
void postprocess_setUniformVec4(const std::string& passName,
                                 const std::string& uniform,
                                 f32 x, f32 y, f32 z, f32 w);
void postprocess_begin();
void postprocess_end();
u32 postprocess_getPassCount();
bool postprocess_isInitialized();
void postprocess_setBypass(bool bypass);
bool postprocess_isBypassed();

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
