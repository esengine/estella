// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  waterShader.ts
 * @brief The Water built-in shader: waves, refraction, reflection, caustics, foam.
 *
 * The shader source lives with the module that installs it, not in the core's list of built-in shaders: a package that does not install the module carries none of it.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';
import { CAUSTICS_GLSL, CAUSTICS_WGSL } from '../render/waterCaustics';

// A horizontal body of water: waves that travel, the scene seen through it bent and tinted by how much water lies in front of it, the sky
// and the lights reflected off it, and foam where it meets what it lies on and on the crests. It reads the picture of the opaque scene
// behind it and how far each pixel of that is from the eye, which the frame takes before it draws a material that declares them, so
// the depth of the water at a pixel is what is measured, not a number the author guessed. Where the device cannot hold the distances
// (no float target) it falls back to `u_fallbackDepth` as the depth everywhere.
const WATER = `#pragma shader "Water"
#pragma version 300 es
#pragma domain Lit
// The colour the water scatters back: lighter where it is shallow, darker where it is deep.
#pragma param u_shallowColor color default(0.10,0.42,0.46,1)
#pragma param u_deepColor color default(0.01,0.08,0.15,1)
// How fast each colour is absorbed along the way through the water (red goes first), and how thick the water is, per world unit.
#pragma param u_absorption color default(0.45,0.09,0.05,1)
#pragma param u_density float default(0.12) range(0,4) ui(slider)
// The waves: height, length of the longest, how sharp their crests are drawn, how fast they travel and which way (degrees).
#pragma param u_waveHeight float default(0.3) range(0,8) ui(slider)
#pragma param u_waveLength float default(14) range(0.5,300) ui(slider)
#pragma param u_waveSpeed float default(1) range(0,4) ui(slider)
#pragma param u_waveDirection float default(30) range(0,360) ui(slider)
// The small ripples the long waves carry: how steep and how long each is.
#pragma param u_rippleStrength float default(0.3) range(0,1) ui(slider)
#pragma param u_rippleLength float default(2.5) range(0.1,40) ui(slider)
// How hard it rains on the water (the weather writes it): drops ring out on the surface, a few to every u_rippleLength.
#pragma param u_rain float default(0) range(0,4) ui(slider)
#pragma param u_roughness float default(0.04) range(0,1) ui(slider)
// How far what is seen through the water is shifted by its waves, and the depth of water at which that stops growing.
#pragma param u_refractionStrength float default(1) range(0,4) ui(slider)
#pragma param u_distortionRange float default(12) range(0.1,200) ui(slider)
// Foam: its colour, how deep the water is where it begins at the shore (world units), and how much of the wave crests carry it.
#pragma param u_foamColor color default(0.95,0.97,1,1)
#pragma param u_foamWidth float default(1.2) range(0,20) ui(slider)
#pragma param u_foamCrest float default(0.5) range(0,1) ui(slider)
// How deep, in world units, the water is where it has thinned to nothing at its edge: over that last depth the ground behind shows through
// more and more, so the water meets it along a soft line. 0 keeps a hard edge.
#pragma param u_edgeSoftness float default(0.3) range(0,1000) ui(slider)
// The depth taken where the device could not measure one.
#pragma param u_fallbackDepth float default(4) range(0,200) ui(slider)
// Where the waves are measured. 0 is the world's xz plane, which is what a plain mesh of water wants. 1 is the surface a WaterZone draws: the mesh's uv
// is its x and z (plus u_origin, which the zone moves as the mesh follows the camera, so the waves stay put in the world), and the vertices are lifted
// to the zone's water and its waves.
#pragma param u_waveSpace float default(0) range(0,1) ui(slider)
#pragma param u_origin vec2 default(0,0)
// The cell size of the mesh's finest ring: a vertex in a coarser ring (its colour's red says which) fades the waves it cannot draw, those shorter
// than six of its cells. 0 draws every wave at every vertex.
#pragma param u_cellSize float default(0) range(0,100) ui(slider)
// A WaterZone's baked water (zone.ts encode): heights texel by texel (rg height over u_zoneHeight, b depth, a waves' height), field filtered
// (r shore distance, 0.5 at it, as a signed square root so it is fine near the shore; gb current; a calm share), over u_zoneRange (shore, waves, current, depth). Below the shore there is no
// water; past the region there is the ocean where u_oceanOn says so.
#pragma param u_zoneOn float default(0) range(0,1) ui(slider)
#pragma param u_zoneHeights texture default(white) texel(data)
#pragma param u_zoneField texture default(white) texel(data)
// How open each place's water is to the wind (its fetch), 0 to 1: the weather raises the waves that much of the way. The sea is open.
#pragma param u_zoneExposure texture default(white) texel(data)
#pragma param u_zoneOrigin vec2 default(0,0)
#pragma param u_zoneSize vec2 default(1,1)
#pragma param u_zoneHeight vec2 default(0,1)
#pragma param u_zoneRange vec4 default(16,1,1,16)
#pragma param u_oceanOn float default(0) range(0,1) ui(slider)
#pragma param u_oceanLevel float default(0) range(-100000,100000) ui(slider)
#pragma param u_oceanWaves float default(1) range(0,100) ui(slider)
// The surf (the WaterZone writes these): how high a breaker stands against its body's waves (with the weather in), how long the surf's waves
// are, and a multiplier on their speed. 0 draws none.
#pragma param u_surfHeight float default(0) range(0,4) ui(slider)
#pragma param u_surfLength float default(10) range(0.1,100000) ui(slider)
#pragma param u_surfSpeed float default(1) range(0,4) ui(slider)
// How long, in seconds, each of the two copies of the surface the shader carries down a current lives before the other takes over.
#pragma param u_flowCycle float default(2) range(0.2,20) ui(slider)
// How much of the waves lifts the geometry: 0 draws the surface flat and moves it only in the shading (the lite water).
#pragma param u_geoWaves float default(1) range(0,1) ui(slider)
// The net of light the waves throw on what is under the water: how strong it is, how large one cell of it is (world units), and how fast it swims. The Underwater
// effect draws the same one from below, with these numbers, so the two halves of the picture agree.
#pragma param u_causticStrength float default(0.6) range(0,3) ui(slider)
#pragma param u_causticScale float default(2) range(0.05,2000) ui(slider)
#pragma param u_causticSpeed float default(0.35) range(0,4) ui(slider)
// What the quality level allows (the WaterZone writes these): how many of the four waves are summed, whether the surface seen from below mirrors the world under it,
// and whether the sun's web of light is drawn on what lies under the water.
#pragma param u_waveCount float default(4) range(1,4) ui(slider)
#pragma param u_mirror float default(1) range(0,1) ui(slider)
#pragma param u_causticOn float default(1) range(0,1) ui(slider)
// The disturbance the water keeps (WaterZone ripples): a window of the xz plane, red the height of the ripples (0.5 at rest, u_rippleRange above or below at 1 and 0)
// and green the foam they left, as the CPU stepped them. u_rippleSize is the window's side, u_rippleTexel one texel of it.
#pragma param u_rippleOn float default(0) range(0,1) ui(slider)
// Two tiled normal maps that scroll over the surface, for the sparkle the sun makes of a water's small slopes, in the one texture a material has room
// for: red and green the first's slope (x and z, 0.5 flat), blue and alpha the second's, read as data. Each is u_detailTile world units to a repeat,
// u_detailStrength times as steep as drawn (0 leaves it out), and slides u_detailFlow world units a second.
#pragma param u_detailMap texture default(flatnormal) texel(data)
#pragma param u_detailTile0 float default(2) range(0.01,100000) ui(slider)
#pragma param u_detailTile1 float default(4.3) range(0.01,100000) ui(slider)
#pragma param u_detailStrength0 float default(0) range(0,8) ui(slider)
#pragma param u_detailStrength1 float default(0) range(0,8) ui(slider)
#pragma param u_detailFlow0 vec2 default(0.05,0.02)
#pragma param u_detailFlow1 vec2 default(-0.03,0.04)
#pragma param u_rippleMap texture default(white) texel(data)
#pragma param u_rippleOrigin vec2 default(0,0)
#pragma param u_rippleSize float default(64) range(0.01,100000) ui(slider)
#pragma param u_rippleTexel float default(0.0156) range(0,1) ui(slider)
#pragma param u_rippleRange float default(1) range(0.0001,1000) ui(slider)
#pragma param u_sceneColor texture default(white)
#pragma param u_sceneDepthMap texture default(white) texel(data)
// What the foam is made of: a tiled texture whose red says how much foam a texel holds where foam is wanted (bubbles, threads, a web),
// u_foamTile world units to a repeat, sliding u_foamFlow world units a second. Read as coverage, so the foam the shore, crests and ripples
// ask for thins out through the texture's own pattern instead of dimming evenly; the default white keeps the foam exactly as computed.
// Declared after every other texture, on purpose: the material units above it were full, and this one takes a unit the water never reads.
#pragma param u_foamMap texture default(white) texel(data)
#pragma param u_foamTile float default(3) range(0.01,100000) ui(slider)
#pragma param u_foamFlow vec2 default(0.04,0.03)

#pragma vertexbounds 16
#pragma vertexoffset
// The height of the waves at p: the same four peaked sines the fragment takes its slope from, so the surface that is lit is the one that is drawn.
// Where the waves are read for the true place p, bent by the given span (waves.ts: waveBend): crests of straight sines a few directions apart
// add up to long parallel lines, a sea scored with strokes that turn with the wind. xy to read at; zw dx/dz and dz/dx, for a slope. One
// sine an axis: this runs for every pixel of the water, and with a term more a phone paid 11 ms a frame for it.
vec4 waterBend(vec2 p, float span) {
    vec2 q = p / span;
    return vec4(p.x + span * 0.45 * sin(q.y * 0.73 + 1.3), p.y + span * 0.45 * sin(q.x * 0.61 + 2.7),
                0.3285 * cos(q.y * 0.73 + 1.3), 0.2745 * cos(q.x * 0.61 + 2.7));
}
float waterWaveHeight(vec2 p, float time, float cell) {
    vec2 at = waterBend(p, u_waveLength).xy;
    const vec4 SET[4] = vec4[4](vec4(0.0, 1.0, 1.0, 1.0), vec4(28.0, 0.62, 0.55, 1.1), vec4(-37.0, 0.37, 0.3, 1.2), vec4(71.0, 0.21, 0.15, 1.35));
    float height = 0.0;
    float base = radians(u_waveDirection);
    for (int i = 0; i < 4; ++i) {
        if (float(i) >= u_waveCount) break;
        float length_ = u_waveLength * SET[i].y;
        float k = 6.2831853 / length_;
        float a = base + radians(SET[i].x);
        vec2 d = vec2(sin(a), cos(a));
        float omega = sqrt(9.8 * k) * u_waveSpeed * SET[i].w;
        float fade = cell > 0.0 ? clamp((length_ / cell - 3.0) / 3.0, 0.0, 1.0) : 1.0;
        height += u_waveHeight * SET[i].z * exp(sin(k * dot(d, at) - omega * time) - 1.0) * fade;
    }
    return height;
}
// The zone's water at p: its surface's height, its depth and how high its waves stand, each texel decoded before the four about p are blended
// (bytes blended are no number). Past the region: the ocean's, where there is one.
vec4 waterZoneAt(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    ivec2 size = textureSize(u_zoneHeights, 0);
    vec2 f = clamp(uv, 0.0, 1.0) * vec2(size - 1);
    ivec2 i = min(ivec2(floor(f)), max(size - 2, ivec2(0)));
    vec2 t = f - vec2(i);
    vec4 a = texelFetch(u_zoneHeights, i, 0), b = texelFetch(u_zoneHeights, i + ivec2(1, 0), 0);
    vec4 c = texelFetch(u_zoneHeights, i + ivec2(0, 1), 0), d = texelFetch(u_zoneHeights, i + ivec2(1, 1), 0);
    vec4 ha = vec4(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    float h = mix(mix(ha.x, ha.y, t.x), mix(ha.z, ha.w, t.x), t.y);
    // The depth is stored as its square root, so the shallows (where it draws the shore) are fine: squared before blending.
    vec2 da = mix(mix(a.ba * vec2(a.b, 1.0), b.ba * vec2(b.b, 1.0), t.x), mix(c.ba * vec2(c.b, 1.0), d.ba * vec2(d.b, 1.0), t.x), t.y);
    // The weather (u_waveHeight) raises a body's waves only as far as the wind has room to: w is that share, and z is put so that
    // u_waveHeight times it is the waves' height there.
    float e = textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).r;
    vec4 zone = vec4(u_zoneHeight.x + h * u_zoneHeight.y, da.x * u_zoneRange.w, da.y * u_zoneRange.y * mix(1.0, u_waveHeight, e) / max(u_waveHeight, 1e-3), e);
    return !inside && u_oceanOn > 0.5 ? vec4(u_oceanLevel, 1e6, u_oceanWaves, 1.0) : zone;
}
// The zone's field at p, decoded: the shore distance, the current, and the share of its waves a place keeps. Past the region: the ocean's.
vec4 waterZoneField(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    vec4 f = textureLod(u_zoneField, clamp(uv, 0.0, 1.0), 0.0);
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    if (!inside) return u_oceanOn > 0.5 ? vec4(1e6, 0.0, 0.0, 1.0) : vec4(-1.0, 0.0, 0.0, 0.0);
    float e = (f.r - 0.5) * 2.0;
    return vec4(e * abs(e) * u_zoneRange.x, (f.gb - 0.5) * 2.0 * u_zoneRange.z, f.a);
}
// The distance the surf runs in by at p: the shore's with a river's water taken for land and smoothed over the surf's length, so the crests
// come in as lines that turn to the shore as they near it and run straight across a river's mouth. Past the region: the ocean's.
float waterZoneSurf(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    float e = (textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).g - 0.5) * 2.0;
    return inside ? e * abs(e) * u_zoneRange.x : u_oceanOn > 0.5 ? 1e6 : -1.0;
}
// How much of the surf a current leaves at p: none in a river, and more and more of it away from where the river runs out into open water.
float waterZoneStill(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    return textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).b;
}
// How steep the shore is at p: 0 a gentle beach (waves wash up it), 1 rock or a cliff (they burst white on it).
float waterZoneSteep(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    return textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).a;
}
// The surf (waves.ts surfHeight): its crests are lines of phase (the distance the surf runs in by), and it rises, breaks and runs up by
// shore, the real distance to the shore. x its height, y how broken it is (white water on and behind a breaking crest).
vec2 waterSurf(float phase, float shore, float height, float time) {
    if (height <= 0.0 || u_surfLength <= 0.0) return vec2(0.0);
    float reach = u_surfLength * 4.0;
    if (shore > reach || shore < -reach * 0.05) return vec2(0.0);
    float celerity = sqrt(9.8 * u_surfLength / 6.2831853) * u_surfSpeed;
    float u = fract(phase / u_surfLength + celerity * time / u_surfLength);
    float g = u > 0.8 ? smoothstep(0.0, 1.0, (u - 0.8) / 0.2) : 1.0 - smoothstep(0.0, 1.0, u / 0.8);
    float shoal = 1.0 - smoothstep(0.0, 1.0, (shore - reach * 0.25) / (reach * 0.75));
    float runUp = shore >= 0.0 ? 1.0 : 1.0 - smoothstep(0.0, 1.0, -shore / (reach * 0.05));
    float env = shoal * runUp;
    // It breaks in the inner third: the crest whitens, and the water behind it stays white a while.
    float breaking = 1.0 - smoothstep(reach * 0.15, reach * 0.4, shore);
    // A wave breaks only when it is steep for its length: a lake's small surf laps, the sea's breaks white.
    float steep = smoothstep(0.012, 0.045, height / u_surfLength);
    float white = breaking * steep * max(smoothstep(0.75, 1.0, g), (1.0 - smoothstep(0.0, 0.35, u)) * 0.8) * env;
    return vec2(height * g * g * env, white);
}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    if (u_waveSpace < 0.5) return;
    vec2 p = uv + u_origin;
    float cell = u_cellSize > 0.0 ? u_cellSize * exp2(es_vertexColor.r * 7.0) : 0.0;
    // The water's rest height there, how high its body's waves stand (a multiple of u_waveHeight, the weather's) and the share kept toward
    // the shore; and the surf running in on it, which a current carries none of.
    vec4 zone = u_zoneOn > 0.5 ? waterZoneAt(p) : vec4(0.0, 0.0, 1.0, 1.0);
    vec4 field = u_zoneOn > 0.5 ? waterZoneField(p) : vec4(1e6, 0.0, 0.0, 1.0);
    float still = u_zoneOn > 0.5 ? waterZoneStill(p) : 1.0;
    float surf = waterSurf(u_zoneOn > 0.5 ? waterZoneSurf(p) : 1e6, field.x, u_surfHeight * u_waveHeight * zone.z * zone.w * still, u_time.x).x;
    local.y += zone.x + (waterWaveHeight(p, u_time.x, cell) * zone.z * field.w + surf) * u_geoWaves;
}
#pragma end

#pragma vertexoffset wgsl
fn waterBend(p : vec2f, span : f32) -> vec4f {
    let q = p / span;
    return vec4f(p.x + span * 0.45 * sin(q.y * 0.73 + 1.3), p.y + span * 0.45 * sin(q.x * 0.61 + 2.7),
                 0.3285 * cos(q.y * 0.73 + 1.3), 0.2745 * cos(q.x * 0.61 + 2.7));
}
fn waterWaveHeight(p : vec2f, time : f32, cell : f32) -> f32 {
    let at = waterBend(p, mc.u_waveLength).xy;
    var wave = array<vec4f, 4>(vec4f(0.0, 1.0, 1.0, 1.0), vec4f(28.0, 0.62, 0.55, 1.1), vec4f(-37.0, 0.37, 0.3, 1.2), vec4f(71.0, 0.21, 0.15, 1.35));
    var height = 0.0;
    let base = radians(mc.u_waveDirection);
    for (var i : i32 = 0; i < 4; i = i + 1) {
        if (f32(i) >= mc.u_waveCount) { break; }
        let spec = wave[i];
        let span = mc.u_waveLength * spec.y;
        let k = 6.2831853 / span;
        let a = base + radians(spec.x);
        let d = vec2f(sin(a), cos(a));
        let omega = sqrt(9.8 * k) * mc.u_waveSpeed * spec.w;
        var fade = 1.0;
        if (cell > 0.0) { fade = clamp((span / cell - 3.0) / 3.0, 0.0, 1.0); }
        height = height + mc.u_waveHeight * spec.z * exp(sin(k * dot(d, at) - omega * time) - 1.0) * fade;
    }
    return height;
}
fn waterZoneAt(p : vec2f) -> vec4f {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    let size = vec2i(textureDimensions(u_zoneHeights, 0));
    let f = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(size - vec2i(1));
    let i = min(vec2i(floor(f)), max(size - vec2i(2), vec2i(0)));
    let t = f - vec2f(i);
    let a = textureLoad(u_zoneHeights, i, 0);
    let b = textureLoad(u_zoneHeights, i + vec2i(1, 0), 0);
    let c = textureLoad(u_zoneHeights, i + vec2i(0, 1), 0);
    let d = textureLoad(u_zoneHeights, i + vec2i(1, 1), 0);
    let ha = vec4f(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    let h = mix(mix(ha.x, ha.y, t.x), mix(ha.z, ha.w, t.x), t.y);
    // The depth is stored as its square root, so the shallows (where it draws the shore) are fine: squared before blending.
    let da = mix(mix(a.ba * vec2f(a.b, 1.0), b.ba * vec2f(b.b, 1.0), t.x), mix(c.ba * vec2f(c.b, 1.0), d.ba * vec2f(d.b, 1.0), t.x), t.y);
    let e = textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).r;
    if (!inside && mc.u_oceanOn > 0.5) { return vec4f(mc.u_oceanLevel, 1e6, mc.u_oceanWaves, 1.0); }
    return vec4f(mc.u_zoneHeight.x + h * mc.u_zoneHeight.y, da.x * mc.u_zoneRange.w,
                 da.y * mc.u_zoneRange.y * mix(1.0, mc.u_waveHeight, e) / max(mc.u_waveHeight, 1e-3), e);
}
fn waterZoneField(p : vec2f) -> vec4f {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let f = textureSampleLevel(u_zoneField, u_zoneField_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    if (!inside) {
        if (mc.u_oceanOn > 0.5) { return vec4f(1e6, 0.0, 0.0, 1.0); }
        return vec4f(-1.0, 0.0, 0.0, 0.0);
    }
    let e = (f.r - 0.5) * 2.0;
    return vec4f(e * abs(e) * mc.u_zoneRange.x, (f.gb - vec2f(0.5)) * 2.0 * mc.u_zoneRange.z, f.a);
}
// The distance the surf runs in by at p: the shore's with a river's water taken for land and smoothed over the surf's length, so the crests
// come in as lines that turn to the shore as they near it and run straight across a river's mouth. Past the region: the ocean's.
fn waterZoneSurf(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    let e = (textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).g - 0.5) * 2.0;
    if (inside) { return e * abs(e) * mc.u_zoneRange.x; }
    if (mc.u_oceanOn > 0.5) { return 1e6; }
    return -1.0;
}
// How much of the surf a current leaves at p: none in a river, and more and more of it away from where the river runs out into open water.
fn waterZoneStill(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    return textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).b;
}
// How steep the shore is at p: 0 a gentle beach (waves wash up it), 1 rock or a cliff (they burst white on it).
fn waterZoneSteep(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    return textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).a;
}
fn waterSurf(phase : f32, shore : f32, height : f32, time : f32) -> vec2f {
    if (height <= 0.0 || mc.u_surfLength <= 0.0) { return vec2f(0.0); }
    let reach = mc.u_surfLength * 4.0;
    if (shore > reach || shore < -reach * 0.05) { return vec2f(0.0); }
    let celerity = sqrt(9.8 * mc.u_surfLength / 6.2831853) * mc.u_surfSpeed;
    let u = fract(phase / mc.u_surfLength + celerity * time / mc.u_surfLength);
    var g = 1.0 - smoothstep(0.0, 1.0, u / 0.8);
    if (u > 0.8) { g = smoothstep(0.0, 1.0, (u - 0.8) / 0.2); }
    let shoal = 1.0 - smoothstep(0.0, 1.0, (shore - reach * 0.25) / (reach * 0.75));
    var runUp = 1.0;
    if (shore < 0.0) { runUp = 1.0 - smoothstep(0.0, 1.0, -shore / (reach * 0.05)); }
    let env = shoal * runUp;
    let breaking = 1.0 - smoothstep(reach * 0.15, reach * 0.4, shore);
    let steep = smoothstep(0.012, 0.045, height / mc.u_surfLength);
    let white = breaking * steep * max(smoothstep(0.75, 1.0, g), (1.0 - smoothstep(0.0, 0.35, u)) * 0.8) * env;
    return vec2f(height * g * g * env, white);
}
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    if (mc.u_waveSpace < 0.5) { return; }
    let p = uv + mc.u_origin;
    var cell = 0.0;
    if (mc.u_cellSize > 0.0) { cell = mc.u_cellSize * exp2(es_vertexColor.r * 7.0); }
    var zone = vec4f(0.0, 0.0, 1.0, 1.0);
    var field = vec4f(1e6, 0.0, 0.0, 1.0);
    if (mc.u_zoneOn > 0.5) { zone = waterZoneAt(p); field = waterZoneField(p); }
    var still = 1.0;
    if (mc.u_zoneOn > 0.5) { still = waterZoneStill(p); }
    var surfAt = 1e6;
    if (mc.u_zoneOn > 0.5) { surfAt = waterZoneSurf(p); }
    let surf = waterSurf(surfAt, field.x, mc.u_surfHeight * mc.u_waveHeight * zone.z * zone.w * still, tc.u_time.x).x;
    (*local).y = (*local).y + zone.x + (waterWaveHeight(p, tc.u_time.x, cell) * zone.z * field.w + surf) * mc.u_geoWaves;
}
#pragma end

#pragma fragment
precision highp float;

in vec4 v_color;
in vec2 v_texCoord;
in highp vec2 v_worldPos;
#ifdef MESH_NORMALS
in highp vec3 v_worldNormal;
in highp vec3 v_worldXYZ;
#endif

#ifdef ES_GBUFFER
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragSurface;
// The surface's diffuse colour, for light an effect adds after this pass (bounce light): alpha 1 is "written".
layout(location = 2) out vec4 fragAlbedo;

vec2 packNormal(vec3 n) {
    n /= (abs(n.x) + abs(n.y) + abs(n.z));
    vec2 sgn = vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    vec2 e = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * sgn;
    return e * 0.5 + 0.5;
}
#else
out vec4 fragColor;
#endif

// Where the waves are read for the true place p, bent by the given span (waves.ts: waveBend): crests of straight sines a few directions apart
// add up to long parallel lines, a sea scored with strokes that turn with the wind. xy to read at; zw dx/dz and dz/dx, for a slope. One
// sine an axis: this runs for every pixel of the water, and with a term more a phone paid 11 ms a frame for it.
vec4 waterBend(vec2 p, float span) {
    vec2 q = p / span;
    return vec4(p.x + span * 0.45 * sin(q.y * 0.73 + 1.3), p.y + span * 0.45 * sin(q.x * 0.61 + 2.7),
                0.3285 * cos(q.y * 0.73 + 1.3), 0.2745 * cos(q.x * 0.61 + 2.7));
}
float waterHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
float waterNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
               mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/// The slope of the ripples the wind raises at p: six short waves within seventy-five degrees of it, from u_rippleLength down to a fifth of it, each
/// running at the speed its length gives deep water and at a phase of its own, each as steep as u_rippleStrength a third. A sum of waves
/// has no cells or blobs, which drifting noise has. A ripple shorter than a pixel would shimmer: each fades out with distance.
vec2 rippleSlope(vec2 p, float time, float dist) {
    const vec3 SET[6] = vec3[6](vec3(-14.0, 1.0, 0.0), vec3(33.0, 0.71, 1.7), vec3(-58.0, 0.53, 3.1),
                                vec3(11.0, 0.39, 4.4), vec3(74.0, 0.29, 0.9), vec3(-41.0, 0.21, 2.6));
    float base = radians(u_waveDirection);
    vec2 slope = vec2(0.0);
    for (int i = 0; i < 6; ++i) {
        float len = u_rippleLength * SET[i].y;
        float k = 6.2831853 / len;
        float a = base + radians(SET[i].x);
        vec2 d = vec2(sin(a), cos(a));
        float theta = k * dot(d, p) - sqrt(9.8 * k) * u_waveSpeed * time + SET[i].z;
        float seen = clamp(1.0 - dist / (len * 150.0), 0.0, 1.0);
        slope += d * (cos(theta) * seen * 0.33);
    }
    return slope * u_rippleStrength;
}

/// The slope rain adds at p: in every cell of two offset grids a third of u_rippleLength across, a drop lands at a place and a moment of
/// its own once a cycle, and a ring runs out from it and dies away. Harder rain wets more of the cells. No foam: a raindrop makes none.
vec2 rainRings(vec2 p, float time, float rain) {
    vec2 slope = vec2(0.0);
    if (rain <= 0.0) return slope;
    float cellSize = u_rippleLength * 0.35;
    const float K = 52.0;
    for (int layer = 0; layer < 2; layer++) {
        vec2 q = p / cellSize + float(layer) * vec2(0.37, 0.71);
        vec2 cell = floor(q) + float(layer) * 113.0;
        float h = waterHash(cell);
        float rate = 0.8 + 0.5 * h;
        float cycle = time * rate + h * 7.31;
        vec2 drop = cell + floor(cycle) * vec2(17.0, 31.0);
        if (waterHash(drop + 0.5) > clamp(rain * 0.4, 0.0, 0.9)) continue;
        float t = fract(cycle);
        vec2 centre = floor(q) + 0.25 + 0.5 * vec2(waterHash(drop + 3.1), waterHash(drop + 5.7));
        vec2 d = q - centre;
        float r = max(length(d), 1e-4);
        float x = r - t * 0.45;
        float env = (1.0 - t) * (1.0 - t) * exp(-x * x * 900.0);
        float dh = (cos(x * K) - x * 1800.0 / K * sin(x * K)) * env;
        slope += d / r * dh * 0.3;
    }
    return slope;
}

/// The slope of the water's surface at p (d height / d x, d height / d z) and how near the waves are to a crest, 0 to 1.
/// Four waves a few directions apart, each a peaked sine (exp(sin - 1)) whose crests are narrower than its troughs.
vec2 waveSlope(vec2 p, float time, float dist, out float crest) {
    const vec4 SET[4] = vec4[4](vec4(0.0, 1.0, 1.0, 1.0), vec4(28.0, 0.62, 0.55, 1.1), vec4(-37.0, 0.37, 0.3, 1.2), vec4(71.0, 0.21, 0.15, 1.35));
    vec2 slope = vec2(0.0);
    float crestSum = 0.0;
    float weightSum = 0.0;
    float base = radians(u_waveDirection);
    vec4 bend = waterBend(p, u_waveLength);
    for (int i = 0; i < 4; ++i) {
        if (float(i) >= u_waveCount) break;
        float length_ = u_waveLength * SET[i].y;
        float k = 6.2831853 / length_;
        float a = base + radians(SET[i].x);
        vec2 d = vec2(sin(a), cos(a));
        float omega = sqrt(9.8 * k) * u_waveSpeed * SET[i].w;
        float theta = k * dot(d, bend.xy) - omega * time;
        float e = exp(sin(theta) - 1.0);
        // A wave much shorter than a pixel is noise, not a wave: it fades out with distance.
        float seen = clamp(1.0 - dist / (length_ * 220.0), 0.0, 1.0);
        slope += d * (u_waveHeight * SET[i].z * e * cos(theta) * k * seen);
        crestSum += e * SET[i].z;
        weightSum += SET[i].z;
    }
    slope = vec2(slope.x + slope.y * bend.w, slope.y + slope.x * bend.z);
    crest = crestSum / weightSum;
    return slope;
}

${CAUSTICS_GLSL}
// The zone's water at p: its surface's height, its depth and how high its waves stand, each texel decoded before the four about p are blended
// (bytes blended are no number). Past the region: the ocean's, where there is one.
vec4 waterZoneAt(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    ivec2 size = textureSize(u_zoneHeights, 0);
    vec2 f = clamp(uv, 0.0, 1.0) * vec2(size - 1);
    ivec2 i = min(ivec2(floor(f)), max(size - 2, ivec2(0)));
    vec2 t = f - vec2(i);
    vec4 a = texelFetch(u_zoneHeights, i, 0), b = texelFetch(u_zoneHeights, i + ivec2(1, 0), 0);
    vec4 c = texelFetch(u_zoneHeights, i + ivec2(0, 1), 0), d = texelFetch(u_zoneHeights, i + ivec2(1, 1), 0);
    vec4 ha = vec4(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    float h = mix(mix(ha.x, ha.y, t.x), mix(ha.z, ha.w, t.x), t.y);
    // The depth is stored as its square root, so the shallows (where it draws the shore) are fine: squared before blending.
    vec2 da = mix(mix(a.ba * vec2(a.b, 1.0), b.ba * vec2(b.b, 1.0), t.x), mix(c.ba * vec2(c.b, 1.0), d.ba * vec2(d.b, 1.0), t.x), t.y);
    // The weather (u_waveHeight) raises a body's waves only as far as the wind has room to: w is that share, and z is put so that
    // u_waveHeight times it is the waves' height there.
    float e = textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).r;
    vec4 zone = vec4(u_zoneHeight.x + h * u_zoneHeight.y, da.x * u_zoneRange.w, da.y * u_zoneRange.y * mix(1.0, u_waveHeight, e) / max(u_waveHeight, 1e-3), e);
    return !inside && u_oceanOn > 0.5 ? vec4(u_oceanLevel, 1e6, u_oceanWaves, 1.0) : zone;
}
// The zone's field at p, decoded: the shore distance, the current, and the share of its waves a place keeps. Past the region: the ocean's.
vec4 waterZoneField(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    vec4 f = textureLod(u_zoneField, clamp(uv, 0.0, 1.0), 0.0);
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    if (!inside) return u_oceanOn > 0.5 ? vec4(1e6, 0.0, 0.0, 1.0) : vec4(-1.0, 0.0, 0.0, 0.0);
    float e = (f.r - 0.5) * 2.0;
    return vec4(e * abs(e) * u_zoneRange.x, (f.gb - 0.5) * 2.0 * u_zoneRange.z, f.a);
}
// The distance the surf runs in by at p: the shore's with a river's water taken for land and smoothed over the surf's length, so the crests
// come in as lines that turn to the shore as they near it and run straight across a river's mouth. Past the region: the ocean's.
float waterZoneSurf(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    bool inside = all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
    float e = (textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).g - 0.5) * 2.0;
    return inside ? e * abs(e) * u_zoneRange.x : u_oceanOn > 0.5 ? 1e6 : -1.0;
}
// How much of the surf a current leaves at p: none in a river, and more and more of it away from where the river runs out into open water.
float waterZoneStill(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    return textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).b;
}
// How steep the shore is at p: 0 a gentle beach (waves wash up it), 1 rock or a cliff (they burst white on it).
float waterZoneSteep(vec2 p) {
    vec2 uv = (p - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    return textureLod(u_zoneExposure, clamp(uv, 0.0, 1.0), 0.0).a;
}
// The surf (waves.ts surfHeight): its crests are lines of phase (the distance the surf runs in by), and it rises, breaks and runs up by
// shore, the real distance to the shore. x its height, y how broken it is (white water on and behind a breaking crest).
vec2 waterSurf(float phase, float shore, float height, float time) {
    if (height <= 0.0 || u_surfLength <= 0.0) return vec2(0.0);
    float reach = u_surfLength * 4.0;
    if (shore > reach || shore < -reach * 0.05) return vec2(0.0);
    float celerity = sqrt(9.8 * u_surfLength / 6.2831853) * u_surfSpeed;
    float u = fract(phase / u_surfLength + celerity * time / u_surfLength);
    float g = u > 0.8 ? smoothstep(0.0, 1.0, (u - 0.8) / 0.2) : 1.0 - smoothstep(0.0, 1.0, u / 0.8);
    float shoal = 1.0 - smoothstep(0.0, 1.0, (shore - reach * 0.25) / (reach * 0.75));
    float runUp = shore >= 0.0 ? 1.0 : 1.0 - smoothstep(0.0, 1.0, -shore / (reach * 0.05));
    float env = shoal * runUp;
    // It breaks in the inner third: the crest whitens, and the water behind it stays white a while.
    float breaking = 1.0 - smoothstep(reach * 0.15, reach * 0.4, shore);
    // A wave breaks only when it is steep for its length: a lake's small surf laps, the sea's breaks white.
    float steep = smoothstep(0.012, 0.045, height / u_surfLength);
    float white = breaking * steep * max(smoothstep(0.75, 1.0, g), (1.0 - smoothstep(0.0, 0.35, u)) * 0.8) * env;
    return vec2(height * g * g * env, white);
}
/// The first directional light that shines: xyz is where it stands in the sky, w 1 if there is one, color its colour and strength, tiles its place in the shadow atlas.
void waterSun(out vec4 dir, out vec4 color, out ivec2 tiles) {
    dir = vec4(0.0);
    color = vec4(0.0);
    tiles = ivec2(0);
    for (int i = 0; i < 16; ++i) {
        Light l = u_lights[i];
        if (l.posDir.z > 0.5 && l.posDir.z < 1.5 && l.color.a > 0.0) {
            dir = vec4(-normalize(vec3(l.posDir.x, l.posDir.y, l.posDir.w)), 1.0);
            color = l.color;
            tiles = ivec2(int(l.shadowMap.x), int(l.shadowMap.y));
            return;
        }
    }
}

/// Whether the sun reaches a point: one tap of the shadow map, 1 where there is none.
float waterSunVisibility(vec3 worldPos, int first, int count) {
#ifdef ES_RECEIVE_SHADOW
    if (u_shadowParams.x < 0.5 || count <= 0) return 1.0;
    for (int k = 0; k < 16; ++k) {
        if (k >= count) break;
        int t = first + k;
        vec4 c = u_shadowMatrix[t] * vec4(worldPos, 1.0);
        if (c.w <= 0.0) continue;
        vec3 proj = c.xyz / c.w;
        vec2 uv = proj.xy * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) continue;
        vec4 rect = u_shadowTile[t];
        vec2 at = rect.xy + uv * rect.z;
        vec2 lo = rect.xy + u_shadowParams.y * 0.5;
        vec2 hi = rect.xy + rect.z - u_shadowParams.y * 0.5;
        float d = unpackDepth(textureLod(u_shadowMap, clamp(at, lo, hi), 0.0).rgb);
        return d < clamp(proj.z * 0.5 + 0.5, 0.0, 1.0) - 0.0025 ? 0.0 : 1.0;
    }
#endif
    return 1.0;
}

/// What a ray from p along r meets in the picture of the scene the frame copied, as a colour with alpha 1, or alpha 0 where it meets nothing on screen.
vec4 waterReflect(vec3 p, vec3 r, float eyeDist) {
    float stride = max(0.5, eyeDist * 0.03);
    float travelled = stride;
    for (int i = 0; i < 20; ++i) {
        vec3 q = p + r * travelled;
        vec4 clip = u_projection * vec4(q, 1.0);
        if (clip.w <= 1e-4) break;
        vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
        float qDist = u_camera.w > 0.5 ? length(q - u_camera.xyz) : -dot(q, u_camera.xyz);
        float sceneDist = textureLod(u_sceneDepthMap, uv, 0.0).r;
        // The ray has gone behind something the picture holds: that is what it met, if it did not skip clean through a thin one.
        // Fading toward the picture's edge: a reflection that runs off screen thins away instead of stopping on a line.
        vec2 edge = min(uv, 1.0 - uv);
        if (sceneDist < qDist && qDist - sceneDist < stride * 2.0 + 1.0) return vec4(textureLod(u_sceneColor, uv, 0.0).rgb, smoothstep(0.0, 0.08, min(edge.x, edge.y)));
        stride *= 1.25;
        travelled += stride;
    }
    return vec4(0.0);
}

/// The slope the two detail normal maps add at p: each read at its own tile and drift, its z made from its x and z, mips flattening
/// what a pixel is too far to see. Fragment only: a vertex cannot take the derivatives a map is read with.
vec2 detailSlope(vec2 p, float time) {
    vec2 slope = vec2(0.0);
    if (u_detailStrength0 > 0.0) {
        vec2 n = texture(u_detailMap, (p + u_detailFlow0 * time) / u_detailTile0).rg * 2.0 - 1.0;
        slope += n / sqrt(max(1.0 - dot(n, n), 0.0625)) * u_detailStrength0;
    }
    if (u_detailStrength1 > 0.0) {
        vec2 n = texture(u_detailMap, (p + u_detailFlow1 * time) / u_detailTile1).ba * 2.0 - 1.0;
        slope += n / sqrt(max(1.0 - dot(n, n), 0.0625)) * u_detailStrength1;
    }
    return slope;
}

/// The slope of the surface at p and how near it is to a crest: the waves, amp times as high as u_waveHeight says, and the ripples they carry,
/// calm of their strength, flattened with distance.
vec2 waterSurface(vec2 p, float time, float dist, float amp, float calm, out float crest) {
    vec2 slope = waveSlope(p, time, dist, crest) * amp;
    crest *= calm;
    return slope + rippleSlope(p, time, dist) * calm;
}

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
#endif
    float time = u_time.x;
    vec3 viewDir = viewDirection(P);
    float waterDist = u_camera.w > 0.5 ? length(P - u_camera.xyz) : -dot(P, u_camera.xyz);

    // The surface: the long waves, then the ripples they carry, flattened with distance so the far water is calm rather than aliased.
    vec2 wp = u_waveSpace > 0.5 ? v_texCoord + u_origin : P.xz;
    // The zone's water at this pixel (texture reads, taken before any branch): how far in from the shore, how deep, how high the waves, the current.
    vec2 zoneUv = (wp - u_zoneOrigin) / max(u_zoneSize, vec2(1e-4));
    vec4 zoneTex = texture(u_zoneField, clamp(zoneUv, vec2(0.0), vec2(1.0)));
    vec4 zone = waterZoneAt(wp);
    bool zoneIn = all(greaterThanEqual(zoneUv, vec2(0.0))) && all(lessThanEqual(zoneUv, vec2(1.0)));
    bool zoneOn = u_zoneOn > 0.5 && u_waveSpace > 0.5;
    float shoreE = (zoneTex.r - 0.5) * 2.0;
    float shoreDist = !zoneOn ? 1e6 : zoneIn ? shoreE * abs(shoreE) * u_zoneRange.x : u_oceanOn > 0.5 ? 1e6 : -1.0;
    float shoreDepth = zoneOn ? zone.y : 1e6;
    // How high the waves stand (a multiple of u_waveHeight), and the share of them kept toward the shore, which calms the small ripples and the crests too.
    float calm = !zoneOn ? 1.0 : zoneIn ? zoneTex.a : 1.0;
    float damp = zoneOn ? zone.z * calm : 1.0;
    vec2 flow = zoneOn && zoneIn ? (zoneTex.gb - 0.5) * 2.0 * u_zoneRange.z : vec2(0.0);
    // The surf: its height across the shore distance gives its slope along the way to the shore, and where it breaks it is white.
    float still = zoneOn ? waterZoneStill(wp) : 1.0;
    float surfH = zoneOn ? u_surfHeight * u_waveHeight * zone.z * zone.w * still : 0.0;
    float surfStep = max(u_zoneSize.x / float(textureSize(u_zoneField, 0).x), 1e-3);
    float surfDist = zoneOn ? waterZoneSurf(wp) : 1e6;
    vec2 toSea = vec2(waterZoneSurf(wp + vec2(surfStep, 0.0)) - waterZoneSurf(wp - vec2(surfStep, 0.0)),
                      waterZoneSurf(wp + vec2(0.0, surfStep)) - waterZoneSurf(wp - vec2(0.0, surfStep))) / (2.0 * surfStep);
    // A distance to the shore climbs one unit a unit everywhere but on the ridge between two shores, where it turns back: there the way to
    // the shore is no one way, and the surf's slope fades out rather than flipping on a line.
    toSea *= smoothstep(0.55, 0.9, length(toSea));
    vec2 surf = waterSurf(surfDist, shoreDist, surfH, time);
    float surfRise = (waterSurf(surfDist + surfStep * 0.5, shoreDist + surfStep * 0.5, surfH, time).x
                    - waterSurf(surfDist - surfStep * 0.5, shoreDist - surfStep * 0.5, surfH, time).x) / surfStep;
    // The ripples at this pixel: their height on four sides gives the slope they add, and the foam is what they left (reads taken before any branch).
    vec2 ripUv = (wp - u_rippleOrigin) / max(u_rippleSize, 1e-4);
    vec4 ripC = texture(u_rippleMap, ripUv);
    vec2 ripStep = vec2(u_rippleTexel);
    float ripCell = max(u_rippleSize * u_rippleTexel, 1e-5);
    float ripL = texture(u_rippleMap, ripUv - vec2(ripStep.x, 0.0)).r, ripR = texture(u_rippleMap, ripUv + vec2(ripStep.x, 0.0)).r;
    float ripD = texture(u_rippleMap, ripUv - vec2(0.0, ripStep.y)).r, ripU = texture(u_rippleMap, ripUv + vec2(0.0, ripStep.y)).r;
    bool ripIn = u_rippleOn > 0.5 && u_waveSpace > 0.5 && all(greaterThanEqual(ripUv, vec2(0.0))) && all(lessThanEqual(ripUv, vec2(1.0)));
    // The window follows the camera: its edge fades out, so where it ends the ripples thin away instead of stopping on a line.
    vec2 ripEdge = min(ripUv, 1.0 - ripUv);
    float ripFade = smoothstep(0.0, 0.15, min(ripEdge.x, ripEdge.y));
    vec2 ripSlope = ripIn ? vec2(ripR - ripL, ripU - ripD) * u_rippleRange / ripCell * ripFade : vec2(0.0);
    float ripFoam = ripIn ? ripC.g * ripFade : 0.0;
    // How much foam the foam texture holds here (1 where none was given), read with the ripples, before any branch.
    float foamCover = texture(u_foamMap, (wp + u_foamFlow * time) / max(u_foamTile, 1e-4)).r;
    float crest;
    vec2 slope;
    if (dot(flow, flow) > 1e-6) {
        // A current: the surface rides it. Two copies of it are carried downstream a cycle at a time, each fading in as the other fades
        // out, so the moment one is put back at its start is hidden by the other.
        float cycle = max(u_flowCycle, 0.1);
        float ph0 = fract(time / cycle);
        float ph1 = fract(time / cycle + 0.5);
        float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
        float crest0, crest1;
        // Named copy0/copy1 because a t or s followed by a number is a texture unit's name (ShaderParser::materialOverflowUnits).
        vec2 copy0 = waterSurface(wp - flow * (ph0 * cycle), time, waterDist, damp, calm, crest0);
        vec2 copy1 = waterSurface(wp - flow * (ph1 * cycle), time, waterDist, damp, calm, crest1);
        slope = mix(copy1, copy0, w0);
        crest = mix(crest1, crest0, w0);
    } else {
        slope = waterSurface(wp, time, waterDist, damp, calm, crest);
    }
    // Rain rings are fine: where a pixel grows past a ring's crests they would shimmer, so they fade out before it.
    float rainFade = 1.0 - smoothstep(u_rippleLength * 8.0, u_rippleLength * 20.0, waterDist);
    slope += ripSlope + toSea * (surfRise * u_geoWaves) + rainRings(wp, time, u_rain) * rainFade + detailSlope(wp, time) * calm;
    vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 Ngeo = vec3(0.0, 1.0, 0.0);
#ifdef MESH_NORMALS
    if (u_waveSpace > 0.5) {
        // The zone's surface: the mesh's normal is up (the hook lifts the vertices and leaves it alone), and the slope leans along its uv
        // axes, which are x and z.
        Ngeo = normalize(v_worldNormal);
        N = perturbNormal(Ngeo, P, v_texCoord, normalize(vec3(-slope.x, -slope.y, 1.0)));
    }
#endif
    // Seen from below, the surface turns over, and light goes the other way through it: out of the water, into the air.
    bool below = dot(viewDir, Ngeo) < 0.0;
    if (below) { N = -N; Ngeo = -Ngeo; }

    // What is behind the water: the picture and the distance, where the frame took them.
    bool haveColor = texture(u_sceneColor, vec2(0.5)).a < 0.75;
    bool haveDepth = haveColor && texture(u_sceneDepthMap, vec2(0.5)).a < 0.75;
    vec4 clip0 = u_projection * vec4(P, 1.0);
    vec2 uv0 = clip0.xy / max(clip0.w, 1e-4) * 0.5 + 0.5;
    float behindDist = haveDepth ? texture(u_sceneDepthMap, clamp(uv0, vec2(0.001), vec2(0.999))).r : waterDist + u_fallbackDepth;
    float column0 = max(behindDist - waterDist, 0.0);
    // Past the shore only the surf's film is water: over ground no lower than the water, within its height of the rest level (further off
    // it is the mesh stretched between two waters' heights); the depth test cuts it where the ground rises above it. Asked here, before the
    // waves and the light are worked out for it: a shader that may discard late is not let test depth early, and what leaves here does not pay for them.
    bool film = abs(P.y + u_renderOrigin.y - zone.x) <= surf.x + u_waveHeight * zone.z + 1e-3;
    // Ground lower than the water there (a dry basin) takes no film. The picture's depth says it of this very pixel; the baked depth only
    // of whole texels (dry is 0 and any wet one beside it raises the blend), which would cut the film in the texels' steps.
    float under = haveDepth ? column0 * abs(viewDir.y) - 2.0 * (surf.x + u_waveHeight * zone.z) - 1.0 : shoreDepth - 1e-3;
    if (shoreDist < 0.0 && (surf.x <= 0.0 || under > 0.0 || !film)) discard;

    // Bent by the waves: the ray through the tilted surface against the ray through a flat one, over as much water as there is.
    float RATIO = below ? 1.333 : 1.0 / 1.333;
    vec3 bentWave = refract(-viewDir, N, RATIO);
    vec3 bentFlat = refract(-viewDir, Ngeo, RATIO);
    // Past the critical angle (about 49 degrees) nothing gets out of the water: refract gives nothing, and the surface is a mirror.
    if (below && (dot(bentWave, bentWave) < 0.5 || dot(bentFlat, bentFlat) < 0.5)) { bentWave = bentFlat = vec3(0.0); }
    float reach = min(column0, u_distortionRange) * u_refractionStrength;
    vec4 clip1 = u_projection * vec4(P + (bentWave - bentFlat) * reach, 1.0);
    vec2 uv1 = clip1.xy / max(clip1.w, 1e-4) * 0.5 + 0.5;
    vec3 behind = vec3(0.0);
    float column = column0;
    if (haveColor) {
        uv1 = clamp(uv1, vec2(0.001), vec2(0.999));
        float dist1 = haveDepth ? texture(u_sceneDepthMap, uv1).r : behindDist;
        // Something standing in front of the water cannot be what is seen through it: keep the straight-through lookup.
        if (dist1 < waterDist) { uv1 = clamp(uv0, vec2(0.001), vec2(0.999)); dist1 = behindDist; }
        behind = texture(u_sceneColor, uv1).rgb;
        column = max(dist1 - waterDist, 0.0);
        // The sun through the waves lights what is under them in a web of bright threads, where the sun reaches it and as much as the water between lets through.
        if (!below && haveDepth && u_causticStrength > 0.0 && u_causticOn > 0.5) {
            vec4 sunDir, sunColor;
            ivec2 sunTiles;
            waterSun(sunDir, sunColor, sunTiles);
            float cosUp = dot(sunDir.xyz, Ngeo);
            if (sunDir.w > 0.5 && cosUp > 0.05) {
                vec3 seabed = P + bentWave * column;
                float depthBelow = max(dot(P - seabed, Ngeo), 0.0);
                vec3 onSurface = seabed + sunDir.xyz * (depthBelow / max(cosUp, 0.15));
                float c = causticPattern(onSurface.xz / u_causticScale, time * u_causticSpeed);
                float reachSun = exp(-dot(u_absorption.rgb, vec3(1.0 / 3.0)) * u_density * depthBelow / max(cosUp, 0.15));
                behind *= 1.0 + u_causticStrength * c * cosUp * waterSunVisibility(seabed, sunTiles.x, sunTiles.y) * reachSun * min(sunColor.a, 2.0) * 0.5;
            }
        }
    }

    // The water in between takes the light out of it, red first, and gives back its own colour: more of it the deeper it goes.
    vec3 transmit = exp(-u_absorption.rgb * (u_density * column));
    // From below the water between the eye and the surface is the camera's own medium (the underwater effect fogs it), not a column behind the surface.
    if (below) transmit = vec3(1.0);
    float murk = 1.0 - dot(transmit, vec3(1.0 / 3.0));
    vec3 scatterColor = mix(u_shallowColor.rgb, u_deepColor.rgb, 1.0 - exp(-column * u_density * 0.5));

    // Foam: along the shore, where the water is shallow, broken by noise that moves; and on the crests of the waves.
    float vertical = column * max(abs(viewDir.y), 0.15);
    float foamScale = 1.0 / (u_rippleLength * 1.2);
    float breakup = waterNoise(wp * foamScale + vec2(time * 0.07, time * 0.05)) * 0.6 + waterNoise(wp * foamScale * 3.0 - vec2(time * 0.13, 0.0)) * 0.4;
    float pulse = 0.65 + 0.35 * sin(time * 0.9 + breakup * 6.0);
    float shore = haveDepth && u_foamWidth > 0.0 ? clamp((1.0 - vertical / (u_foamWidth * pulse)) * 1.25 - breakup * 1.15, 0.0, 1.0) : 0.0;
    // The baked shore foams too, where the depth buffer cannot say (no chain, no float targets) and along the outline the zone traced.
    if (zoneOn && u_foamWidth > 0.0) {
        // With the picture's depth the shallows foam by it, pixel by pixel; the baked depth then adds only the traced outline, not its texels.
        float baked = haveDepth ? shoreDist : min(shoreDist, shoreDepth);
        shore = max(shore, clamp((1.0 - baked / (u_foamWidth * pulse)) * 1.25 - breakup * 1.15, 0.0, 1.0));
        // How the shore takes its waves: against rock or a cliff they burst white; up a gentle beach they wash in a thin line only; and the
        // less room the wind has to raise them (a sheltered lake), the less of either.
        float pound = waterZoneSteep(wp);
        float swash = 1.0 - smoothstep(0.0, surfStep * 1.5, shoreDist);
        shore *= mix(swash * 0.6, 1.0, pound) * mix(0.3, 1.0, zone.w);
    }
    float onCrest = u_foamCrest > 0.0 ? smoothstep(1.0 - 0.3 * u_foamCrest, 1.0, crest) * smoothstep(0.35, 0.75, breakup) : 0.0;
    // A breaker whitens as much on a beach as the waves are big, but bursts whitest on rock.
    float surfFoam = surf.y * smoothstep(0.15, 0.6, breakup + surf.y * 0.4) * mix(0.2, 1.0, zoneOn ? waterZoneSteep(wp) : 1.0);
    float foam = clamp(max(max(max(shore, onCrest * u_foamCrest), ripFoam * (0.55 + 0.45 * breakup)), surfFoam), 0.0, 1.0);
    // The texture as coverage: a texel holding c of foam shows where the foam asked for is more than 1 - c, rising to full over the rest,
    // so thin foam keeps only the texture's densest marks and thick foam fills it. c = 1 leaves the foam as it was.
    foam = clamp((foam - (1.0 - foamCover)) / max(foamCover, 1e-3), 0.0, 1.0);
    // Foam floats on top: from under the water it is a thin shadow on the light, not a white sheet.
    if (below) foam *= 0.2;

    SurfaceExt ext = surfaceExtNone(N);
    ext.misc.x = 0.0204;
    vec3 albedo = mix(scatterColor * murk, u_foamColor.rgb, foam);
    // Rain stipples the surface finer than any ring: it reflects a little less sharply.
    float roughness = mix(u_roughness + 0.05 * clamp(u_rain, 0.0, 1.0), 0.7, foam);
    // The sea is seldom in shadow and its edge is lost in the waves: the sun's shadow is read as one hard edge here, not as a penumbra.
    g_shadowHard = 1.0;
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 1.0, 1.0, ext);
    float cosV = clamp(dot(N, viewDir), 0.0, 1.0);
    float fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosV, 5.0);
    if (below) {
        // Out of the water the glancing rays are reflected whole: Snell's window, a cone of sky overhead in a mirror of the water below it.
        float sinT = 1.333 * sqrt(max(1.0 - cosV * cosV, 0.0));
        float cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
        fresnel = sinT >= 1.0 ? 1.0 : 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosT, 5.0);
    }
    vec3 seen = behind * transmit * (1.0 - fresnel) * (1.0 - foam);
    // From below the water is a mirror past the critical angle, and what it mirrors is the world under it: the picture, followed along the reflected ray.
    vec3 mirror = vec3(0.0);
    if (below && fresnel > 0.02 && haveColor && haveDepth && u_mirror > 0.5) {
        vec4 met = waterReflect(P, reflect(-viewDir, N), waterDist);
        mirror = mix(mix(u_shallowColor.rgb, u_deepColor.rgb, 0.5) * 0.25, met.rgb, met.a);
    }
    seen += mirror * fresnel * (1.0 - foam);
    vec3 color = lit + seen;
    // From above, what the surface mirrors is the world as well as the sky: the reflected ray followed through the picture. Where it meets
    // something on screen that takes the reflected share's place; where it leaves the screen, the sky the lighting gave stays.
    if (!below && fresnel > 0.03 && haveColor && haveDepth && u_mirror > 0.5) {
        vec4 met = waterReflect(P, reflect(-viewDir, N), waterDist);
        color = mix(color, met.rgb, met.a * fresnel * (1.0 - foam) * 0.9);
    }
    // At its edge the water thins to nothing: over the last u_edgeSoftness of depth the ground behind shows through more and more, so the
    // water meets the shore along a soft line and not the zone's texel steps. The surf's white stays, riding up the sand.
    if (!below && haveColor && haveDepth && u_edgeSoftness > 0.0) {
        float thin = max(smoothstep(0.0, u_edgeSoftness, column0 * max(abs(viewDir.y), 0.15)), surfFoam);
        color = mix(textureLod(u_sceneColor, clamp(uv0, vec2(0.001), vec2(0.999)), 0.0).rgb, color, thin);
    }
    fragColor = vec4(color, haveColor ? 1.0 : 0.85);
#ifdef ES_GBUFFER
    // 0.72: a surface, and water (see readSurface): what lands on it is the water's, not a wet floor's.
    fragSurface = vec4(packNormal(normalize(N)), roughness, 0.72);
    fragAlbedo = vec4(0.0);
#endif
}
#pragma end

#pragma fragment wgsl
#ifdef ES_GBUFFER
struct FragOut {
    @location(0) color : vec4f,
    @location(1) surface : vec4f,
    @location(2) albedo : vec4f,
};

fn packNormal(n : vec3f) -> vec2f {
    let a = n / (abs(n.x) + abs(n.y) + abs(n.z));
    let sgn = vec2f(select(-1.0, 1.0, a.x >= 0.0), select(-1.0, 1.0, a.y >= 0.0));
    var e = a.xy;
    if (a.z < 0.0) { e = (vec2f(1.0) - abs(a.yx)) * sgn; }
    return e * 0.5 + 0.5;
}
#endif

fn waterBend(p : vec2f, span : f32) -> vec4f {
    let q = p / span;
    return vec4f(p.x + span * 0.45 * sin(q.y * 0.73 + 1.3), p.y + span * 0.45 * sin(q.x * 0.61 + 2.7),
                 0.3285 * cos(q.y * 0.73 + 1.3), 0.2745 * cos(q.x * 0.61 + 2.7));
}
fn waterHash(p0 : vec2f) -> f32 {
    var p = fract(p0 * vec2f(0.1031, 0.1030));
    p = p + dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
}
fn waterNoise(p : vec2f) -> f32 {
    let i = floor(p);
    var f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(waterHash(i), waterHash(i + vec2f(1.0, 0.0)), f.x),
               mix(waterHash(i + vec2f(0.0, 1.0)), waterHash(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn rippleSlope(p : vec2f, time : f32, dist : f32) -> vec2f {
    let SET = array<vec3f, 6>(vec3f(-14.0, 1.0, 0.0), vec3f(33.0, 0.71, 1.7), vec3f(-58.0, 0.53, 3.1),
                              vec3f(11.0, 0.39, 4.4), vec3f(74.0, 0.29, 0.9), vec3f(-41.0, 0.21, 2.6));
    let base = radians(mc.u_waveDirection);
    var slope = vec2f(0.0);
    for (var i = 0; i < 6; i++) {
        let w = SET[i];
        let len = mc.u_rippleLength * w.y;
        let k = 6.2831853 / len;
        let a = base + radians(w.x);
        let d = vec2f(sin(a), cos(a));
        let theta = k * dot(d, p) - sqrt(9.8 * k) * mc.u_waveSpeed * time + w.z;
        let seen = clamp(1.0 - dist / (len * 150.0), 0.0, 1.0);
        slope = slope + d * (cos(theta) * seen * 0.33);
    }
    return slope * mc.u_rippleStrength;
}

fn rainRings(p : vec2f, time : f32, rain : f32) -> vec2f {
    var slope = vec2f(0.0);
    if (rain <= 0.0) { return slope; }
    let cellSize = mc.u_rippleLength * 0.35;
    let K = 52.0;
    for (var layer = 0; layer < 2; layer++) {
        let q = p / cellSize + f32(layer) * vec2f(0.37, 0.71);
        let cell = floor(q) + f32(layer) * 113.0;
        let h = waterHash(cell);
        let rate = 0.8 + 0.5 * h;
        let cycle = time * rate + h * 7.31;
        let drop = cell + floor(cycle) * vec2f(17.0, 31.0);
        if (waterHash(drop + 0.5) > clamp(rain * 0.4, 0.0, 0.9)) { continue; }
        let t = fract(cycle);
        let centre = floor(q) + 0.25 + 0.5 * vec2f(waterHash(drop + 3.1), waterHash(drop + 5.7));
        let d = q - centre;
        let r = max(length(d), 1e-4);
        let x = r - t * 0.45;
        let env = (1.0 - t) * (1.0 - t) * exp(-x * x * 900.0);
        let dh = (cos(x * K) - x * 1800.0 / K * sin(x * K)) * env;
        slope = slope + d / r * dh * 0.3;
    }
    return slope;
}

struct Waves { slope : vec2f, crest : f32 };

fn waveSlope(p : vec2f, time : f32, dist : f32) -> Waves {
    var wave = array<vec4f, 4>(vec4f(0.0, 1.0, 1.0, 1.0), vec4f(28.0, 0.62, 0.55, 1.1), vec4f(-37.0, 0.37, 0.3, 1.2), vec4f(71.0, 0.21, 0.15, 1.35));
    var slope = vec2f(0.0);
    var crestSum = 0.0;
    var weightSum = 0.0;
    let base = radians(mc.u_waveDirection);
    let bend = waterBend(p, mc.u_waveLength);
    for (var i : i32 = 0; i < 4; i = i + 1) {
        if (f32(i) >= mc.u_waveCount) { break; }
        let spec = wave[i];
        let span = mc.u_waveLength * spec.y;
        let k = 6.2831853 / span;
        let a = base + radians(spec.x);
        let d = vec2f(sin(a), cos(a));
        let omega = sqrt(9.8 * k) * mc.u_waveSpeed * spec.w;
        let theta = k * dot(d, bend.xy) - omega * time;
        let e = exp(sin(theta) - 1.0);
        let seen = clamp(1.0 - dist / (span * 220.0), 0.0, 1.0);
        slope = slope + d * (mc.u_waveHeight * spec.z * e * cos(theta) * k * seen);
        crestSum = crestSum + e * spec.z;
        weightSum = weightSum + spec.z;
    }
    var out : Waves;
    out.slope = vec2f(slope.x + slope.y * bend.w, slope.y + slope.x * bend.z);
    out.crest = crestSum / weightSum;
    return out;
}

${CAUSTICS_WGSL}
fn waterZoneAt(p : vec2f) -> vec4f {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    let size = vec2i(textureDimensions(u_zoneHeights, 0));
    let f = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(size - vec2i(1));
    let i = min(vec2i(floor(f)), max(size - vec2i(2), vec2i(0)));
    let t = f - vec2f(i);
    let a = textureLoad(u_zoneHeights, i, 0);
    let b = textureLoad(u_zoneHeights, i + vec2i(1, 0), 0);
    let c = textureLoad(u_zoneHeights, i + vec2i(0, 1), 0);
    let d = textureLoad(u_zoneHeights, i + vec2i(1, 1), 0);
    let ha = vec4f(a.r * 65280.0 + a.g * 255.0, b.r * 65280.0 + b.g * 255.0, c.r * 65280.0 + c.g * 255.0, d.r * 65280.0 + d.g * 255.0) / 65535.0;
    let h = mix(mix(ha.x, ha.y, t.x), mix(ha.z, ha.w, t.x), t.y);
    // The depth is stored as its square root, so the shallows (where it draws the shore) are fine: squared before blending.
    let da = mix(mix(a.ba * vec2f(a.b, 1.0), b.ba * vec2f(b.b, 1.0), t.x), mix(c.ba * vec2f(c.b, 1.0), d.ba * vec2f(d.b, 1.0), t.x), t.y);
    let e = textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).r;
    if (!inside && mc.u_oceanOn > 0.5) { return vec4f(mc.u_oceanLevel, 1e6, mc.u_oceanWaves, 1.0); }
    return vec4f(mc.u_zoneHeight.x + h * mc.u_zoneHeight.y, da.x * mc.u_zoneRange.w,
                 da.y * mc.u_zoneRange.y * mix(1.0, mc.u_waveHeight, e) / max(mc.u_waveHeight, 1e-3), e);
}
fn waterZoneField(p : vec2f) -> vec4f {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let f = textureSampleLevel(u_zoneField, u_zoneField_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    if (!inside) {
        if (mc.u_oceanOn > 0.5) { return vec4f(1e6, 0.0, 0.0, 1.0); }
        return vec4f(-1.0, 0.0, 0.0, 0.0);
    }
    let e = (f.r - 0.5) * 2.0;
    return vec4f(e * abs(e) * mc.u_zoneRange.x, (f.gb - vec2f(0.5)) * 2.0 * mc.u_zoneRange.z, f.a);
}
// The distance the surf runs in by at p: the shore's with a river's water taken for land and smoothed over the surf's length, so the crests
// come in as lines that turn to the shore as they near it and run straight across a river's mouth. Past the region: the ocean's.
fn waterZoneSurf(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let inside = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
    let e = (textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).g - 0.5) * 2.0;
    if (inside) { return e * abs(e) * mc.u_zoneRange.x; }
    if (mc.u_oceanOn > 0.5) { return 1e6; }
    return -1.0;
}
// How much of the surf a current leaves at p: none in a river, and more and more of it away from where the river runs out into open water.
fn waterZoneStill(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    return textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).b;
}
// How steep the shore is at p: 0 a gentle beach (waves wash up it), 1 rock or a cliff (they burst white on it).
fn waterZoneSteep(p : vec2f) -> f32 {
    let uv = (p - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    return textureSampleLevel(u_zoneExposure, u_zoneExposure_s, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0).a;
}
fn waterSurf(phase : f32, shore : f32, height : f32, time : f32) -> vec2f {
    if (height <= 0.0 || mc.u_surfLength <= 0.0) { return vec2f(0.0); }
    let reach = mc.u_surfLength * 4.0;
    if (shore > reach || shore < -reach * 0.05) { return vec2f(0.0); }
    let celerity = sqrt(9.8 * mc.u_surfLength / 6.2831853) * mc.u_surfSpeed;
    let u = fract(phase / mc.u_surfLength + celerity * time / mc.u_surfLength);
    var g = 1.0 - smoothstep(0.0, 1.0, u / 0.8);
    if (u > 0.8) { g = smoothstep(0.0, 1.0, (u - 0.8) / 0.2); }
    let shoal = 1.0 - smoothstep(0.0, 1.0, (shore - reach * 0.25) / (reach * 0.75));
    var runUp = 1.0;
    if (shore < 0.0) { runUp = 1.0 - smoothstep(0.0, 1.0, -shore / (reach * 0.05)); }
    let env = shoal * runUp;
    let breaking = 1.0 - smoothstep(reach * 0.15, reach * 0.4, shore);
    let steep = smoothstep(0.012, 0.045, height / mc.u_surfLength);
    let white = breaking * steep * max(smoothstep(0.75, 1.0, g), (1.0 - smoothstep(0.0, 0.35, u)) * 0.8) * env;
    return vec2f(height * g * g * env, white);
}
struct WaterSun { dir : vec4f, color : vec4f, tiles : vec2i };
/// The first directional light that shines: dir.xyz is where it stands in the sky, dir.w 1 if there is one.
fn waterSun() -> WaterSun {
    var s : WaterSun;
    s.dir = vec4f(0.0);
    s.color = vec4f(0.0);
    s.tiles = vec2i(0, 0);
    for (var i = 0; i < 16; i++) {
        let l = lc.u_lights[i];
        if (l.posDir.z > 0.5 && l.posDir.z < 1.5 && l.color.a > 0.0) {
            s.dir = vec4f(-normalize(vec3f(l.posDir.x, l.posDir.y, l.posDir.w)), 1.0);
            s.color = l.color;
            s.tiles = vec2i(i32(l.shadowMap.x), i32(l.shadowMap.y));
            return s;
        }
    }
    return s;
}

fn waterSunVisibility(worldPos : vec3f, first : i32, count : i32) -> f32 {
    if (lc.u_shadowParams.x < 0.5 || count <= 0) { return 1.0; }
    for (var k = 0; k < 16; k++) {
        if (k >= count) { break; }
        let t = first + k;
        let c = lc.u_shadowMatrix[t] * vec4f(worldPos, 1.0);
        if (c.w <= 0.0) { continue; }
        let proj = c.xyz / c.w;
        let uv = proj.xy * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || proj.z < 0.0 || proj.z > 1.0) { continue; }
        let rect = lc.u_shadowTile[t];
        let base = vec2f(rect.x, 1.0 - rect.y - rect.z);
        let at = base + vec2f(uv.x, 1.0 - uv.y) * rect.z;
        let lo = base + lc.u_shadowParams.y * 0.5;
        let hi = base + rect.z - lc.u_shadowParams.y * 0.5;
        let d = unpackDepth(textureSampleLevel(t2, s2, clamp(at, lo, hi), 0.0).rgb);
        return select(1.0, 0.0, d < clamp(proj.z * 0.5 + 0.5, 0.0, 1.0) - 0.0025);
    }
    return 1.0;
}

/// What a ray from p along r meets in the picture of the scene the frame copied: the colour (xyz) and 1 (w), or w 0 where it meets nothing on screen.
fn waterReflect(p : vec3f, r : vec3f, eyeDist : f32) -> vec4f {
    var stride = max(0.5, eyeDist * 0.03);
    var travelled = stride;
    for (var i = 0; i < 20; i++) {
        let q = p + r * travelled;
        let clip = frame.projection * vec4f(q, 1.0);
        if (clip.w <= 1e-4) { break; }
        let uv = vec2f(clip.x / clip.w * 0.5 + 0.5, 0.5 - clip.y / clip.w * 0.5);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
        var qDist = -dot(q, frame.camera.xyz);
        if (frame.camera.w > 0.5) { qDist = length(q - frame.camera.xyz); }
        let sceneDist = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, uv, 0.0).r;
        let edge = min(uv, vec2f(1.0) - uv);
        if (sceneDist < qDist && qDist - sceneDist < stride * 2.0 + 1.0) { return vec4f(textureSampleLevel(u_sceneColor, u_sceneColor_s, uv, 0.0).rgb, smoothstep(0.0, 0.08, min(edge.x, edge.y))); }
        stride = stride * 1.25;
        travelled = travelled + stride;
    }
    return vec4f(0.0);
}

/// The slope the two detail normal maps add at p: each read at its own tile and drift, mips flattening what a pixel is too far to see. Fragment only.
fn detailSlope(p : vec2f, time : f32) -> vec2f {
    var slope = vec2f(0.0);
    if (mc.u_detailStrength0 > 0.0) {
        let n = textureSample(u_detailMap, u_detailMap_s, (p + mc.u_detailFlow0 * time) / mc.u_detailTile0).rg * 2.0 - vec2f(1.0);
        slope = slope + n / sqrt(max(1.0 - dot(n, n), 0.0625)) * mc.u_detailStrength0;
    }
    if (mc.u_detailStrength1 > 0.0) {
        let n = textureSample(u_detailMap, u_detailMap_s, (p + mc.u_detailFlow1 * time) / mc.u_detailTile1).ba * 2.0 - vec2f(1.0);
        slope = slope + n / sqrt(max(1.0 - dot(n, n), 0.0625)) * mc.u_detailStrength1;
    }
    return slope;
}

/// The slope of the surface at p (x, y) and how near it is to a crest (z): the waves, and the ripples they carry, flattened with distance.
fn waterSurface(p : vec2f, time : f32, dist : f32, amp : f32, calm : f32) -> vec3f {
    let waves = waveSlope(p, time, dist);
    return vec3f(waves.slope * amp + rippleSlope(p, time, dist) * calm, waves.crest * calm);
}

#ifdef ES_GBUFFER
@fragment fn fs_main(v : VSOut) -> FragOut {
#else
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
#endif
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
#ifdef MESH_NORMALS
    let P = v.v_worldXYZ;
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
#endif
    let time = tc.u_time.x;
    let viewDir = viewDirection(P);
    var waterDist = -dot(P, frame.camera.xyz);
    if (frame.camera.w > 0.5) { waterDist = length(P - frame.camera.xyz); }

    var wp = P.xz;
    if (mc.u_waveSpace > 0.5) { wp = v.v_texCoord + mc.u_origin; }
    let zoneUv = (wp - mc.u_zoneOrigin) / max(mc.u_zoneSize, vec2f(1e-4));
    let zoneTex = textureSample(u_zoneField, u_zoneField_s, clamp(zoneUv, vec2f(0.0), vec2f(1.0)));
    let zone = waterZoneAt(wp);
    let zoneIn = all(zoneUv >= vec2f(0.0)) && all(zoneUv <= vec2f(1.0));
    let zoneOn = mc.u_zoneOn > 0.5 && mc.u_waveSpace > 0.5;
    var shoreDist = 1e6;
    var shoreDepth = 1e6;
    var damp = 1.0;
    var calm = 1.0;
    var flow = vec2f(0.0);
    if (zoneOn) {
        shoreDepth = zone.y;
        if (zoneIn) { let shoreE = (zoneTex.r - 0.5) * 2.0; shoreDist = shoreE * abs(shoreE) * mc.u_zoneRange.x; flow = (zoneTex.gb - vec2f(0.5)) * 2.0 * mc.u_zoneRange.z; calm = zoneTex.a; }
        else if (mc.u_oceanOn < 0.5) { shoreDist = -1.0; }
        damp = zone.z * calm;
    }
    var still = 1.0;
    if (zoneOn) { still = waterZoneStill(wp); }
    var surfH = 0.0;
    if (zoneOn) { surfH = mc.u_surfHeight * mc.u_waveHeight * zone.z * zone.w * still; }
    let surfStep = max(mc.u_zoneSize.x / f32(textureDimensions(u_zoneField, 0).x), 1e-3);
    var surfDist = 1e6;
    if (zoneOn) { surfDist = waterZoneSurf(wp); }
    let toSeaRaw = vec2f(waterZoneSurf(wp + vec2f(surfStep, 0.0)) - waterZoneSurf(wp - vec2f(surfStep, 0.0)),
                         waterZoneSurf(wp + vec2f(0.0, surfStep)) - waterZoneSurf(wp - vec2f(0.0, surfStep))) / (2.0 * surfStep);
    let toSea = toSeaRaw * smoothstep(0.55, 0.9, length(toSeaRaw));
    let surf = waterSurf(surfDist, shoreDist, surfH, time);
    let surfRise = (waterSurf(surfDist + surfStep * 0.5, shoreDist + surfStep * 0.5, surfH, time).x
                  - waterSurf(surfDist - surfStep * 0.5, shoreDist - surfStep * 0.5, surfH, time).x) / surfStep;
    // The ripples at this pixel: their height on four sides gives the slope they add, and the foam is what they left (taken in uniform control flow).
    let ripUv = (wp - mc.u_rippleOrigin) / max(mc.u_rippleSize, 1e-4);
    let ripC = textureSample(u_rippleMap, u_rippleMap_s, ripUv);
    let ripCell = max(mc.u_rippleSize * mc.u_rippleTexel, 1e-5);
    let ripL = textureSample(u_rippleMap, u_rippleMap_s, ripUv - vec2f(mc.u_rippleTexel, 0.0)).r;
    let ripR = textureSample(u_rippleMap, u_rippleMap_s, ripUv + vec2f(mc.u_rippleTexel, 0.0)).r;
    let ripD = textureSample(u_rippleMap, u_rippleMap_s, ripUv - vec2f(0.0, mc.u_rippleTexel)).r;
    let ripU = textureSample(u_rippleMap, u_rippleMap_s, ripUv + vec2f(0.0, mc.u_rippleTexel)).r;
    let ripIn = mc.u_rippleOn > 0.5 && mc.u_waveSpace > 0.5 && all(ripUv >= vec2f(0.0)) && all(ripUv <= vec2f(1.0));
    var ripSlope = vec2f(0.0);
    var ripFoam = 0.0;
    let ripEdge = min(ripUv, vec2f(1.0) - ripUv);
    let ripFade = smoothstep(0.0, 0.15, min(ripEdge.x, ripEdge.y));
    if (ripIn) { ripSlope = vec2f(ripR - ripL, ripU - ripD) * mc.u_rippleRange / ripCell * ripFade; ripFoam = ripC.g * ripFade; }
    // How much foam the foam texture holds here (1 where none was given), read in uniform control flow with the ripples.
    let foamCover = textureSample(u_foamMap, u_foamMap_s, (wp + mc.u_foamFlow * time) / max(mc.u_foamTile, 1e-4)).r;
    var surface = vec3f(0.0);
    if (dot(flow, flow) > 1e-6) {
        // A current: two copies of the surface carried downstream a cycle at a time, each fading in as the other fades out.
        let cycle = max(mc.u_flowCycle, 0.1);
        let ph0 = fract(time / cycle);
        let ph1 = fract(time / cycle + 0.5);
        let w0 = 1.0 - abs(2.0 * ph0 - 1.0);
        // Named copy0/copy1: in WGSL an s followed by a number names a texture unit's sampler.
        let copy0 = waterSurface(wp - flow * (ph0 * cycle), time, waterDist, damp, calm);
        let copy1 = waterSurface(wp - flow * (ph1 * cycle), time, waterDist, damp, calm);
        surface = mix(copy1, copy0, w0);
    } else {
        surface = waterSurface(wp, time, waterDist, damp, calm);
    }
    var waves : Waves;
    waves.crest = surface.z;
    let rainFade = 1.0 - smoothstep(mc.u_rippleLength * 8.0, mc.u_rippleLength * 20.0, waterDist);
    var slope = surface.xy + ripSlope + toSea * (surfRise * mc.u_geoWaves) + rainRings(wp, time, mc.u_rain) * rainFade + detailSlope(wp, time) * calm;
    var N = normalize(vec3f(-slope.x, 1.0, -slope.y));
    var Ngeo = vec3f(0.0, 1.0, 0.0);
#ifdef MESH_NORMALS
    if (mc.u_waveSpace > 0.5) {
        Ngeo = normalize(v.v_worldNormal);
        N = perturbNormal(Ngeo, P, v.v_texCoord, normalize(vec3f(-slope.x, -slope.y, 1.0)));
    }
#endif
    let below = dot(viewDir, Ngeo) < 0.0;
    if (below) { N = -N; Ngeo = -Ngeo; }

    let haveColor = textureSampleLevel(u_sceneColor, u_sceneColor_s, vec2f(0.5), 0.0).a < 0.75;
    let haveDepth = haveColor && textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, vec2f(0.5), 0.0).a < 0.75;
    let clip0 = frame.projection * vec4f(P, 1.0);
    let w0 = max(clip0.w, 1e-4);
    // This device's rows run down the texture, so clip y is flipped on the way to a uv.
    let uv0 = vec2f(clip0.x / w0 * 0.5 + 0.5, 0.5 - clip0.y / w0 * 0.5);
    var behindDist = waterDist + mc.u_fallbackDepth;
    if (haveDepth) { behindDist = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, clamp(uv0, vec2f(0.001), vec2f(0.999)), 0.0).r; }
    let column0 = max(behindDist - waterDist, 0.0);

    var ratio = 1.0 / 1.333;
    if (below) { ratio = 1.333; }
    var bentWave = refract(-viewDir, N, ratio);
    var bentFlat = refract(-viewDir, Ngeo, ratio);
    if (below && (dot(bentWave, bentWave) < 0.5 || dot(bentFlat, bentFlat) < 0.5)) { bentWave = vec3f(0.0); bentFlat = vec3f(0.0); }
    let reach = min(column0, mc.u_distortionRange) * mc.u_refractionStrength;
    let clip1 = frame.projection * vec4f(P + (bentWave - bentFlat) * reach, 1.0);
    let w1 = max(clip1.w, 1e-4);
    var uv1 = vec2f(clip1.x / w1 * 0.5 + 0.5, 0.5 - clip1.y / w1 * 0.5);
    var behind = vec3f(0.0);
    var column = column0;
    if (haveColor) {
        uv1 = clamp(uv1, vec2f(0.001), vec2f(0.999));
        var dist1 = behindDist;
        if (haveDepth) { dist1 = textureSampleLevel(u_sceneDepthMap, u_sceneDepthMap_s, uv1, 0.0).r; }
        if (dist1 < waterDist) { uv1 = clamp(uv0, vec2f(0.001), vec2f(0.999)); dist1 = behindDist; }
        behind = textureSampleLevel(u_sceneColor, u_sceneColor_s, uv1, 0.0).rgb;
        column = max(dist1 - waterDist, 0.0);
        if (!below && haveDepth && mc.u_causticStrength > 0.0 && mc.u_causticOn > 0.5) {
            let sun = waterSun();
            let cosUp = dot(sun.dir.xyz, Ngeo);
            if (sun.dir.w > 0.5 && cosUp > 0.05) {
                let seabed = P + bentWave * column;
                let depthBelow = max(dot(P - seabed, Ngeo), 0.0);
                let onSurface = seabed + sun.dir.xyz * (depthBelow / max(cosUp, 0.15));
                let c = causticPattern(onSurface.xz / mc.u_causticScale, time * mc.u_causticSpeed);
                let reachSun = exp(-dot(mc.u_absorption.rgb, vec3f(1.0 / 3.0)) * mc.u_density * depthBelow / max(cosUp, 0.15));
                behind = behind * (1.0 + mc.u_causticStrength * c * cosUp * waterSunVisibility(seabed, sun.tiles.x, sun.tiles.y) * reachSun * min(sun.color.a, 2.0) * 0.5);
            }
        }
    }

    var transmit = exp(-mc.u_absorption.rgb * (mc.u_density * column));
    if (below) { transmit = vec3f(1.0); }
    let murk = 1.0 - dot(transmit, vec3f(1.0 / 3.0));
    let scatterColor = mix(mc.u_shallowColor.rgb, mc.u_deepColor.rgb, vec3f(1.0 - exp(-column * mc.u_density * 0.5)));

    let vertical = column * max(abs(viewDir.y), 0.15);
    let foamScale = 1.0 / (mc.u_rippleLength * 1.2);
    let breakup = waterNoise(wp * foamScale + vec2f(time * 0.07, time * 0.05)) * 0.6 + waterNoise(wp * foamScale * 3.0 - vec2f(time * 0.13, 0.0)) * 0.4;
    let pulse = 0.65 + 0.35 * sin(time * 0.9 + breakup * 6.0);
    var shore = 0.0;
    if (haveDepth && mc.u_foamWidth > 0.0) { shore = clamp((1.0 - vertical / (mc.u_foamWidth * pulse)) * 1.25 - breakup * 1.15, 0.0, 1.0); }
    if (zoneOn && mc.u_foamWidth > 0.0) {
        // With the picture's depth the shallows foam by it, pixel by pixel; the baked depth then adds only the traced outline, not its texels.
        var baked = min(shoreDist, shoreDepth);
        if (haveDepth) { baked = shoreDist; }
        shore = max(shore, clamp((1.0 - baked / (mc.u_foamWidth * pulse)) * 1.25 - breakup * 1.15, 0.0, 1.0));
        // How the shore takes its waves: against rock or a cliff they burst white; up a gentle beach they wash in a thin line only; and the
        // less room the wind has to raise them (a sheltered lake), the less of either.
        let pound = waterZoneSteep(wp);
        let swash = 1.0 - smoothstep(0.0, surfStep * 1.5, shoreDist);
        shore = shore * mix(swash * 0.6, 1.0, pound) * mix(0.3, 1.0, zone.w);
    }
    var onCrest = 0.0;
    if (mc.u_foamCrest > 0.0) { onCrest = smoothstep(1.0 - 0.3 * mc.u_foamCrest, 1.0, waves.crest) * smoothstep(0.35, 0.75, breakup); }
    // A breaker whitens as much on a beach as the waves are big, but bursts whitest on rock.
    var steepHere = 1.0;
    if (zoneOn) { steepHere = waterZoneSteep(wp); }
    let surfFoam = surf.y * smoothstep(0.15, 0.6, breakup + surf.y * 0.4) * mix(0.2, 1.0, steepHere);
    var foam = clamp(max(max(max(shore, onCrest * mc.u_foamCrest), ripFoam * (0.55 + 0.45 * breakup)), surfFoam), 0.0, 1.0);
    // The texture as coverage (see the GLSL): c = 1 leaves the foam as it was.
    foam = clamp((foam - (1.0 - foamCover)) / max(foamCover, 1e-3), 0.0, 1.0);
    if (below) { foam = foam * 0.2; }

    var ext = surfaceExtNone(N);
    ext.misc.x = 0.0204;
    let albedo = mix(scatterColor * murk, mc.u_foamColor.rgb, vec3f(foam));
    let roughness = mix(mc.u_roughness + 0.05 * clamp(mc.u_rain, 0.0, 1.0), 0.7, foam);
    g_shadowHard = 1.0;
    let lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, roughness, 1.0, 1.0, ext);
    let cosV = clamp(dot(N, viewDir), 0.0, 1.0);
    var fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosV, 5.0);
    if (below) {
        let sinT = 1.333 * sqrt(max(1.0 - cosV * cosV, 0.0));
        let cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
        if (sinT >= 1.0) { fresnel = 1.0; } else { fresnel = 0.0204 + (1.0 - 0.0204) * pow(1.0 - cosT, 5.0); }
    }
    var seen = behind * transmit * (1.0 - fresnel) * (1.0 - foam);
    var mirror = vec3f(0.0);
    if (below && fresnel > 0.02 && haveColor && haveDepth && mc.u_mirror > 0.5) {
        let met = waterReflect(P, reflect(-viewDir, N), waterDist);
        mirror = mix(mix(mc.u_shallowColor.rgb, mc.u_deepColor.rgb, vec3f(0.5)) * 0.25, met.xyz, vec3f(met.w));
    }
    seen = seen + mirror * fresnel * (1.0 - foam);
    var color = lit + seen;
    if (!below && fresnel > 0.03 && haveColor && haveDepth && mc.u_mirror > 0.5) {
        let met = waterReflect(P, reflect(-viewDir, N), waterDist);
        color = mix(color, met.xyz, met.w * fresnel * (1.0 - foam) * 0.9);
    }
    if (!below && haveColor && haveDepth && mc.u_edgeSoftness > 0.0) {
        let thin = max(smoothstep(0.0, mc.u_edgeSoftness, column0 * max(abs(viewDir.y), 0.15)), surfFoam);
        color = mix(textureSampleLevel(u_sceneColor, u_sceneColor_s, clamp(uv0, vec2f(0.001), vec2f(0.999)), 0.0).rgb, color, vec3f(thin));
    }
    var alpha = 0.85;
    if (haveColor) { alpha = 1.0; }
    let film = abs(P.y + frame.renderOrigin.y - zone.x) <= surf.x + mc.u_waveHeight * zone.z + 1e-3;
    // Ground lower than the water there (a dry basin) takes no film. The picture's depth says it of this very pixel; the baked depth only
    // of whole texels (dry is 0 and any wet one beside it raises the blend), which would cut the film in the texels' steps.
    var under = shoreDepth - 1e-3;
    if (haveDepth) { under = column0 * abs(viewDir.y) - 2.0 * (surf.x + mc.u_waveHeight * zone.z) - 1.0; }
    if (shoreDist < 0.0 && (surf.x <= 0.0 || under > 0.0 || !film)) { discard; }
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(color, alpha);
    frag.surface = vec4f(packNormal(normalize(N)), roughness, 0.72);
    frag.albedo = vec4f(0.0);
    return frag;
#else
    return vec4f(color, alpha);
#endif
}
#pragma end
`;

export const WATER_SHADER_TEMPLATE = makeBuiltinShaderTemplate('water', 'Water',
    'Waves, refraction, reflection, depth absorption and foam for a horizontal body of water.', WATER);
