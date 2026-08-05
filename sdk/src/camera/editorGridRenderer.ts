// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    editorGridRenderer.ts
 * @brief   Infinite world-space editor grid, drawn through the editor camera.
 *
 * `installEditorGrid(app)` registers a pre-scene draw callback (see customDraw /
 * RenderPipeline): each editor frame, when `EditorGrid.enabled` and the
 * `EditorView` is active, it draws one full-viewport quad whose fragment shader
 * paints minor / major / axis lines in WORLD space. Because it runs in the
 * pre-scene pass, scene entities occlude the grid (UE5 / Unity behaviour).
 *
 * The quad is a unit quad placed by the `u_rect` param (centre = EditorView.x/y,
 * half-extents = `editorViewHalfExtent`) to cover the camera's visible world rect
 * on the z = 0 plane, so the fragment's interpolated world position is exact and
 * no inverse view-projection is needed — under either projection, since that is
 * the one place the extent is worked out. Line width and minor-line density fade
 * are driven by `worldPerPixel` (= 2·halfH / viewportHeight), so the grid stays
 * crisp and moiré-free at every zoom without relying on GLSL derivatives.
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
import { EditorView, editorViewHalfExtent } from './EditorView';
import { EditorGrid, DEFAULT_EDITOR_GRID } from './EditorGrid';

