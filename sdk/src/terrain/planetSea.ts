// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    planetSea.ts
 * @brief   The sea of a planet: a sphere at the sea level, lit like any surface and seen through, in which the ground stands.
 *
 * @details The first slice of water on a round world. A flat world's water (water/) is a plane of waves lifted over a zone; a planet's sea is the sphere
 *          at `radius + seaLevel`, so the ground that dips below it is under water and the horizon curves away over it. It has a colour and an opacity
 *          and takes the sun and the sky as a smooth, shining surface does; waves, shore foam and depth colour are the flat water's, and come to the sphere later.
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
// The sea's colour, and how much of it there is over what is under it.
#pragma param u_seaColor color default(0.05,0.3,0.45,1)
#pragma param u_seaOpacity float default(0.85) range(0,1) ui(slider)

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

void main() {
#ifdef MESH_NORMALS
    highp vec3 P = v_worldXYZ;
    highp vec3 N = normalize(v_worldNormal);
#else
    highp vec3 P = vec3(v_worldPos.x, 0.0, v_worldPos.y);
    highp vec3 N = vec3(0.0, 1.0, 0.0);
#endif
    // A smooth, shining surface: the sun and the sky lie on it, and what is under it shows through by the opacity.
    float roughness = 0.08;
    SurfaceExt ext = surfaceExtNone(N);
    vec3 lit = applyLightingSurface(u_seaColor.rgb, N, P, viewDirection(P), 0.0, roughness, 0.5, 1.0, ext);
    fragColor = vec4(lit, u_seaOpacity);
#ifdef ES_GBUFFER
    fragSurface = vec4(0.5, 0.5, roughness, 0.0);
    fragAlbedo = vec4(u_seaColor.rgb, 1.0);
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
    let N = normalize(v.v_worldNormal);
#else
    let P = vec3f(v.v_worldPos.x, 0.0, v.v_worldPos.y);
    let N = vec3f(0.0, 1.0, 0.0);
#endif
    let roughness = 0.08;
    let ext = surfaceExtNone(N);
    let lit = applyLightingSurface(mc.u_seaColor.rgb, N, P, viewDirection(P), 0.0, roughness, 0.5, 1.0, ext);
#ifdef ES_GBUFFER
    var frag : FragOut;
    frag.color = vec4f(lit, mc.u_seaOpacity);
    frag.surface = vec4f(0.5, 0.5, roughness, 0.0);
    frag.albedo = vec4f(mc.u_seaColor.rgb, 1.0);
    return frag;
#else
    return vec4f(lit, mc.u_seaOpacity);
#endif
}
#pragma end
`;

export const PLANET_SEA_SHADER_TEMPLATE = makeBuiltinShaderTemplate('planet-sea', 'Planet Sea',
    'The sea of a planet: a lit, translucent surface in a colour.', PLANET_SEA);
