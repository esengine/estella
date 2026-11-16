// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    shared.ts
 * @brief   The GLSL/WGSL fragments more than one post-process effect's shader is built from.
 */

/**
 * Depth-reading helpers the three SSAO passes share, in both languages. One
 * definition each: a fix that reached only the first of three copies compiled
 * fine and drew a black screen.
 */
export const SSAO_GLSL = `/// A texel of the pass's uv, which runs up the screen on both backends. Its inverse round-trips through that uv.
ivec2 screenTexel(vec2 uv, ivec2 size) {
    return clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
}
vec2 uvOfTexel(ivec2 t, ivec2 size) {
    return (vec2(t) + 0.5) / vec2(size);
}
/// The one place the row order matters: GL numbers rows from the BOTTOM, so a
/// screen texel is already the row.
float depthAt(ivec2 t, ivec2 size) {
    ivec2 q = clamp(t, ivec2(0), size - ivec2(1));
    return texelFetch(u_sceneDepth, q, 0).r;
}
vec3 worldAt(ivec2 t, ivec2 size) {
    ivec2 q = clamp(t, ivec2(0), size - ivec2(1));
    return worldFromDepth(uvOfTexel(q, size), depthAt(q, size));
}
/// World distance along the view ray per unit of window depth, at THIS pixel.
/// One derivative here replaces an un-projection per tap. Measured rather than
/// assumed, so it holds for both projections.
float worldPerDepth(vec2 uv, float d, vec3 P) {
    float e = max((1.0 - d) * 0.01, 1e-5);
    // Signed so the probe stays inside the depth range at the far plane.
    float de = d + e > 1.0 ? -e : e;
    return length(worldFromDepth(uv, d + de) - P) / abs(de);
}`;

/**
 * Where puddles lie, in both languages: a value-noise field over the ground's world xz, cut at a level the
 * coverage sets. A function of the WORLD position alone, so the rain effect (which darkens a puddle and
 * rings it) and the reflections effect (which makes it a mirror) draw the same puddles by being given the
 * same two numbers, and neither has to tell the other where they are.
 */
export const PUDDLE_GLSL = `
float puddleHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float puddleNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(puddleHash(i), puddleHash(i + vec2(1.0, 0.0)), f.x),
               mix(puddleHash(i + vec2(0.0, 1.0)), puddleHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float puddleMask(vec2 xz, float coverage, float scale) {
    if (coverage <= 0.0) return 0.0;
    vec2 p = xz / max(scale, 1.0);
    float n = 0.55 * puddleNoise(p) + 0.3 * puddleNoise(p * 2.3 + 17.0) + 0.15 * puddleNoise(p * 5.1 + 41.0);
    float t = 0.78 - coverage * 0.42;
    return smoothstep(t - 0.03, t + 0.03, n);
}`;

/**
 * Where water gathers. Standing water collects in the low places of a surface and is gone from its crowns, so the
 * coverage the author asked for is not the same everywhere: it is measured against the ground around, three rings of eight
 * depth taps whose reach is the size of a pool. A point lower than what surrounds it (by up to a rim's height) holds
 * more of the water, one that stands above it holds less, and flat ground keeps the coverage it was given — where the
 */
export const BASIN_GLSL = `
float basinCoverage(ivec2 c, ivec2 size, vec3 P, float coverage, float scale) {
    if (coverage <= 0.0) return 0.0;
    // How big a pixel is in the world here, which says how many of them a pool's reach is.
    float pixel = length(worldAt(c + ivec2(1, 0), size) - P);
    float reach = scale * 1.2;
    float r = clamp(reach / max(pixel, 1e-3), 3.0, 80.0);
    // A rise this high is a rim: more than that is a wall or a prop, which is not what water gathers against.
    float rim = reach * 0.12;
    float sum = 0.0;
    // Three rings, so a rise of any width between here and the edge of the reach has taps on it.
    for (int k = 1; k <= 3; ++k) {
        float rk = r * float(k) / 3.0;
        for (int i = 0; i < 8; ++i) {
            float a = (float(i) + 0.5 * float(k)) * 0.7853982;
            ivec2 t = c + ivec2(floor(vec2(cos(a), sin(a)) * rk + 0.5));
            if (depthAt(t, size) >= 1.0) continue;
            float rise = worldAt(t, size).y - P.y;
            sum += clamp(rise, -rim, rim) * step(abs(rise), reach);
        }
    }
    float basin = clamp(sum / (24.0 * rim) * 3.0, -1.0, 1.0);
    return clamp(coverage * (1.0 + 2.2 * basin), 0.0, 1.0);
}`;

/**
 * Reading the scene's surface record, in both languages: what each pixel IS, as the scene's own shaders
 * wrote it beside the colour — octahedral normal in rg, roughness in b, metalness in a (a is 0 where nothing
 * wrote, and 0.75 + 0.25 * metalness where something did, so that an edge multisampling averaged with an
 * unwritten pixel — at most 0.5 — is told from a surface; water's 0.72 is one rain leaves dry). An effect that wants it says `#pragma gbuffer`,
 */
