// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    fog2d.ts
 * @brief   The fog of war of a 2D scene: ground never seen is dark, ground seen and left is dimmed and drained of colour, ground in view is as drawn.
 *
 * @details Two small textures the fog-of-war system paints cover the world rectangle a `FogOfWar` names: where a viewer has EVER seen (kept, drawn
 *          into again each frame and never cleared) and where one sees NOW (cleared and drawn each frame). The red channel of each is the answer.
 *          The picture is found on the ground plane in WORLD units, as the 2D mist and rain find it, so no depth is read.
 */
import type { ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';

const GLSL = `
/// What is known of a world point: x is how much of it has ever been seen, y how much is seen now. Outside the rectangle nothing is known.
vec2 fogAt(vec2 w) {
    if (u_fogW <= 0.0 || u_fogH <= 0.0) return vec2(0.0);
    vec2 uv = (w - vec2(u_fogL, u_fogB)) / vec2(u_fogW, u_fogH);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec2(0.0);
    return vec2(textureLod(u_fogExplored, uv, 0.0).r, textureLod(u_fogVisible, uv, 0.0).r);
}`;

const WGSL = `
fn fogAt(w : vec2f) -> vec2f {
    if (mc.u_fogW <= 0.0 || mc.u_fogH <= 0.0) { return vec2f(0.0); }
    let uv = (w - vec2f(mc.u_fogL, mc.u_fogB)) / vec2f(mc.u_fogW, mc.u_fogH);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return vec2f(0.0); }
    // This device's texture rows run the other way from the clip space the maps were drawn in.
    let p = vec2f(uv.x, 1.0 - uv.y);
    return vec2f(textureSampleLevel(u_fogExplored, u_fogExplored_s, p, 0.0).r, textureSampleLevel(u_fogVisible, u_fogVisible_s, p, 0.0).r);
}`;

const SOURCE = `#pragma shader "PP Fog 2D"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_forgetLight float default(0.4) range(0,1)
#pragma param u_forgetDesat float default(0.7) range(0,1)
#pragma param u_unexploredColor color default(0,0,0,1)
#pragma param u_fogL float default(0) range(-1000000000,1000000000)
#pragma param u_fogB float default(0) range(-1000000000,1000000000)
#pragma param u_fogW float default(0) range(0,1000000000)
#pragma param u_fogH float default(0) range(0,1000000000)
#pragma param u_fogExplored texture default(black)
#pragma param u_fogVisible texture default(black)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;
${GLSL}

void main() {
    vec4 src = texture(u_texture, v_texCoord);
    vec2 w = worldFromDepth(v_texCoord, 0.0).xy + u_renderOrigin.xy;
    vec3 dark = u_unexploredColor.rgb;
#ifdef ES_LINEAR
    dark = srgbToLinear(dark);
#endif
    vec2 known = fogAt(w);
    float seen = max(known.x, known.y);
    // Ground left behind is dimmed and drained of colour: remembered, not watched.
    float grey = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    vec3 remembered = mix(src.rgb, vec3(grey), u_forgetDesat) * u_forgetLight;
    vec3 shown = mix(remembered, src.rgb, smoothstep(0.0, 1.0, known.y));
    fragColor = vec4(mix(dark, shown, smoothstep(0.0, 1.0, seen)), src.a);
}
#pragma end

#pragma fragment wgsl
${WGSL}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let src = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    let w = worldFromDepth(v.v_texCoord, 0.0).xy + frame.renderOrigin.xy;
    var dark = mc.u_unexploredColor.rgb;
#ifdef ES_LINEAR
    dark = srgbToLinear(dark);
#endif
    let known = fogAt(w);
    let seen = max(known.x, known.y);
    let grey = dot(src.rgb, vec3f(0.299, 0.587, 0.114));
    let remembered = mix(src.rgb, vec3f(grey), mc.u_forgetDesat) * mc.u_forgetLight;
    let shown = mix(remembered, src.rgb, smoothstep(0.0, 1.0, known.y));
    return vec4f(mix(dark, shown, smoothstep(0.0, 1.0, seen)), src.a);
}
#pragma end
`;

export const fog2dEffects = {
    createFog2d(): ShaderHandle {
        return Material.compileShader(SOURCE);
    },
};
