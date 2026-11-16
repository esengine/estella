// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    subsurface.ts
 * @brief   Screen-space subsurface scattering: light that enters a surface and leaves it somewhere nearby.
 * @details A surface that scatters light (skin, wax, marble, a leaf) shows the lit picture blurred along the surface, and each
 *          colour blurred by a different amount: red travels far, blue barely. This is that blur, separable (an x pass and a y
 *          pass), run on the finished picture over the pixels a material marked as scattering.
 *
 *          The mark is the scene colour's alpha: a material with `u_subsurface` above zero draws opaque pixels at 0.996 instead of 1,
 *          which is invisible on screen and survives every pass between the scene and this one (and a multisample edge average).
 *          The second pass writes alpha 1 again, so nothing downstream sees the mark. A pixel that is not marked is passed
 *          through, and a marked pixel gathers only from marked neighbours on the same surface: a depth step stops the blur, which is
 *          what keeps an ear from bleeding into the wall behind it.
 *
 *          Limits worth knowing: it blurs the lit colour, speculars included, so a sharp highlight on a scattering surface is
 *          softened with it; and the width belongs to the effect, not the material, so every scattering material in view shares it.
 */
import type { ShaderHandle } from '../render/material';
import { Material } from '../render/material';
import { SSAO_GLSL } from './sources/shared';

export const subsurfacePasses = {
    createSubsurface(axis: 0 | 1): ShaderHandle {
        const dir = axis === 0 ? 'vec2(1.0, 0.0)' : 'vec2(0.0, 1.0)';
        // The last pass gives the alpha back; the first keeps the mark for the second to read.
        const outAlpha = axis === 0 ? 'c.a' : '1.0';
        const source = `#pragma shader "PP Subsurface ${axis.toFixed(0)}"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_width float default(8) range(0.1,80)
#pragma param u_strength float default(1) range(0,1)
#pragma param u_color color default(1,0.45,0.25,1)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform highp sampler2D u_sceneDepth;
out vec4 fragColor;

${SSAO_GLSL}

bool scatters(float a) { return a < 0.9985 && a > 0.9; }

void main() {
    vec4 c = texture(u_texture, v_texCoord);
    if (!scatters(c.a)) { fragColor = vec4(c.rgb, ${outAlpha}); return; }

    ivec2 dsize = textureSize(u_sceneDepth, 0);
    ivec2 t = screenTexel(v_texCoord, dsize);
    float d = depthAt(t, dsize);
    vec2 cuv = uvOfTexel(t, dsize);
    vec3 P = worldFromDepth(cuv, d);
    float worldPerTexel = max(length(worldFromDepth(cuv + vec2(1.0 / float(dsize.x), 0.0), d) - P), 1e-6);
    // How far the widest colour reaches, in texels: a world length, so the blur keeps its size as the camera moves away.
    float reach = min(u_width / worldPerTexel, 48.0);
    if (reach < 0.75) { fragColor = vec4(c.rgb, ${outAlpha}); return; }

    // Each colour's share of the widest: the brightest of the tint reaches all the way, the others less.
    vec3 k = max(u_color.rgb / max(max(u_color.r, u_color.g), u_color.b), vec3(0.12));
    vec2 texel = 1.0 / vec2(textureSize(u_texture, 0));
    const int N = 6;
    vec3 sum = c.rgb;
    vec3 weight = vec3(1.0);
    for (int i = 1; i <= N; ++i) {
        float x = float(i) / float(N);
        vec3 w = exp(-0.5 * (x * x) / (0.25 * k * k));
        for (int side = -1; side <= 1; side += 2) {
            vec2 uv = v_texCoord + ${dir} * (float(side) * x * reach) * texel;
            vec4 s = texture(u_texture, uv);
            if (!scatters(s.a)) continue;
            float ds = depthAt(screenTexel(uv, dsize), dsize);
            // Another surface, nearer or further than can be reached across this one, does not scatter into it.
            if (length(worldFromDepth(uv, ds) - P) > u_width * 1.6) continue;
            sum += s.rgb * w;
            weight += w;
        }
    }
    fragColor = vec4(mix(c.rgb, sum / weight, u_strength), ${outAlpha});
}
#pragma end

`;
        return Material.compileShader(source);
    },
};
