// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    agx.ts
 * @brief   The AgX view transform's shader and its tables, installed by a package that uses AgX.
 *
 * @details AgX is a group of its own, apart from the other colour effects, because it brings data: Blender's two tables, about
 *          80 KB as the SDK carries them. A package that uses bloom or a vignette and not AgX should not carry them.
 */
import type { ShaderHandle } from '../../render/material';
import { Material } from '../../render/material';
import { registerEffectSources } from '../effectSources';
import { agxBaseTexture, agxLookHighTexture, agxLookLowTexture, agxAtlasColumns, AGX_BASE_SIZE, AGX_LOOK_SIZE } from '../agxTables';

/** The atlas layout of the two AgX tables (see agxTables.ts), spelt into the shader the same way the tables are written. */
const AGX_BASE_COLUMNS = agxAtlasColumns(AGX_BASE_SIZE);
const AGX_LOOK_COLUMNS = agxAtlasColumns(AGX_LOOK_SIZE);

export const agxEffects = {
    /** The AgX table, for the effect to upload once (see `builtinTextures` on its definition). */
    agxLut: agxBaseTexture,
    /** The luminance-compensation table of the contrast looks, in two textures: its top eight bits and its low four. */
    agxLookHigh: agxLookHighTexture,
    agxLookLow: agxLookLowTexture,
    createAgx(): ShaderHandle {
        // AgX, the view transform Blender uses, from the data Blender ships (agxTables.ts): the colour to FilmLight E-Gamut, a log2 encode over
        // -12.47393 .. +12.5260688 stops, the 57^3 table read tetrahedrally (as Blender's configuration says), and the display's own encode.
        // The contrast looks ("Medium High Contrast" is 1.2) are Blender's too: the colour first goes through the luminance-compensation
        // table, into the inset Rec.2020 gamut AgX's log is taken in, takes its contrast about 0.4 there, and comes back. 1 is AgX Base and
        // skips all of that. It writes display-linear, so it goes last and the project's output transform stays "none".
        const source = `#pragma shader "PP AgX"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_contrast float default(1) range(0.5,2)
#pragma param u_lut texture default(white)
#pragma param u_lookHigh texture default(white)
#pragma param u_lookLow texture default(white)

#pragma fragment
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

// Scene-linear Rec.709 to FilmLight E-Gamut (Rec.709 to XYZ D65, then XYZ to E-Gamut).
const mat3 TO_EGAMUT = mat3(0.5593711, 0.0762207, 0.0655267, 0.3047833, 0.7879718, 0.1645467, 0.1358455, 0.1358075, 0.7699265);
// E-Gamut linear to the inset Rec.2020 gamut AgX Log is taken in, and back (the inset and rotation Blender's config gives, over E-Gamut to Rec.2020).
const mat3 TO_LOOK = mat3(0.9679715, 0.1318101, 0.0468787, 0.1178901, 0.9160784, 0.0124328, -0.0858616, -0.0478886, 0.9406886);
const mat3 FROM_LOOK = mat3(1.0473108, -0.1533149, -0.0501658, -0.1359818, 1.1107622, -0.0079040, 0.0886710, 0.0425528, 1.0580698);

const float LOG_LOW = -12.47393;
const float LOG_SPAN = 25.0;
vec3 encodeLog(vec3 e) { return clamp((log2(max(e, vec3(1e-10))) - LOG_LOW) / LOG_SPAN, 0.0, 1.0); }
vec3 decodeLog(vec3 t) { return exp2(t * LOG_SPAN + LOG_LOW); }

// A table is read by tetrahedral interpolation, which is what Blender's configuration names for these tables. Trilinear interpolation is
// exact on a table's nodes and not between them, and these tables bend fast: inside a cell the grey axis of the cube is not an edge of the
// interpolation, so a neutral input came out tinted. A tetrahedron has it for an edge. From the cell's low corner it walks along the axes,
// the one with the biggest fraction first, four nodes in all.
void tetraCell(vec3 t, int size, out ivec3 n0, out ivec3 n1, out ivec3 n2, out ivec3 n3, out vec3 f) {
    vec3 p = clamp(t, 0.0, 1.0) * float(size - 1);
    ivec3 i0 = ivec3(min(floor(p), vec3(float(size - 2))));
    vec3 g = p - vec3(i0);
    ivec3 a1 = ivec3(1, 0, 0), a2 = ivec3(0, 1, 0), a3 = ivec3(0, 0, 1);
    float f1 = g.r, f2 = g.g, f3 = g.b;
    if (f2 > f1) { ivec3 ta = a1; a1 = a2; a2 = ta; float tf = f1; f1 = f2; f2 = tf; }
    if (f3 > f2) { ivec3 ta = a2; a2 = a3; a3 = ta; float tf = f2; f2 = f3; f3 = tf; }
    if (f2 > f1) { ivec3 ta = a1; a1 = a2; a2 = ta; float tf = f1; f1 = f2; f2 = tf; }
    n0 = i0; n1 = n0 + a1; n2 = n1 + a2; n3 = n2 + a3;
    f = vec3(f1, f2, f3);
}

// The tables are atlases of slices (agxTables.ts): the blue index picks the tile, red runs along it and green down it.
vec3 baseNode(ivec3 n) { return texelFetch(u_lut, ivec2((n.b % ${AGX_BASE_COLUMNS}) * ${AGX_BASE_SIZE} + n.r, (n.b / ${AGX_BASE_COLUMNS}) * ${AGX_BASE_SIZE} + n.g), 0).rgb; }
// Twelve bits a value, split over two textures: the top eight, and the low four held in the top of a byte.
vec3 lookNode(ivec3 n) {
    ivec2 at = ivec2((n.b % ${AGX_LOOK_COLUMNS}) * ${AGX_LOOK_SIZE} + n.r, (n.b / ${AGX_LOOK_COLUMNS}) * ${AGX_LOOK_SIZE} + n.g);
    vec3 high = floor(texelFetch(u_lookHigh, at, 0).rgb * 255.0 + 0.5);
    vec3 low = floor(texelFetch(u_lookLow, at, 0).rgb * 255.0 / 16.0 + 0.5);
    return (high * 16.0 + low) / 4095.0;
}

vec3 sampleBase(vec3 t) {
    ivec3 n0, n1, n2, n3; vec3 f;
    tetraCell(t, ${AGX_BASE_SIZE}, n0, n1, n2, n3, f);
    vec3 c0 = baseNode(n0), c1 = baseNode(n1), c2 = baseNode(n2), c3 = baseNode(n3);
    return c0 + (c1 - c0) * f.x + (c2 - c1) * f.y + (c3 - c2) * f.z;
}
vec3 sampleLook(vec3 t) {
    ivec3 n0, n1, n2, n3; vec3 f;
    tetraCell(t, ${AGX_LOOK_SIZE}, n0, n1, n2, n3, f);
    vec3 c0 = lookNode(n0), c1 = lookNode(n1), c2 = lookNode(n2), c3 = lookNode(n3);
    return c0 + (c1 - c0) * f.x + (c2 - c1) * f.y + (c3 - c2) * f.z;
}

void main() {
    vec4 color = texture(u_texture, v_texCoord);
    vec3 e = TO_EGAMUT * max(color.rgb, vec3(0.0));
    if (u_contrast != 1.0) {
        // AgX Log: through the luminance compensation, into the inset gamut, log-encoded, and the contrast about 0.4 (the log of 18% grey).
        vec3 t = (encodeLog(TO_LOOK * decodeLog(sampleLook(encodeLog(e)))) - 0.4) * u_contrast + 0.4;
        e = FROM_LOOK * decodeLog(t);
    }
    vec3 encoded = sampleBase(encodeLog(e));
    // Back to display-linear: the blit that follows applies the display's own encode.
    fragColor = vec4(pow(encoded, vec3(2.4)), color.a);
}
#pragma end

#pragma fragment wgsl
const TO_EGAMUT = mat3x3f(vec3f(0.5593711, 0.0762207, 0.0655267), vec3f(0.3047833, 0.7879718, 0.1645467), vec3f(0.1358455, 0.1358075, 0.7699265));
const TO_LOOK = mat3x3f(vec3f(0.9679715, 0.1318101, 0.0468787), vec3f(0.1178901, 0.9160784, 0.0124328), vec3f(-0.0858616, -0.0478886, 0.9406886));
const FROM_LOOK = mat3x3f(vec3f(1.0473108, -0.1533149, -0.0501658), vec3f(-0.1359818, 1.1107622, -0.0079040), vec3f(0.0886710, 0.0425528, 1.0580698));

const LOG_LOW : f32 = -12.47393;
const LOG_SPAN : f32 = 25.0;
fn encodeLog(e : vec3f) -> vec3f { return clamp((log2(max(e, vec3f(1e-10))) - LOG_LOW) / LOG_SPAN, vec3f(0.0), vec3f(1.0)); }
fn decodeLog(t : vec3f) -> vec3f { return exp2(t * LOG_SPAN + LOG_LOW); }

struct Cell { n0 : vec3i, n1 : vec3i, n2 : vec3i, n3 : vec3i, f : vec3f }

fn tetraCell(t : vec3f, size : i32) -> Cell {
    let p = clamp(t, vec3f(0.0), vec3f(1.0)) * f32(size - 1);
    let i0 = vec3i(min(floor(p), vec3f(f32(size - 2))));
    let g = p - vec3f(i0);
    var a1 = vec3i(1, 0, 0);
    var a2 = vec3i(0, 1, 0);
    var a3 = vec3i(0, 0, 1);
    var f1 = g.x;
    var f2 = g.y;
    var f3 = g.z;
    if (f2 > f1) { let ta = a1; a1 = a2; a2 = ta; let tf = f1; f1 = f2; f2 = tf; }
    if (f3 > f2) { let ta = a2; a2 = a3; a3 = ta; let tf = f2; f2 = f3; f3 = tf; }
    if (f2 > f1) { let ta = a1; a1 = a2; a2 = ta; let tf = f1; f1 = f2; f2 = tf; }
    let n1 = i0 + a1;
    let n2 = n1 + a2;
    return Cell(i0, n1, n2, n2 + a3, vec3f(f1, f2, f3));
}

fn baseNode(n : vec3i) -> vec3f { return textureLoad(u_lut, vec2i((n.z % ${AGX_BASE_COLUMNS}) * ${AGX_BASE_SIZE} + n.x, (n.z / ${AGX_BASE_COLUMNS}) * ${AGX_BASE_SIZE} + n.y), 0).rgb; }
fn lookNode(n : vec3i) -> vec3f {
    let at = vec2i((n.z % ${AGX_LOOK_COLUMNS}) * ${AGX_LOOK_SIZE} + n.x, (n.z / ${AGX_LOOK_COLUMNS}) * ${AGX_LOOK_SIZE} + n.y);
    let high = floor(textureLoad(u_lookHigh, at, 0).rgb * 255.0 + 0.5);
    let low = floor(textureLoad(u_lookLow, at, 0).rgb * 255.0 / 16.0 + 0.5);
    return (high * 16.0 + low) / 4095.0;
}

fn sampleBase(t : vec3f) -> vec3f {
    let c = tetraCell(t, ${AGX_BASE_SIZE});
    let c0 = baseNode(c.n0);
    let c1 = baseNode(c.n1);
    let c2 = baseNode(c.n2);
    let c3 = baseNode(c.n3);
    return c0 + (c1 - c0) * c.f.x + (c2 - c1) * c.f.y + (c3 - c2) * c.f.z;
}
fn sampleLook(t : vec3f) -> vec3f {
    let c = tetraCell(t, ${AGX_LOOK_SIZE});
    let c0 = lookNode(c.n0);
    let c1 = lookNode(c.n1);
    let c2 = lookNode(c.n2);
    let c3 = lookNode(c.n3);
    return c0 + (c1 - c0) * c.f.x + (c2 - c1) * c.f.y + (c3 - c2) * c.f.z;
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let color = textureSampleLevel(t0, s0, v.v_texCoord, 0.0);
    var e = TO_EGAMUT * max(color.rgb, vec3f(0.0));
    if (mc.u_contrast != 1.0) {
        let t = (encodeLog(TO_LOOK * decodeLog(sampleLook(encodeLog(e)))) - 0.4) * mc.u_contrast + 0.4;
        e = FROM_LOOK * decodeLog(t);
    }
    let encoded = sampleBase(encodeLog(e));
    return vec4f(pow(encoded, vec3f(2.4)), color.a);
}
#pragma end
`;
        return Material.compileShader(source);
    },
};

export function registerAgxEffectSources(): void {
    registerEffectSources(agxEffects);
}
