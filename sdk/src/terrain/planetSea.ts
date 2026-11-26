// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetSea.ts
 * @brief   The sea of a planet: a sphere at the sea level, lit like any surface and seen through, in which the ground stands.
 *
 * @details The first slice of water on a round world. A flat world's water (water/) is a plane of waves lifted over a zone; a planet's sea is the sphere
 *          at `radius + seaLevel`, so the ground that dips below it is under water and the horizon curves away over it. It has a colour and an opacity
 *          and takes the sun and the sky as a shining surface does. Its waves are trains of slope laid over the sphere (so they stay where they are when the
 *          planet is moved), it is clearer and paler over a shallow bottom, read from the frame's depth, and it breaks white along the shore. It does not
 *          rise and fall: the sphere's mesh is far too coarse to carry a wave, and the flat water's displacement, ripples and caustics are not here.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';

/** A unit sphere (radius 1, outward normals) of `rings` bands of `segments` quads, as a mesh. */
export function buildSphereMesh(rings: number, segments: number): MeshData {
    const r = Math.max(2, Math.floor(rings)), s = Math.max(3, Math.floor(segments));
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const count = (r + 1) * (s + 1);
    const vertices = new Uint8Array(count * vertexStride);
    const view = new DataView(vertices.buffer);
    const [pos, uv, color, normal] = channels.map((c) => c.offset) as [number, number, number, number];
    for (let j = 0; j <= r; j++) {
        const theta = (j / r) * Math.PI, sin = Math.sin(theta), cos = Math.cos(theta);
        for (let i = 0; i <= s; i++) {
            const phi = (i / s) * Math.PI * 2;
            const x = sin * Math.cos(phi), y = cos, z = sin * Math.sin(phi);
            const base = (j * (s + 1) + i) * vertexStride;
            view.setFloat32(base + pos, x, true); view.setFloat32(base + pos + 4, y, true); view.setFloat32(base + pos + 8, z, true);
            view.setFloat32(base + uv, i / s, true); view.setFloat32(base + uv + 4, j / r, true);
            for (let k = 0; k < 4; k++) view.setUint8(base + color + k, 255);
            view.setFloat32(base + normal, x, true); view.setFloat32(base + normal + 4, y, true); view.setFloat32(base + normal + 8, z, true);
        }
    }
    const indices = new Uint32Array(r * s * 6);
    let at = 0;
    for (let j = 0; j < r; j++) for (let i = 0; i < s; i++) {
        const a = j * (s + 1) + i, b = a + 1, c = a + s + 1, d = c + 1;
        // Counter-clockwise from outside: down the band, then along it.
        indices.set([a, b, c, b, d, c], at);
        at += 6;
    }
    return { channels, vertexStride, vertexCount: count, vertices, indices, aabbMin: [-1, -1, -1], aabbMax: [1, 1, 1] };
}

import { makeBuiltinShaderTemplate } from '../render/builtinShaders';

