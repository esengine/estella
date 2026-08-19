// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    editorGridRenderer.ts
 * @brief   Infinite world-space editor grid, drawn on the view's work plane.
 *
 * `installEditorGrid(app)` registers a pre-scene draw callback (see customDraw /
 * RenderPipeline): each editor frame, when `EditorGrid.enabled` and the
 * `EditorView` is active, it draws one full-screen quad whose fragment shader
 * intersects that pixel's world ray with the plane the view works on
 * (`editorViewWorkPlane`) and paints minor / major / axis lines there. Because it
 * runs in the pre-scene pass, scene entities draw over it (UE5 / Unity
 * behaviour).
 *
 * The ray is built from the view's own basis rather than from a matrix inverse:
 * four vec4 params carry the eye, the two screen axes scaled to what the view
 * sees, and the forward reach, and one `w` flag decides whether a screen offset
 * moves the ray's origin (orthographic) or turns its direction (perspective). So
 * both projections run the same three lines, and the grid is bounded by nothing
 * — line width and the legibility fade come from `fwidth` of the plane
 * coordinate, which is what makes a tilted ground plane fade out at its horizon
 * instead of aliasing or ending at a quad edge.
 *
 * The shader is a dual-language `.esshader` (GLSL + WGSL twins) on the reflected
 * `#pragma param` seam: parameters ride the MaterialConstants UBO and the draw
 * goes through `Draw.drawMeshWithMaterial`'s reflected path, so the grid renders
 * on every backend.
 *
 * Frontends just install this once and flip the `EditorGrid` resource — the web
 * editor and the headless render host (pixel verification) get the grid for free.
 */
import type { App } from '../app/app';
import { Draw } from '../render/draw';
import { Geometry, type GeometryHandle } from '../render/geometry';
import { Material, type MaterialHandle } from '../render/material';
import { BlendMode } from '../render/blend';
import { registerPreSceneDrawCallback } from '../render/customDraw';
import {
  EditorView, editorViewHalfHeight, editorViewBasis, editorViewEye,
  editorViewStandoff, editorViewWorkPlane, worldAxisVector,
} from './EditorView';
import { EditorGrid, DEFAULT_EDITOR_GRID } from './EditorGrid';