export const GBUFFER_GLSL = `
struct Surface { vec3 normal; float roughness; float metallic; bool known; bool water; };
Surface readSurface(ivec2 t) {
    vec4 g = texelFetch(u_gbuffer, t, 0);
    Surface s;
    s.known = g.a > 0.7;
    s.water = g.a > 0.7 && g.a < 0.735;
    vec2 f = g.rg * 2.0 - 1.0;
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float k = clamp(-n.z, 0.0, 1.0);
    n.xy += vec2(n.x >= 0.0 ? -k : k, n.y >= 0.0 ? -k : k);
    s.normal = normalize(n);
    s.roughness = g.b;
    s.metallic = clamp((g.a - 0.75) / 0.25, 0.0, 1.0);
    return s;
}`;

/**
 * The frame's environment, sampled from an effect, in both languages: the same prefiltered octahedral atlas the
 * meshes reflect, read at the sky's own column. This is the engine's `envSampleMip` and `envDirection` as
 * the mesh shaders spell them (ShaderParser.cpp) — the atlas layout is the one fact they share, so a change
 * to it is a change here too. The numbers it needs come in as params the pipeline fills from the frame's light
 */
export const ENV_GLSL = `
vec3 envDirection(vec3 d) {
    float a = -u_envTint.a;
    float s = sin(a);
    float c = cos(a);
    return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}
vec2 envOctahedral(vec3 d) {
    vec2 p = d.xz / max(abs(d.x) + abs(d.y) + abs(d.z), 1e-6);
    if (d.y < 0.0) {
        p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
    }
    return p * 0.5 + 0.5;
}
vec3 envSkyMip(vec3 R, float mip) {
    float face = u_envParams.w;
    float size = face * exp2(-mip);
    float yOff = 2.0 * face * (1.0 - exp2(-mip)) + 2.0 * mip;
    float col = face + 2.0;
    float atlasW = col * u_reflParams.x;
    float atlasH = 2.0 * face * (1.0 - exp2(-(u_envParams.z + 1.0))) + 2.0 * (u_envParams.z + 1.0);
    vec2 uv = envOctahedral(envDirection(R));
    vec2 lo = vec2(0.5, yOff + 0.5);
    vec2 hi = vec2(size + 1.5, yOff + size + 1.5);
    vec2 px = clamp(vec2(1.0 + uv.x * size, yOff + 1.0 + uv.y * size), lo, hi);
    vec4 t = textureLod(u_environment, px / vec2(atlasW, atlasH), 0.0);
    return t.rgb * t.rgb * (t.a * t.a * u_envParams.y);
}
/// The sky's reflection along a direction at a roughness: two mips of the atlas blended, and tinted by the ambient
/// light that owns the environment — what the mesh shaders add to the flat ambient term for a reflection.
vec3 envSky(vec3 R, float roughness) {
    float lod = clamp(roughness, 0.0, 1.0) * u_envParams.z;
    float lo = floor(lod);
    vec3 a = envSkyMip(R, lo);
    vec3 b = envSkyMip(R, min(lo + 1.0, u_envParams.z));
    return mix(a, b, lod - lo) * u_envTint.rgb;
}`;

/** Where a full-screen pass's view ray starts: the near plane of a perspective eye; for an orthographic eye (whose depth range runs from far behind the camera, near = -far) the plane the camera stands in, mid-depth. Needs worldFromDepth and the camera block. */
export const RAY_START_GLSL = `vec3 rayStart(vec2 uv) { return worldFromDepth(uv, u_camera.w > 0.5 ? 0.0 : 0.5); }`;
/** One layer of falling rain streaks over the screen. Needs hash11 and the rain uniforms (u_wind, u_intensity, u_streakLength). */
export const RAIN_STREAKS_GLSL = `float streaks(vec2 uv, float aspect, float cols, float speed, float seed, float T) {
    vec2 q = vec2(uv.x * aspect - uv.y * u_wind, uv.y);
    float cx = floor(q.x * cols);
    float fx = fract(q.x * cols);
    float h1 = hash11(cx + seed);
    float h2 = hash11(cx * 1.7 + seed * 3.1);
    // GL rows run up the screen, so a pattern that falls moves toward lower rows.
    float y = q.y * 4.0 + T * speed * (0.8 + 0.4 * h1) + h2 * 17.0;
    float cell = floor(y);
    float fy = fract(y);
    float here = hash11(cx * 31.0 + cell + seed);
    if (here > u_intensity * 0.5) return 0.0;
    float dx = abs(fx - 0.5 - (hash11(cell + cx) - 0.5) * 0.6);
    float across = 1.0 - smoothstep(0.0, 0.06, dx);
    float along = (1.0 - fy / u_streakLength) * step(fy, u_streakLength);
    return across * along;
}`;