const PLANET_SEA = `#pragma shader "Planet Sea"
#pragma version 300 es
#pragma domain Lit
// The sea's colour in deep water, and how much of it there is over what is under it.
#pragma param u_seaColor color default(0.05,0.3,0.45,1)
#pragma param u_seaOpacity float default(0.85) range(0,1) ui(slider)
// The sphere's radius, so a place on the sea is the same place wherever the planet stands: the waves are laid on the sphere, not on the world.
#pragma param u_seaRadius float default(4000) range(1,10000000)
// The longest of the waves, crest to crest, in metres, and how steep they are (0 is a mirror).
#pragma param u_waveLength float default(30) range(0.1,10000)
#pragma param u_waveSteepness float default(0.5) range(0,2) ui(slider)
// How deep the water is before the bottom is lost to its colour, in metres: shallower, it is clearer and paler, and it breaks white where it meets the ground.
#pragma param u_shallowDepth float default(8) range(0.01,10000)
#pragma param u_foam float default(0.7) range(0,1) ui(slider)
// What stands behind the sea, where the frame has it: how far through the water the bottom is.
#pragma param u_sceneDepthMap texture default(white) texel(data)

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
#else
out vec4 fragColor;
#endif

// One train of waves over the sphere: its slope at p, along the way it runs. A wave shorter than a couple of pixels is left out, faded
// and not cut, or far water glitters with crests no pixel can hold.
vec3 seaWave(highp vec3 p, vec3 way, float crest, float speed, float phase, float span) {
    float keep = 1.0 - smoothstep(0.12, 0.45, span / crest);
    float k = 6.2831853 / crest;
    return way * (cos(dot(way, p) * k + u_time.x * speed + phase) * keep);
}

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 up = normalize(v_worldNormal);
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
    highp vec3 up = vec3(0.0, 1.0, 0.0);
#endif
    // The place on the sea, in metres: the sphere stands unturned, so its normal is the direction from its centre.
    highp vec3 p = up * u_seaRadius;
    float span = max(length(dFdx(p)), length(dFdy(p)));
    float L = max(u_waveLength, 1e-3);
    // The trains bend each other a little, or the sea is a grid of straight crests.
    highp vec3 q = p + (0.35 * L) * vec3(sin(p.z / (L * 2.7) + u_time.x * 0.11), sin(p.x / (L * 3.1) + 1.7), sin(p.y / (L * 2.3) + u_time.x * 0.07));
    vec3 slope = seaWave(q, normalize(vec3(0.82, 0.21, 0.53)), L, 0.9, 0.0, span)
        + 0.8 * seaWave(q, normalize(vec3(-0.44, 0.62, 0.65)), L * 0.61, 1.15, 1.3, span)
        + 0.62 * seaWave(q, normalize(vec3(0.31, -0.74, 0.6)), L * 0.37, 1.5, 2.9, span)
        + 0.5 * seaWave(q, normalize(vec3(-0.71, -0.35, -0.61)), L * 0.21, 2.1, 4.1, span)
        + 0.38 * seaWave(q, normalize(vec3(0.15, 0.8, -0.58)), L * 0.12, 2.9, 5.6, span);
    // Along the surface only: what of a slope points out of the sphere is height, not lean.
    slope -= up * dot(slope, up);
    highp vec3 N = normalize(up - slope * (0.22 * u_waveSteepness));
    highp vec3 V = viewDirection(P);
    float facing = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);

    // How much water the eye looks through to the bottom: little of it is clear and pale, and where it runs out the sea breaks white.
    float shallow = 0.0;
    float foam = 0.0;
#ifdef MESH_NORMALS
    if (texture(u_sceneDepthMap, vec2(0.5)).a < 0.75) {
        highp float through = sceneDistance(texture(u_sceneDepthMap, sceneUv(P))) - distanceToEye(P);
        // Along the eye's ray, so it is weighed by how steeply the eye looks down: a grazing ray crosses more water over the same bottom.
        highp float depth = max(through, 0.0) * max(dot(up, V), 0.08);
        float band = max(u_shallowDepth * 0.22, 1e-3);
        shallow = exp(-depth / max(u_shallowDepth, 1e-3) * 2.2);
        float edge = 1.0 - smoothstep(0.0, band, depth);
        // The line of foam comes and goes along the shore with the waves that run into it.
        float surge = 0.6 + 0.4 * sin(dot(q, vec3(0.37, 0.29, 0.41)) / (L * 0.45) + u_time.x * 1.3);
        foam = edge * surge * u_foam;
    }
#endif
    vec3 pale = mix(u_seaColor.rgb, vec3(0.18, 0.62, 0.58), 0.55) * 1.35;
    vec3 water = mix(u_seaColor.rgb, pale, shallow * 0.85);
    vec3 albedo = mix(water, vec3(0.92, 0.95, 0.96), foam);
    // A smooth, shining surface where it is water; foam is rough.
    float roughness = mix(0.1, 0.7, foam);
    SurfaceExt ext = surfaceExtNone(N);
    vec3 lit = applyLightingSurface(albedo, N, P, V, 0.0, roughness, 0.5, 1.0, ext);
    // Seen from above, shallow water is clear; seen along it, the sea is the sky's mirror and nothing shows through.
    float alpha = mix(u_seaOpacity * (1.0 - 0.7 * shallow), 1.0, max(fresnel, foam));
    fragColor = vec4(lit, alpha);
#ifdef ES_GBUFFER
    fragSurface = vec4(0.5, 0.5, roughness, 0.0);
    fragAlbedo = vec4(albedo, 1.0);
#endif
}
#pragma end
`;

export const PLANET_SEA_SHADER_TEMPLATE = /* @__PURE__ */ makeBuiltinShaderTemplate('planet-sea', 'Planet Sea',
    'The sea of a planet: a lit, translucent surface in a colour.', PLANET_SEA);