/** The grid's dual-language material shader (exported for the twins structure guard). */
export const GRID_ESSHADER = `#pragma shader "EditorGrid"
#pragma version 300 es

#pragma param u_rect vec4 default(0,0,1,1)
#pragma param u_gridParams vec4 default(32,10,1,0)
#pragma param u_minorColor color default(1,1,1,0.05)
#pragma param u_majorColor color default(1,1,1,0.1)
#pragma param u_axisXColor color default(0.812,0.357,0.325,0.55)
#pragma param u_axisYColor color default(0.502,0.725,0.29,0.55)

#pragma vertex
layout(location = 0) in vec2 a_position;

layout(std140) uniform FrameConstants {
    mat4 u_projection;
};

out vec2 v_world;

void main() {
    // u_rect: xy = view centre, zw = half extents — the unit quad covers the
    // camera's visible world rect, so v_world interpolates exact world coords.
    vec2 world = u_rect.xy + a_position * u_rect.zw;
    v_world = world;
    gl_Position = u_projection * vec4(world, 0.0, 1.0);
}
#pragma end

#pragma fragment
precision highp float;

in vec2 v_world;
out vec4 fragColor;

float lineCov(float coord, float sp, float lw, float aa) {
    float d = abs(mod(coord + sp * 0.5, sp) - sp * 0.5);
    return 1.0 - smoothstep(lw, lw + aa, d);
}

vec4 over(vec4 top, vec4 bot) {
    float a = top.a + bot.a * (1.0 - top.a);
    if (a <= 0.0) return vec4(0.0);
    vec3 rgb = (top.rgb * top.a + bot.rgb * bot.a * (1.0 - top.a)) / a;
    return vec4(rgb, a);
}

void main() {
    float sp = u_gridParams.x;      // minor spacing (world units)
    float major = sp * u_gridParams.y;
    float aa = u_gridParams.z;      // worldPerPixel, ~1px in world units
    float lw = aa * 0.5;            // ~1px line

    // Fade minor lines out as they crowd below a few pixels apart (anti-moiré).
    float minorFade = smoothstep(3.0, 9.0, sp / max(aa, 1e-6));
    float minorC = max(lineCov(v_world.x, sp, lw, aa), lineCov(v_world.y, sp, lw, aa)) * minorFade;
    float majorC = max(lineCov(v_world.x, major, lw, aa), lineCov(v_world.y, major, lw, aa));
    float axisXC = 1.0 - smoothstep(lw, lw + aa, abs(v_world.y)); // world y=0
    float axisYC = 1.0 - smoothstep(lw, lw + aa, abs(v_world.x)); // world x=0

    vec4 c = vec4(0.0);
    c = over(vec4(u_minorColor.rgb, u_minorColor.a * minorC), c);
    c = over(vec4(u_majorColor.rgb, u_majorColor.a * majorC), c);
    c = over(vec4(u_axisXColor.rgb, u_axisXColor.a * axisXC), c);
    c = over(vec4(u_axisYColor.rgb, u_axisYColor.a * axisYC), c);
    if (c.a <= 0.0) discard;
    fragColor = c;
}
#pragma end

#pragma vertex wgsl
struct FrameConstants { projection : mat4x4f };
@group(0) @binding(0) var<uniform> frame : FrameConstants;

struct VSIn { @location(0) a_position : vec2f };
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_world : vec2f,
};

@vertex fn vs_main(v : VSIn) -> VSOut {
    var out : VSOut;
    let world = mc.u_rect.xy + v.a_position * mc.u_rect.zw;
    out.v_world = world;
    out.pos = frame.projection * vec4f(world, 0.0, 1.0);
    return out;
}
#pragma end

#pragma fragment wgsl
struct VSOut {
    @builtin(position) pos : vec4f,
    @location(0) v_world : vec2f,
};

// GLSL mod(): floor-based remainder (result follows the divisor's sign) — WGSL's
// % is trunc-based, which would misplace grid lines on the negative world half.
fn gmod(x : f32, y : f32) -> f32 { return x - y * floor(x / y); }

fn lineCov(coord : f32, sp : f32, lw : f32, aa : f32) -> f32 {
    let d = abs(gmod(coord + sp * 0.5, sp) - sp * 0.5);
    return 1.0 - smoothstep(lw, lw + aa, d);
}

fn over(top : vec4f, bot : vec4f) -> vec4f {
    let a = top.a + bot.a * (1.0 - top.a);
    if (a <= 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
    let rgb = (top.rgb * top.a + bot.rgb * bot.a * (1.0 - top.a)) / a;
    return vec4f(rgb, a);
}

@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    let sp = mc.u_gridParams.x;
    let major = sp * mc.u_gridParams.y;
    let aa = mc.u_gridParams.z;
    let lw = aa * 0.5;

    let minorFade = smoothstep(3.0, 9.0, sp / max(aa, 1e-6));
    let minorC = max(lineCov(v.v_world.x, sp, lw, aa), lineCov(v.v_world.y, sp, lw, aa)) * minorFade;
    let majorC = max(lineCov(v.v_world.x, major, lw, aa), lineCov(v.v_world.y, major, lw, aa));
    let axisXC = 1.0 - smoothstep(lw, lw + aa, abs(v.v_world.y));
    let axisYC = 1.0 - smoothstep(lw, lw + aa, abs(v.v_world.x));

    var c = vec4f(0.0, 0.0, 0.0, 0.0);
    c = over(vec4f(mc.u_minorColor.rgb, mc.u_minorColor.a * minorC), c);
    c = over(vec4f(mc.u_majorColor.rgb, mc.u_majorColor.a * majorC), c);
    c = over(vec4f(mc.u_axisXColor.rgb, mc.u_axisXColor.a * axisXC), c);
    c = over(vec4f(mc.u_axisYColor.rgb, mc.u_axisYColor.a * axisYC), c);
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

    // The rect the camera actually sees on the z = 0 plane the quad sits on. Under
    // a perspective eye that is NOT orthoSize — reading it there left the grid a
    // bounded island floating in the middle of the viewport, since the quad was
    // sized for a projection the view is no longer using.
    const { halfW, halfH } = editorViewHalfExtent(view, width / height);
    const worldPerPixel = (2 * halfH) / height;

    setParam('u_rect', view.x, view.y, halfW, halfH);
    setParam('u_gridParams', grid.spacing, grid.majorEvery, worldPerPixel, 0);
    setParam('u_minorColor', grid.color[0], grid.color[1], grid.color[2], grid.color[3]);
    setParam('u_majorColor', grid.majorColor[0], grid.majorColor[1], grid.majorColor[2], grid.majorColor[3]);
    setParam('u_axisXColor', grid.axisX[0], grid.axisX[1], grid.axisX[2], grid.axisX[3]);
    setParam('u_axisYColor', grid.axisY[0], grid.axisY[1], grid.axisY[2], grid.axisY[3]);

    Draw.drawMeshWithMaterial(quad_, material_);
  });
}
