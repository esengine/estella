#pragma once

#ifdef ES_PLATFORM_WEB

#include "../core/Types.hpp"

namespace esengine {

u32 geometry_create();
void geometry_init(u32 handle, uintptr_t verticesPtr, u32 vertexCount,
                   uintptr_t layoutPtr, u32 layoutCount, bool dynamic);
void geometry_setIndices16(u32 handle, uintptr_t indicesPtr, u32 indexCount);
void geometry_setIndices32(u32 handle, uintptr_t indicesPtr, u32 indexCount);
void geometry_updateVertices(u32 handle, uintptr_t verticesPtr, u32 vertexCount, u32 offset);
void geometry_release(u32 handle);
bool geometry_isValid(u32 handle);

void draw_mesh(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr);
void draw_meshWithUniforms(u32 geometryHandle, u32 shaderHandle, uintptr_t transformPtr,
                           uintptr_t uniformsPtr, u32 uniformCount);

}  // namespace esengine

#endif  // ES_PLATFORM_WEB