/** The grid's dual-language material shader (exported for the twins structure guard). */
export const GRID_ESSHADER = `#pragma shader "EditorGrid"
#pragma version 300 es

#pragma param u_planeU vec4 default(1,0,0,0)
#pragma param u_planeV vec4 default(0,1,0,0)
#pragma param u_rayOrigin vec4 default(0,0,0,1)
#pragma param u_rayRight vec4 default(1,0,0,0)
#pragma param u_rayUp vec4 default(0,1,0,0)
#pragma param u_rayForward vec4 default(0,0,-1,0)
#pragma param u_gridParams vec4 default(32,10,0,0)
#pragma param u_minorColor color default(1,1,1,0.05)
#pragma param u_majorColor color default(1,1,1,0.1)
#pragma param u_axisUColor color default(0.812,0.357,0.325,0.55)
#pragma param u_axisVColor color default(0.502,0.725,0.29,0.55)

#pragma vertex
layout(location = 0) in vec2 a_position;

out vec2 v_ndc;

void main() {
    // Clip space directly: the quad is the screen, and where the world is behind
    // each pixel is the fragment stage's question.
    v_ndc = a_position;
    gl_Position = vec4(a_position, 1.0, 1.0);
}
#pragma end

#pragma fragment
precision highp float;

in vec2 v_ndc;
out vec4 fragColor;

// How legible lines of this spacing still are, given world units per pixel.
float fade(float wpp, float sp) {
    return smoothstep(3.0, 9.0, sp / max(wpp, 1e-8));
}

float lineCov(float coord, float wpp, float sp) {
    float d = abs(mod(coord + sp * 0.5, sp) - sp * 0.5) / max(wpp, 1e-8);
    return 1.0 - smoothstep(0.5, 1.5, d);
}

float axisCov(float coord, float wpp) {
    return 1.0 - smoothstep(0.5, 1.5, abs(coord) / max(wpp, 1e-8));
}

vec4 over(vec4 top, vec4 bot) {
    float a = top.a + bot.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    vec3 rgb = (top.rgb * top.a + bot.rgb * bot.a * (1.0 - top.a)) / a;
    return vec4(rgb, a);
}

void main() {
    // One ray for both projections: the w flags say which of the two the screen
    // offset belongs to.
    vec3 off = u_rayRight.xyz * v_ndc.x + u_rayUp.xyz * v_ndc.y;
    vec3 ro = u_rayOrigin.xyz + off * u_rayOrigin.w;
    vec3 rd = u_rayForward.xyz + off * u_rayForward.w;

    vec3 n = cross(u_planeU.xyz, u_planeV.xyz);
    float denom = dot(rd, n);
    // Parallel meets the plane nowhere; a finite huge t leaves the fade below to
    // remove it, where a division by zero would hand it a NaN.
    float t = -dot(ro, n) / (abs(denom) < 1e-6 ? 1e-6 : denom);
    vec3 hit = ro + rd * t;

    vec2 p = vec2(dot(hit, u_planeU.xyz), dot(hit, u_planeV.xyz));
    vec2 wpp = fwidth(p);

    // Orthographic sees the plane on both sides of the eye; perspective only in front.
    float inFront = max(step(0.0, t), 1.0 - u_rayForward.w);

    float sp = u_gridParams.x;
    float major = sp * u_gridParams.y;
    float minorC = max(lineCov(p.x, wpp.x, sp) * fade(wpp.x, sp),
                       lineCov(p.y, wpp.y, sp) * fade(wpp.y, sp)) * inFront;
    float majorC = max(lineCov(p.x, wpp.x, major) * fade(wpp.x, major),
                       lineCov(p.y, wpp.y, major) * fade(wpp.y, major)) * inFront;
    float axisUC = axisCov(p.y, wpp.y) * fade(wpp.y, major) * inFront;
    float axisVC = axisCov(p.x, wpp.x) * fade(wpp.x, major) * inFront;

    vec4 c = vec4(0.0);
    c = over(vec4(u_minorColor.rgb, u_minorColor.a * minorC), c);
    c = over(vec4(u_majorColor.rgb, u_majorColor.a * majorC), c);
    c = over(vec4(u_axisUColor.rgb, u_axisUColor.a * axisUC), c);
    c = over(vec4(u_axisVColor.rgb, u_axisVColor.a * axisVC), c);
    if (c.a <= 0.0) discard;
    fragColor = c;
}
#pragma end

#pragma vertex wgsl
struct VSIn { @location(0) a_position : vec2f };
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_ndc : vec2f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    out.v_ndc = v.a_position;
    out.pos = vec4f(v.a_position, 1.0, 1.0);
    return out;
}
#pragma end

#pragma fragment wgsl
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_ndc : vec2f,
};

// GLSL mod(): floor-based remainder (result follows the divisor's sign) — WGSL's
// % is trunc-based, which would misplace grid lines on the negative world half.
fn gmod(x : f32, y : f32) -> f32 { return x - y * floor(x / y); }

fn fade(wpp : f32, sp : f32) -> f32 {
    return smoothstep(3.0, 9.0, sp / max(wpp, 1e-8));
}

fn lineCov(coord : f32, wpp : f32, sp : f32) -> f32 {
    let d = abs(gmod(coord + sp * 0.5, sp) - sp * 0.5) / max(wpp, 1e-8);
    return 1.0 - smoothstep(0.5, 1.5, d);
}

fn axisCov(coord : f32, wpp : f32) -> f32 {
    return 1.0 - smoothstep(0.5, 1.5, abs(coord) / max(wpp, 1e-8));
}

fn over(top : vec4f, bot : vec4f) -> vec4f {
    let a = top.a + bot.a * (1.0 - top.a);
    if (a <= 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
    let rgb = (top.rgb * top.a + bot.rgb * bot.a * (1.0 - top.a)) / a;
    return vec4f(rgb, a);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let off = mc.u_rayRight.xyz * v.v_ndc.x + mc.u_rayUp.xyz * v.v_ndc.y;
    let ro = mc.u_rayOrigin.xyz + off * mc.u_rayOrigin.w;
    let rd = mc.u_rayForward.xyz + off * mc.u_rayForward.w;

    let n = cross(mc.u_planeU.xyz, mc.u_planeV.xyz);
    let denom = dot(rd, n);
    let t = -dot(ro, n) / select(denom, 1e-6, abs(denom) < 1e-6);
    let hit = ro + rd * t;

    let p = vec2f(dot(hit, mc.u_planeU.xyz), dot(hit, mc.u_planeV.xyz));
    let wpp = fwidth(p);

    let inFront = max(step(0.0, t), 1.0 - mc.u_rayForward.w);

    let sp = mc.u_gridParams.x;
    let major = sp * mc.u_gridParams.y;
    let minorC = max(lineCov(p.x, wpp.x, sp) * fade(wpp.x, sp),
                     lineCov(p.y, wpp.y, sp) * fade(wpp.y, sp)) * inFront;
    let majorC = max(lineCov(p.x, wpp.x, major) * fade(wpp.x, major),
                     lineCov(p.y, wpp.y, major) * fade(wpp.y, major)) * inFront;
    let axisUC = axisCov(p.y, wpp.y) * fade(wpp.y, major) * inFront;
    let axisVC = axisCov(p.x, wpp.x) * fade(wpp.x, major) * inFront;

    var c = vec4f(0.0, 0.0, 0.0, 0.0);
    c = over(vec4f(mc.u_minorColor.rgb, mc.u_minorColor.a * minorC), c);
    c = over(vec4f(mc.u_majorColor.rgb, mc.u_majorColor.a * majorC), c);
    c = over(vec4f(mc.u_axisUColor.rgb, mc.u_axisUColor.a * axisUC), c);
    c = over(vec4f(mc.u_axisVColor.rgb, mc.u_axisVColor.a * axisVC), c);
    if (c.a <= 0.0) { discard; }
    return c;
}
#pragma end
`;

