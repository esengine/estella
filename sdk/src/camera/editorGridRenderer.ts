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
 * The quad is a unit quad scaled+translated by `u_model` to cover the camera's
 * visible world rect (centre = EditorView.x/y, half-extent = orthoSize * aspect
 * by orthoSize), so the fragment's interpolated world position is exact and no
 * inverse view-projection is needed. Line width and minor-line density fade are
 * driven by `worldPerPixel` (= 2·orthoSize / viewportHeight), so the grid stays
 * crisp and moiré-free at every zoom without relying on GLSL derivatives.
 *
 * Frontends just install this once and flip the `EditorGrid` resource — the web
 * editor and the headless render host (pixel verification) get the grid for free.
 */
import type { App } from '../app';
import { Draw } from '../draw';
import { Geometry, type GeometryHandle } from '../geometry';
import { Material, type MaterialHandle } from '../material';
import { BlendMode } from '../blend';
import { registerPreSceneDrawCallback } from '../customDraw';
import { EditorView } from './EditorView';
import { EditorGrid, DEFAULT_EDITOR_GRID } from './EditorGrid';

const GRID_VERT = `
attribute vec2 a_position;
uniform mat4 u_projection;
uniform mat4 u_model;
varying vec2 v_world;
void main() {
  vec4 wp = u_model * vec4(a_position, 0.0, 1.0);
  v_world = wp.xy;
  gl_Position = u_projection * wp;
}
`;

const GRID_FRAG = `
precision highp float;
varying vec2 v_world;
uniform float u_param0; // minor spacing (world units)
uniform float u_param1; // major every Nth line
uniform float u_param2; // worldPerPixel
uniform vec4 u_color;   // minor line color
uniform vec4 u_vec0;    // major line color
uniform vec4 u_vec1;    // X axis (world y=0) color
uniform vec4 u_vec2;    // Y axis (world x=0) color

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
  float sp = u_param0;
  float major = sp * u_param1;
  float aa = u_param2;       // ~1px in world units
  float lw = aa * 0.5;       // ~1px line

  // Fade minor lines out as they crowd below a few pixels apart (anti-moiré).
  float minorFade = smoothstep(3.0, 9.0, sp / max(u_param2, 1e-6));
  float minorC = max(lineCov(v_world.x, sp, lw, aa), lineCov(v_world.y, sp, lw, aa)) * minorFade;
  float majorC = max(lineCov(v_world.x, major, lw, aa), lineCov(v_world.y, major, lw, aa));
  float axisXC = 1.0 - smoothstep(lw, lw + aa, abs(v_world.y)); // world y=0
  float axisYC = 1.0 - smoothstep(lw, lw + aa, abs(v_world.x)); // world x=0

  vec4 c = vec4(0.0);
  c = over(vec4(u_color.rgb, u_color.a * minorC), c);
  c = over(vec4(u_vec0.rgb, u_vec0.a * majorC), c);
  c = over(vec4(u_vec1.rgb, u_vec1.a * axisXC), c);
  c = over(vec4(u_vec2.rgb, u_vec2.a * axisYC), c);
  if (c.a <= 0.0) discard;
  gl_FragColor = c;
}
`;

let quad_: GeometryHandle = 0;
let material_: MaterialHandle = 0;
// Reused column-major translate·scale model matrix (no per-frame allocation).
const model_ = new Float32Array(16);

function ensureResources(): boolean {
  if (material_) return true;
  const shader = Material.createShader(GRID_VERT, GRID_FRAG);
  if (!shader) return false;
  quad_ = Geometry.createQuad(2, 2); // [-1, 1] unit quad
  material_ = Material.create({ shader, blendMode: BlendMode.Normal, depthTest: false });
  return true;
}

// translate(tx,ty) · scale(sx,sy) as a column-major 4x4.
function setModel(m: Float32Array, tx: number, ty: number, sx: number, sy: number): void {
  m.fill(0);
  m[0] = sx;
  m[5] = sy;
  m[10] = 1;
  m[15] = 1;
  m[12] = tx;
  m[13] = ty;
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

    const halfH = view.orthoSize;
    const halfW = halfH * (width / height);
    const worldPerPixel = (2 * halfH) / height;
    setModel(model_, view.x, view.y, halfW, halfH);

    Material.setUniform(material_, 'u_param0', grid.spacing);
    Material.setUniform(material_, 'u_param1', grid.majorEvery);
    Material.setUniform(material_, 'u_param2', worldPerPixel);
    Material.setUniform(material_, 'u_color', grid.color);
    Material.setUniform(material_, 'u_vec0', grid.majorColor);
    Material.setUniform(material_, 'u_vec1', grid.axisX);
    Material.setUniform(material_, 'u_vec2', grid.axisY);

    Draw.drawMeshWithMaterial(quad_, material_, model_);
  });
}
