// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  foliageShader.ts
 * @brief The Foliage built-in shader: plants that sway in the wind.
 *
 * The shader source lives with the module that installs it, not in the core's list of built-in shaders: a package that does not install the module carries none of it.
 */
import { makeBuiltinShaderTemplate } from '../render/builtinShaders';


// Plants that sway: the vertex hook bends by the weights the Foliage component paints in the vertex colour (red the height up the plant,
// green its own phase, blue how much light reaches it), with a travelling gust and a flutter. Two-sided and translucent.
const FOLIAGE = `#pragma shader "Foliage"
#pragma version 300 es
#pragma domain Lit
#pragma param u_baseColor color default(0.14,0.30,0.08,1)
#pragma param u_tipColor color default(0.55,0.72,0.25,1)
// How far up the plant the tip's colour begins: 0 runs from the root (a blade), 0.85 keeps a stem the base colour under a head of the tip's.
#pragma param u_tipFrom float default(0) range(0,0.99) ui(slider)
// A texture over the plant (leaves, bark), and whether it is used at all: grass is drawn from the two colours and wants none.
#pragma param u_albedo texture default(white)
#pragma param u_useTexture float default(0) range(0,1) ui(slider)
#pragma param u_alphaCutoff float default(0.5) range(0,1) ui(slider)
#pragma coverage u_alphaCutoff
// A picture over the field that colours the plants by where they stand (the Foliage component writes it): mixed in by its alpha, from
// u_colorMapFrom up the plant, over the area whose corner and size u_colorMapArea is.
#pragma param u_colorMap texture default(white)
#pragma param u_colorMapStrength float default(0) range(0,1) ui(slider)
#pragma param u_colorMapFrom float default(0) range(0,1) ui(slider)
#pragma param u_colorMapArea vec4 default(0,0,1,1)
#pragma param u_roughness float default(0.8) range(0,1) ui(slider)
// Light that comes through a leaf from behind, and how thick the leaf is.
#pragma param u_translucency float default(0.5) range(0,1) ui(slider)
#pragma param u_thickness float default(0.3) range(0,1) ui(slider)
// The wind: how hard it blows, how fast it moves, where it comes from (degrees), how long a gust is (the lower, the longer), and how much flutter rides on it.
#pragma param u_windStrength float default(2) range(0,20) ui(slider)
#pragma param u_windSpeed float default(1.2) range(0,6) ui(slider)
#pragma param u_windDirection float default(40) range(0,360) ui(slider)
#pragma param u_gustScale float default(0.02) range(0.001,0.5) ui(slider)
#pragma param u_flutter float default(0.4) range(0,4) ui(slider)
// Plants thin with distance, each by its own number (the Foliage component writes these; a thin distance of 0 thins nothing): the share
// drawn falls as a power of the distance so that it is u_thinKeep where the first far version takes over (u_thinDistance), u_thinKeep of
// that u_thinStep times further out, and so on, and none at u_thinEnd. Each far version holds the plants still drawn where it takes over.
#pragma param u_thinDistance float default(0) range(0,1000000) ui(slider)
#pragma param u_thinKeep float default(0.34) range(0.01,1) ui(slider)
#pragma param u_thinStep float default(2) range(1.01,8) ui(slider)
#pragma param u_thinEnd float default(0) range(0,1000000) ui(slider)
// How many far versions are layers of their own (0: none are, and a mesh is drawn at any distance): a mesh says which it is in its
// colour's alpha, in thirds, and is drawn from where it takes over to where the next does.
#pragma param u_thinLevels float default(0) range(0,3) ui(slider)
// How far plants part from what touches them, as a share of its reach. The four contacts are written each frame (a FoliageContact): where each is, and how far it reaches now.
#pragma param u_contactBend float default(0.7) range(0,2) ui(slider)
#pragma param u_contact0 vec4 default(0,0,0,0)
#pragma param u_contact1 vec4 default(0,0,0,0)
#pragma param u_contact2 vec4 default(0,0,0,0)
#pragma param u_contact3 vec4 default(0,0,0,0)
#pragma vertexbounds 30
#pragma vertexoffset
// How far one contact parts a vertex: away from it on the ground, most near it and nothing at its reach or far above or below it.
vec2 foliageContactPush(vec4 contact, vec3 at) {
    if (contact.w <= 0.0) return vec2(0.0);
    vec2 away = at.xz - contact.xz;
    float len = length(away);
    float near = clamp(1.0 - len / contact.w, 0.0, 1.0);
    float level = 1.0 - smoothstep(contact.w * 1.2, contact.w * 2.0, abs(at.y - contact.y));
    return len > 1e-4 ? away / len * near * near * (3.0 - 2.0 * near) * level * contact.w : vec2(0.0);
}
void esMaterialVertex(inout vec3 local, inout vec3 localNormal, in vec2 uv) {
    float weight = es_vertexColor.r;
    float phase = es_vertexColor.g * 6.2831853;
    // The wind is in the world, so its phase is by the world's own position, not the render origin's.
    vec3 anchor = (esInstanceModel() * vec4(local, 1.0)).xyz + u_renderOrigin.xyz;
    vec2 parted = foliageContactPush(u_contact0, anchor) + foliageContactPush(u_contact1, anchor)
        + foliageContactPush(u_contact2, anchor) + foliageContactPush(u_contact3, anchor);
    // Bounded so a blade cannot leave what its cell's bounds allow for; the wind has the rest of that.
    float partedLen = length(parted);
    if (partedLen > 0.0) {
        parted *= min(partedLen * u_contactBend, 24.0) / partedLen * weight;
        local.xz += parted;
        local.y -= length(parted) * 0.6 * weight;
    }
    float angle = radians(u_windDirection);
    vec2 dir = vec2(sin(angle), cos(angle));
    float t = u_time.x * u_windSpeed;
    float gust = sin(dot(anchor.xz, dir) * u_gustScale - t * 1.3) * 0.5 + 0.5;
    float flutter = sin(t * 3.1 + phase + anchor.x * 0.7) * u_flutter;
    float sway = (gust + 0.25 * sin(t + phase)) * u_windStrength + flutter * weight;
    float bend = weight * weight * sway;
    local.xz += dir * bend;
    // The length is kept: what the sideways bend takes from the height it gives back by lowering the tip.
    local.y -= abs(bend) * 0.35 * weight;
    if (u_thinDistance > 0.0 && u_camera.w > 0.5) {
        // Measured from the cell's centre, so every vertex of a blade agrees on whether it is kept.
        vec3 cell = (esInstanceModel() * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float away = max(length(cell - u_camera.xyz), 1e-3);
        float keep = min(pow(u_thinDistance / (u_thinStep * away), log(1.0 / u_thinKeep) / log(u_thinStep)), 1.0);
        if (u_thinEnd > 0.0) keep *= 1.0 - smoothstep(u_thinEnd * 0.85, u_thinEnd, away);
        if (u_thinLevels > 0.5) {
            float level = floor(es_vertexColor.a * 3.0 + 0.5);
            float nearEdge = level < 0.5 ? 0.0 : u_thinDistance * pow(u_thinStep, level - 1.0);
            float farEdge = level > u_thinLevels - 0.5 ? 1e30 : u_thinDistance * pow(u_thinStep, level);
            if (away < nearEdge || away >= farEdge) keep = -1.0;
        }
        // Every vertex of a blade left out goes to one point: its triangles have no area and draw nothing.
        if (es_vertexColor.g > keep) local = vec3(0.0);
    }
}
#pragma end

#pragma vertexoffset wgsl
fn foliageContactPush(contact : vec4f, at : vec3f) -> vec2f {
    if (contact.w <= 0.0) { return vec2f(0.0); }
    let away = at.xz - contact.xz;
    let len = length(away);
    let near = clamp(1.0 - len / contact.w, 0.0, 1.0);
    let level = 1.0 - smoothstep(contact.w * 1.2, contact.w * 2.0, abs(at.y - contact.y));
    if (len <= 1e-4) { return vec2f(0.0); }
    return away / len * near * near * (3.0 - 2.0 * near) * level * contact.w;
}
fn esMaterialVertex(local : ptr<function, vec3f>, localNormal : ptr<function, vec3f>, uv : vec2f) {
    let weight = es_vertexColor.r;
    let phase = es_vertexColor.g * 6.2831853;
    let anchor = (esInstanceModel() * vec4f(*local, 1.0)).xyz + frame.renderOrigin.xyz;
    var parted = foliageContactPush(mc.u_contact0, anchor) + foliageContactPush(mc.u_contact1, anchor)
        + foliageContactPush(mc.u_contact2, anchor) + foliageContactPush(mc.u_contact3, anchor);
    let partedLen = length(parted);
    if (partedLen > 0.0) {
        parted = parted * min(partedLen * mc.u_contactBend, 24.0) / partedLen * weight;
        (*local).x = (*local).x + parted.x;
        (*local).z = (*local).z + parted.y;
        (*local).y = (*local).y - length(parted) * 0.6 * weight;
    }
    let angle = radians(mc.u_windDirection);
    let dir = vec2f(sin(angle), cos(angle));
    let t = tc.u_time.x * mc.u_windSpeed;
    let gust = sin(dot(anchor.xz, dir) * mc.u_gustScale - t * 1.3) * 0.5 + 0.5;
    let flutter = sin(t * 3.1 + phase + anchor.x * 0.7) * mc.u_flutter;
    let sway = (gust + 0.25 * sin(t + phase)) * mc.u_windStrength + flutter * weight;
    let bend = weight * weight * sway;
    (*local).x = (*local).x + dir.x * bend;
    (*local).z = (*local).z + dir.y * bend;
    (*local).y = (*local).y - abs(bend) * 0.35 * weight;
    if (mc.u_thinDistance > 0.0 && frame.camera.w > 0.5) {
        let cell = (esInstanceModel() * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
        let away = max(length(cell - frame.camera.xyz), 1e-3);
        var keep = min(pow(mc.u_thinDistance / (mc.u_thinStep * away), log(1.0 / mc.u_thinKeep) / log(mc.u_thinStep)), 1.0);
        if (mc.u_thinEnd > 0.0) { keep = keep * (1.0 - smoothstep(mc.u_thinEnd * 0.85, mc.u_thinEnd, away)); }
        if (mc.u_thinLevels > 0.5) {
            let level = floor(es_vertexColor.a * 3.0 + 0.5);
            var nearEdge = 0.0;
            if (level > 0.5) { nearEdge = mc.u_thinDistance * pow(mc.u_thinStep, level - 1.0); }
            var farEdge = 1e30;
            if (level < mc.u_thinLevels - 0.5) { farEdge = mc.u_thinDistance * pow(mc.u_thinStep, level); }
            if (away < nearEdge || away >= farEdge) { keep = -1.0; }
        }
        if (es_vertexColor.g > keep) { *local = vec3f(0.0); }
    }
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

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 N = normalize(v_worldNormal);
    if (!gl_FrontFacing) N = -N;
#else
    highp vec3 P = vec3(v_worldPos, 0.0);
    highp vec3 N = vec3(0.0, 0.0, 1.0);
#endif
    float height = clamp(v_color.r, 0.0, 1.0);
    float light = v_color.b;
    vec4 tex = texture(u_albedo, v_texCoord);
    // Before the branch: a derivative needs every fragment of its quad.
    float edgeA = fwidth(tex.a);
    vec3 albedo = mix(u_baseColor.rgb, u_tipColor.rgb, clamp((height - u_tipFrom) / (1.0 - u_tipFrom), 0.0, 1.0));
    float alpha = 1.0;
    if (u_useTexture > 0.5) {
        albedo *= tex.rgb;
        alpha = tex.a;
        alpha = cutoutCoverage(alpha, u_alphaCutoff, edgeA);
        if (alpha <= 0.0) discard;
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    if (u_colorMapStrength > 0.0) {
        vec2 over = (P.xz + u_renderOrigin.xz - u_colorMapArea.xy) / max(u_colorMapArea.zw, vec2(1e-4));
        vec4 wash = textureLod(u_colorMap, over, 0.0);
        float up = u_colorMapFrom > 0.0 ? smoothstep(u_colorMapFrom * 0.8, u_colorMapFrom, height) : 1.0;
        albedo = mix(albedo, wash.rgb, wash.a * u_colorMapStrength * up);
    }
#endif
    albedo *= light;
    SurfaceExt ext = surfaceExtNone(N);
    if (u_translucency > 0.0) {
        ext.scatter = vec4(albedo * 1.3, u_translucency * 0.5);
        ext.trans = vec4(u_translucency, u_thickness, 0.0, 0.0);
    }
    vec3 viewDir = viewDirection(P);
    vec3 lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, u_roughness, 0.5, 1.0, ext);
    fragColor = vec4(lit, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(packNormal(N), u_roughness, 0.75);
    fragAlbedo = vec4(albedo, 1.0);
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

@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> FragOut {
#else
@fragment fn fs_main(v : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
#endif
    // Taken before any branch: a derivative needs every fragment of its quad.
    let duvx = dpdx(v.v_texCoord);
    let duvy = dpdy(v.v_texCoord);
    g_probeSlot = v.v_probeSlot;
#ifdef MESH_LIGHTMAP
    g_lightmap = v.v_lightmap;
#endif
    let tex = textureSampleGrad(u_albedo, u_albedo_s, v.v_texCoord, duvx, duvy);
    let edge = max(fwidth(tex.a), 1e-4);
#ifdef MESH_NORMALS
    let P = v.v_worldXYZ;
    var N = normalize(v.v_worldNormal);
    if (!front) { N = -N; }
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 0.0, 1.0);
#endif
    let height = clamp(v.v_color.r, 0.0, 1.0);
    let light = v.v_color.b;
    var albedo = mix(mc.u_baseColor.rgb, mc.u_tipColor.rgb, vec3f(clamp((height - mc.u_tipFrom) / (1.0 - mc.u_tipFrom), 0.0, 1.0)));
    var alpha = 1.0;
    if (mc.u_useTexture > 0.5) {
        albedo = albedo * tex.rgb;
        alpha = cutoutCoverage(tex.a, mc.u_alphaCutoff, edge);
        if (alpha <= 0.0) { discard; }
        alpha = min(alpha, 1.0);
    }
#ifdef MESH_NORMALS
    if (mc.u_colorMapStrength > 0.0) {
        let over = (P.xz + frame.renderOrigin.xz - mc.u_colorMapArea.xy) / max(mc.u_colorMapArea.zw, vec2f(1e-4));
        let wash = textureSampleLevel(u_colorMap, u_colorMap_s, over, 0.0);
        var up = 1.0;
        if (mc.u_colorMapFrom > 0.0) { up = smoothstep(mc.u_colorMapFrom * 0.8, mc.u_colorMapFrom, height); }
        albedo = mix(albedo, wash.rgb, vec3f(wash.a * mc.u_colorMapStrength * up));
    }
#endif
    albedo = albedo * light;
    var ext = surfaceExtNone(N);
    if (mc.u_translucency > 0.0) {
        ext.scatter = vec4f(albedo * 1.3, mc.u_translucency * 0.5);
        ext.trans = vec4f(mc.u_translucency, mc.u_thickness, 0.0, 0.0);
    }
    let viewDir = viewDirection(P);
    let lit = applyLightingSurface(albedo, N, P, viewDir, 0.0, mc.u_roughness, 0.5, 1.0, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, alpha);
    frag.surface = vec4f(packNormal(N), mc.u_roughness, 0.75);
    frag.albedo = vec4f(albedo, 1.0);
    return frag;
#else
    return vec4f(lit, alpha);
#endif
}
#pragma end
`;

export const FOLIAGE_SHADER_TEMPLATE = makeBuiltinShaderTemplate('foliage', 'Foliage',
    'Plants that sway in the wind: a vertex bend by painted weights, two-sided and translucent, with an optional cutout texture.', FOLIAGE);
