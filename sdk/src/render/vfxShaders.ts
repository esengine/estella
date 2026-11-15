// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

export const PARTICLE = `#pragma shader "Particle"
#pragma version 300 es
#pragma domain Unlit
#pragma feature PARTICLE_WORLD
#pragma param u_softness float default(0.5) range(0,8)
#pragma param u_erosion float default(0) range(0,1) ui(slider)
#pragma param u_erosionEdge float default(0.2) range(0.01,1)
#pragma param u_sceneDepthMap texture default(white) texel(data)

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
#ifdef PARTICLE
in highp vec4 v_particle;
#endif
#ifdef MESH_NORMALS
in highp vec3 v_worldXYZ;
#endif

uniform sampler2D u_textures[8];

out vec4 fragColor;

void main() {
    vec4 tex = texture(u_textures[0], v_texCoord);
    float alpha = tex.a * v_color.a;
#ifdef PARTICLE
    float cut = v_particle.x * u_erosion;
    alpha *= smoothstep(cut - u_erosionEdge, cut, tex.a);
#endif
#ifdef MESH_NORMALS
    if (u_softness > 0.0 && texture(u_sceneDepthMap, vec2(0.5)).a < 0.75) {
        highp float behind = sceneDistance(texture(u_sceneDepthMap, sceneUv(v_worldXYZ))) - distanceToEye(v_worldXYZ);
        alpha *= clamp(behind / u_softness, 0.0, 1.0);
    }
#endif
    fragColor = vec4(tex.rgb * v_color.rgb, alpha);
}
#pragma end

#pragma fragment wgsl
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let tex = textureSampleGrad(t0, s0, v.v_texCoord, dpdx(v.v_texCoord), dpdy(v.v_texCoord));
    var alpha = tex.a * v.v_color.a;
#ifdef PARTICLE
    let cut = v.v_particle.x * mc.u_erosion;
    alpha = alpha * smoothstep(cut - mc.u_erosionEdge, cut, tex.a);
#endif
#ifdef MESH_NORMALS
    let haveDepth = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, vec2f(0.5), 0.0).a < 0.75;
    if (mc.u_softness > 0.0 && haveDepth) {
        let behind = sceneDistance(textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, sceneUv(v.v_worldXYZ), 0.0)) - distanceToEye(v.v_worldXYZ);
        alpha = alpha * clamp(behind / mc.u_softness, 0.0, 1.0);
    }
#endif
    return vec4f(tex.rgb * v.v_color.rgb, alpha);
}
#pragma end
`;

export const DISTORTION = `#pragma shader "Distortion"
#pragma version 300 es
#pragma domain Unlit
#pragma param u_strength float default(0.03) range(0,0.25)
#pragma param u_radial float default(0) range(0,1) ui(slider)
#pragma param u_noiseScale float default(6) range(0.5,64)
#pragma param u_scroll vec2 default(0,0.4)
#pragma param u_dispersion float default(0) range(0,1) ui(slider)
#pragma param u_screenColor texture default(white)

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
#ifdef PARTICLE
in highp vec4 v_particle;
#endif

uniform sampler2D u_textures[8];

out vec4 fragColor;

float distortHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float distortNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(distortHash(i), distortHash(i + vec2(1.0, 0.0)), f.x),
               mix(distortHash(i + vec2(0.0, 1.0)), distortHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
    float mask = texture(u_textures[0], v_texCoord).a * v_color.a;
    if (mask <= 0.002 || texture(u_screenColor, vec2(0.5)).a >= 0.75) discard;
    vec2 p = v_texCoord * u_noiseScale + u_scroll * u_time.x;
#ifdef PARTICLE
    p += v_particle.y * 37.0;
#endif
    vec2 wobble = vec2(distortNoise(p), distortNoise(p + 19.7)) - 0.5;
    vec2 away = v_texCoord - 0.5;
    away = length(away) > 1e-4 ? normalize(away) : vec2(0.0);
    vec2 bend = mix(wobble, vec2(away.x, -away.y), u_radial) * u_strength * mask;
    vec2 uv = gl_FragCoord.xy / vec2(textureSize(u_screenColor, 0));
    vec2 lo = vec2(0.001), hi = vec2(0.999);
    float split = 1.0 + u_dispersion;
    vec3 behind = vec3(
        texture(u_screenColor, clamp(uv + bend * split, lo, hi)).r,
        texture(u_screenColor, clamp(uv + bend, lo, hi)).g,
        texture(u_screenColor, clamp(uv + bend / split, lo, hi)).b);
    fragColor = vec4(behind, smoothstep(0.0, 0.06, mask));
}
#pragma end

#pragma fragment wgsl
fn distortHash(p : vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn distortNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(distortHash(i), distortHash(i + vec2f(1.0, 0.0)), f.x),
               mix(distortHash(i + vec2f(0.0, 1.0)), distortHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let texel = textureSampleGrad(t0, s0, v.v_texCoord, dpdx(v.v_texCoord), dpdy(v.v_texCoord));
    let mask = texel.a * v.v_color.a;
    let haveColor = textureSampleLevel(u_screenColor, u_screenColor_s, vec2f(0.5), 0.0).a < 0.75;
    if (mask <= 0.002 || !haveColor) { discard; }
    var p = v.v_texCoord * mc.u_noiseScale + mc.u_scroll * tc.u_time.x;
#ifdef PARTICLE
    p = p + v.v_particle.y * 37.0;
#endif
    let wobble = vec2f(distortNoise(p), distortNoise(p + 19.7)) - 0.5;
    var away = v.v_texCoord - 0.5;
    if (length(away) > 1e-4) { away = normalize(away); } else { away = vec2f(0.0); }
    let bend = mix(vec2f(wobble.x, -wobble.y), away, vec2f(mc.u_radial)) * mc.u_strength * mask;
    let uv = v.pos.xy / vec2f(textureDimensions(u_screenColor, 0));
    let lo = vec2f(0.001);
    let hi = vec2f(0.999);
    let split = 1.0 + mc.u_dispersion;
    let behind = vec3f(
        textureSampleLevel(u_screenColor, u_screenColor_s, clamp(uv + bend * split, lo, hi), 0.0).r,
        textureSampleLevel(u_screenColor, u_screenColor_s, clamp(uv + bend, lo, hi), 0.0).g,
        textureSampleLevel(u_screenColor, u_screenColor_s, clamp(uv + bend / split, lo, hi), 0.0).b);
    return vec4f(behind, smoothstep(0.0, 0.06, mask));
}
#pragma end
`;
