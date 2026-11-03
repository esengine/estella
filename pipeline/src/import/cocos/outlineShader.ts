// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The outline a Cocos effect draws as a pass of its own.
 *
 * Cocos draws such a mesh twice: first pushed out along its normals and shown from behind (a front-face cull), in one colour; then as the surface. The
 * engine has one material to a renderer, so the pass is a material of its own on a second renderer that stands with the first, drawn with this shader.
 * The push is in the mesh's own space, by the width the Cocos effect gives in view space, which is about the same for a model drawn near its own size.
 */
export const OUTLINE_SHADER = `#pragma shader "cocos-outline"
#pragma version 300 es
#pragma domain Lit
#pragma feature MESH_NORMALS
#pragma param lineWidth float default(10)
#pragma param depthBias float default(0)
#pragma param baseColor color default(0,0,0,1)

#pragma vertexoffset
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    float len = length(localNormal);
    vec3 dir = len > 0.0001 ? localNormal / len : vec3(0.0);
    local += dir * (lineWidth * 0.001);
}
#pragma end

#pragma fragment
precision mediump float;
out vec4 fragColor;

void main() {
#ifdef ES_LINEAR
    fragColor = vec4(baseColor.rgb, 1.0);
#else
    fragColor = vec4(linearToSrgb(baseColor.rgb), 1.0);
#endif
}
#pragma end
`;