let quad_: GeometryHandle = 0;
let material_: MaterialHandle = 0;

// Per-param last-set cache: Material.setUniform re-flushes the whole material on
// every call, so skipping unchanged values keeps an idle frame at zero pushes.
const lastSet_ = new Map<string, [number, number, number, number]>();

function setParam(name: string, x: number, y: number, z: number, w: number): void {
  const prev = lastSet_.get(name);
  if (prev && prev[0] === x && prev[1] === y && prev[2] === z && prev[3] === w) return;
  lastSet_.set(name, [x, y, z, w]);
  Material.setUniform(material_, name, { x, y, z, w });
}

function ensureResources(): boolean {
  if (material_) return true;
  const shader = Material.compileShader(GRID_ESSHADER);
  if (!shader) return false;
  quad_ = Geometry.createQuad(2, 2); // [-1, 1] unit quad
  material_ = Material.create({ shader, blendMode: BlendMode.Normal, depthTest: false });
  return true;
}

/**
 * Register the editor grid renderer on this App. Idempotent per App: inserts the
 * default `EditorGrid` resource if absent and registers the pre-scene draw pass.
 * The grid only draws when the resource is `enabled` and the `EditorView` active.
 */
export function installEditorGrid(app: App): void {
  if (!app.hasResource(EditorGrid)) {
    app.insertResource(EditorGrid, { ...DEFAULT_EDITOR_GRID });
  }
  registerPreSceneDrawCallback('editor:grid', ({ width, height }) => {
    if (height <= 0 || !app.hasResource(EditorGrid) || !app.hasResource(EditorView)) return;
    const grid = app.getResource(EditorGrid);
    const view = app.getResource(EditorView);
    if (!grid.enabled || !view.active || grid.spacing <= 0) return;
    if (!ensureResources()) return;

    const plane = editorViewWorkPlane(view);
    const u = worldAxisVector(plane.u);
    const v = worldAxisVector(plane.v);
    const basis = editorViewBasis(view);
    const eye = editorViewEye(view);

    // What the view sees at the focus, which is the half-extent the screen axes
    // span there — the reach a perspective ray turns through, and the offset an
    // orthographic one is displaced by.
    const halfH = editorViewHalfHeight(view);
    const halfW = halfH * (width / height);
    const perspective = view.perspective ? 1 : 0;
    const reach = view.perspective ? editorViewStandoff(view) : 1;

    setParam('u_planeU', u.x, u.y, u.z, 0);
    setParam('u_planeV', v.x, v.y, v.z, 0);
    setParam('u_rayOrigin', eye.x, eye.y, eye.z, 1 - perspective);
    setParam('u_rayRight', basis.right.x * halfW, basis.right.y * halfW, basis.right.z * halfW, 0);
    setParam('u_rayUp', basis.up.x * halfH, basis.up.y * halfH, basis.up.z * halfH, 0);
    setParam('u_rayForward', basis.forward.x * reach, basis.forward.y * reach,
             basis.forward.z * reach, perspective);
    setParam('u_gridParams', grid.spacing, grid.majorEvery, 0, 0);

    const minor = grid.color;
    const major = grid.majorColor;
    const axisU = grid.axisColors[plane.u];
    const axisV = grid.axisColors[plane.v];
    setParam('u_minorColor', minor[0], minor[1], minor[2], minor[3]);
    setParam('u_majorColor', major[0], major[1], major[2], major[3]);
    setParam('u_axisUColor', axisU[0], axisU[1], axisU[2], axisU[3]);
    setParam('u_axisVColor', axisV[0], axisV[1], axisV[2], axisV[3]);

    Draw.drawMeshWithMaterial(quad_, material_);
  });
}
