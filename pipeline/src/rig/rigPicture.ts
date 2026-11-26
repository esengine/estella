// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rigPicture.ts
 * @brief   Pictures of a 2D rig for whoever cannot watch it move: the pose with its bones, who owns each part, a bend test, and a clip as frames.
 *
 * @details Drawn on the CPU from the same skinning the shader does, triangle by triangle with the rig's picture, so a fault in the
 *          picture is a fault in the rig and not in a renderer. Text is not drawn here: each sheet says where its labels go and the
 *          caller writes them with whatever draws text where it runs.
 *
 *          A clip is shown the way an animator checks one: the frames side by side at one scale, then all of them over each other
 *          with the paths the hands and feet take and the ground under them, which is where a sliding foot or a pop shows.
 */
import type { RigSource } from 'esengine/rig2d';
import { bentPose, bindPose, boneTip, poseWorlds, sampleRigPose, skinRig, type Affine, type RigLocalPose, type RigTimeline } from './rigClip';

export interface RigBitmap { width: number; height: number; rgba: Uint8Array }
export interface RigLabel { x: number; y: number; text: string; color: string; size: number }
export interface RigSheet extends RigBitmap { labels: RigLabel[] }

/** Distinct and readable on the grey ground: a bone's colour is its index into this, round again past the end. */
const PALETTE = [
  [230, 80, 70], [70, 160, 235], [250, 190, 50], [90, 200, 110], [200, 100, 220], [60, 210, 200],
  [245, 130, 40], [150, 120, 240], [235, 100, 160], [170, 210, 70], [120, 160, 190], [220, 160, 120],
];
export const boneColor = (i: number): [number, number, number] => PALETTE[i % PALETTE.length] as [number, number, number];
const hex = (c: readonly number[]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const GROUND = [58, 60, 66], GROUND_DARK = [50, 52, 57];

function canvas(width: number, height: number): RigBitmap {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // A faint check, so a hole in a part is never mistaken for a dark colour.
    const g = ((x >> 3) + (y >> 3)) & 1 ? GROUND : GROUND_DARK, at = (y * width + x) * 4;
    rgba[at] = g[0]!; rgba[at + 1] = g[1]!; rgba[at + 2] = g[2]!; rgba[at + 3] = 255;
  }
  return { width, height, rgba };
}

function blend(target: RigBitmap, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height || a <= 0) return;
  const at = (y * target.width + x) * 4, k = Math.min(1, a);
  target.rgba[at] = target.rgba[at]! + (r - target.rgba[at]!) * k;
  target.rgba[at + 1] = target.rgba[at + 1]! + (g - target.rgba[at + 1]!) * k;
  target.rgba[at + 2] = target.rgba[at + 2]! + (b - target.rgba[at + 2]!) * k;
}

/** How rig space lands on a panel: x right, y up, scaled and moved. */
interface Frame { scale: number; ox: number; oy: number; px: number; py: number; w: number; h: number }
const toScreen = (f: Frame, x: number, y: number): [number, number] => [f.px + f.ox + x * f.scale, f.py + f.oy - y * f.scale];

/** A box holding every point, as [minX, minY, maxX, maxY] in rig space. */
type Bounds = [number, number, number, number];
function grow(b: Bounds, x: number, y: number): void {
  if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
}

function fit(bounds: Bounds, px: number, py: number, w: number, h: number, top = 18): Frame {
  const pad = 10, bw = Math.max(bounds[2] - bounds[0], 1e-6), bh = Math.max(bounds[3] - bounds[1], 1e-6);
  const scale = Math.min((w - pad * 2) / bw, (h - top - pad * 2) / bh);
  return { scale, ox: (w - bw * scale) / 2 - bounds[0] * scale, oy: top + (h - top - bh * scale) / 2 + bounds[3] * scale, px, py, w, h };
}

/** Draws the rig's parts as posed. `tint` colours each vertex by the bones it follows instead of the picture's colour. */
function drawParts(target: RigBitmap, rig: RigSource, tex: RigBitmap, skinned: Float32Array[], f: Frame, opts: { alpha?: number; tint?: boolean } = {}): void {
  const alpha = opts.alpha ?? 1;
  const clipX0 = Math.max(0, Math.floor(f.px)), clipY0 = Math.max(0, Math.floor(f.py));
  const clipX1 = Math.min(target.width, Math.floor(f.px + f.w)), clipY1 = Math.min(target.height, Math.floor(f.py + f.h));
  rig.parts.forEach((part, p) => {
    const verts = skinned[p]!, n = part.vertices.length / 2;
    const sx = new Float32Array(n), sy = new Float32Array(n);
    for (let v = 0; v < n; v++) [sx[v], sy[v]] = toScreen(f, verts[v * 2]!, verts[v * 2 + 1]!);
    const tint = opts.tint ? Array.from({ length: n }, (_, v) => {
      const w = part.weights[v]!, c = [0, 0, 0];
      for (let k = 0; k < w.length; k += 2) { const col = boneColor(w[k]!); c[0] += col[0] * w[k + 1]!; c[1] += col[1] * w[k + 1]!; c[2] += col[2] * w[k + 1]!; }
      return c;
    }) : null;
    for (let t = 0; t < part.triangles.length; t += 3) {
      const i0 = part.triangles[t]!, i1 = part.triangles[t + 1]!, i2 = part.triangles[t + 2]!;
      const x0 = sx[i0]!, y0 = sy[i0]!, x1 = sx[i1]!, y1 = sy[i1]!, x2 = sx[i2]!, y2 = sy[i2]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) continue;
      const minX = Math.max(clipX0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(clipX1 - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(clipY0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(clipY1 - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / area;
        const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
        const w2 = 1 - w0 - w1;
        // A hair of slack, so two triangles sharing an edge leave no crack between them.
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const u = part.rect.x + part.vertices[i0 * 2]! * w0 + part.vertices[i1 * 2]! * w1 + part.vertices[i2 * 2]! * w2;
        const v = part.rect.y + part.vertices[i0 * 2 + 1]! * w0 + part.vertices[i1 * 2 + 1]! * w1 + part.vertices[i2 * 2 + 1]! * w2;
        const tx = Math.min(tex.width - 1, Math.max(0, Math.floor(u))), ty = Math.min(tex.height - 1, Math.max(0, Math.floor(v)));
        // Only what the part's own box holds: a grid cell's corner can reach a neighbour's paint.
        if (tx < part.rect.x || ty < part.rect.y || tx >= part.rect.x + part.rect.w || ty >= part.rect.y + part.rect.h) continue;
        const at = (ty * tex.width + tx) * 4, a = tex.rgba[at + 3]! / 255;
        if (a <= 0) continue;
        if (tint) {
          const lum = (tex.rgba[at]! * 0.3 + tex.rgba[at + 1]! * 0.59 + tex.rgba[at + 2]! * 0.11) / 255, k = 0.6 + 0.4 * lum;
          const c0 = tint[i0]!, c1 = tint[i1]!, c2 = tint[i2]!;
          blend(target, x, y, (c0[0]! * w0 + c1[0]! * w1 + c2[0]! * w2) * k, (c0[1]! * w0 + c1[1]! * w1 + c2[1]! * w2) * k, (c0[2]! * w0 + c1[2]! * w1 + c2[2]! * w2) * k, a * alpha);
        } else blend(target, x, y, tex.rgba[at]!, tex.rgba[at + 1]!, tex.rgba[at + 2]!, a * alpha);
      }
    }
  });
}

function line(target: RigBitmap, x0: number, y0: number, x1: number, y1: number, color: readonly number[], width = 1, alpha = 1): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2)), r = width / 2;
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps, y = y0 + ((y1 - y0) * s) / steps;
    for (let dy = Math.floor(-r); dy <= Math.ceil(r); dy++) for (let dx = Math.floor(-r); dx <= Math.ceil(r); dx++) {
      if (dx * dx + dy * dy > r * r + 0.25) continue;
      blend(target, Math.round(x + dx), Math.round(y + dy), color[0]!, color[1]!, color[2]!, alpha);
    }
  }
}

function dot(target: RigBitmap, x: number, y: number, radius: number, color: readonly number[], alpha = 1): void {
  for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
    if (dx * dx + dy * dy <= radius * radius) blend(target, Math.round(x + dx), Math.round(y + dy), color[0]!, color[1]!, color[2]!, alpha);
  }
}

function drawBones(target: RigBitmap, rig: RigSource, worlds: readonly Affine[], f: Frame, alpha = 1): void {
  rig.bones.forEach((_, i) => {
    const m = worlds[i]!, [ax, ay] = toScreen(f, m[4], m[5]), [bx, by] = toScreen(f, ...boneTip(rig, worlds, i)), c = boneColor(i);
    line(target, ax, ay, bx, by, [20, 20, 24], 4, alpha * 0.8);
    line(target, ax, ay, bx, by, c, 2, alpha);
    dot(target, ax, ay, 3.5, [20, 20, 24], alpha);
    dot(target, ax, ay, 2.5, c, alpha);
  });
}

/** The ground the character stands on (rig y 0) and where its origin is. */
function drawGround(target: RigBitmap, f: Frame): void {
  const [, gy] = toScreen(f, 0, 0), [ox] = toScreen(f, 0, 0);
  for (let x = Math.floor(f.px); x < f.px + f.w; x += 6) line(target, x, gy, Math.min(x + 3, f.px + f.w - 1), gy, [150, 150, 160], 1, 0.7);
  line(target, ox, gy - 4, ox, gy + 4, [150, 150, 160], 1, 0.7);
}

function boundsOf(rig: RigSource, poses: { skinned: Float32Array[]; worlds: Affine[] }[]): Bounds {
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { skinned, worlds } of poses) {
    for (const verts of skinned) for (let i = 0; i < verts.length; i += 2) grow(b, verts[i]!, verts[i + 1]!);
    rig.bones.forEach((_, i) => { grow(b, worlds[i]![4], worlds[i]![5]); grow(b, ...boneTip(rig, worlds, i)); });
  }
  grow(b, 0, 0);
  return b;
}

const posed = (rig: RigSource, pose: RigLocalPose): { skinned: Float32Array[]; worlds: Affine[] } => {
  const worlds = poseWorlds(rig, pose);
  return { worlds, skinned: skinRig(rig, worlds) };
};

/** A label in the top strip of a panel. */
const title = (f: Frame, text: string): RigLabel => ({ x: f.px + 6, y: f.py + 13, text, color: '#d8d8de', size: 12 });

/**
 * The rig as built: its pose with the bones over it, each part coloured by the bones it follows, and every joint bent 30 degrees,
 * alternating down each chain, then the other way: where a joint that opens, a weight that pulls the wrong part along or a part on the
 * wrong bone shows.
 */
export function rigSheet(rig: RigSource, tex: RigBitmap, size = 300): RigSheet {
  const poses = [posed(rig, bindPose(rig)), posed(rig, bentPose(rig, 30)), posed(rig, bentPose(rig, -30))];
  const bounds = boundsOf(rig, poses);
  const panels = 4, out = canvas(size * panels, size + 22 + 16 * Math.ceil(rig.bones.length / 6)), labels: RigLabel[] = [];
  const frames = Array.from({ length: panels }, (_, k) => fit(bounds, k * size, 0, size, size));
  const names = ['pose and bones', 'who each part follows', 'every joint bent 30°', 'bent the other way'];
  frames.forEach((f, k) => {
    const p = k === 0 || k === 1 ? poses[0]! : poses[k - 1]!;
    drawGround(out, f);
    drawParts(out, rig, tex, p.skinned, f, { tint: k === 1 });
    drawBones(out, rig, p.worlds, f, k === 1 ? 0.6 : 1);
    labels.push(title(f, names[k]!));
  });
  rig.bones.forEach((b, i) => {
    const m = poses[0]!.worlds[i]!, [x, y] = toScreen(frames[0]!, m[4], m[5]);
    labels.push({ x: x + 5, y: y - 4, text: b.name, color: hex(boneColor(i)), size: 10 });
  });
  // A key under the panels: the colour of each bone, as the weight panel uses them.
  rig.bones.forEach((b, i) => {
    labels.push({ x: 8 + (i % 6) * (out.width / 6), y: size + 16 + Math.floor(i / 6) * 16, text: `■ ${b.name}`, color: hex(boneColor(i)), size: 11 });
  });
  return { ...out, labels };
}

export interface RigClipFrame { time: number; low: number; tips: Record<string, [number, number]> }

/** What a clip's frames measure, in character pixels: the lowest point drawn and where each traced bone's tip is. */
export interface RigClipMeasure {
  frames: RigClipFrame[];
  /** By traced bone: how far its tip slides sideways while it is down on its lowest (a planted foot should not). */
  slide: Record<string, number>;
  /** The most any bone's turn differs between the first frame and the clip's end, in degrees: a loop that does not close pops. */
  loopGap: number;
}

/** Times the clip is shown at: `count` even steps from 0, its end left out when it loops, as that frame is its first again. */
export function clipTimes(duration: number, count: number, loop: boolean): number[] {
  const n = Math.max(2, Math.min(24, Math.round(count)));
  return Array.from({ length: n }, (_, i) => (loop ? (duration * i) / n : (duration * i) / (n - 1)));
}

/** The leaf bones: hands, feet, the head's top, what a trace follows when none is named. */
export const leafBones = (rig: RigSource): number[] => rig.bones.flatMap((_, i) => (rig.bones.some((b) => b.parent === i) ? [] : [i]));

export function measureClip(rig: RigSource, timeline: RigTimeline, times: readonly number[], traced: readonly number[]): RigClipMeasure {
  const upp = rig.unitsPerPixel;
  const frames: RigClipFrame[] = times.map((time) => {
    const p = posed(rig, sampleRigPose(rig, timeline, time));
    let low = Infinity;
    for (const verts of p.skinned) for (let i = 1; i < verts.length; i += 2) low = Math.min(low, verts[i]!);
    const tips: Record<string, [number, number]> = {};
    for (const b of traced) { const [x, y] = boneTip(rig, p.worlds, b); tips[rig.bones[b]!.name] = [r1(x / upp), r1(y / upp)]; }
    return { time: Math.round(time * 1000) / 1000, low: r1(low / upp), tips };
  });
  const slide: Record<string, number> = {};
  for (const b of traced) {
    const name = rig.bones[b]!.name, ys = frames.map((f) => f.tips[name]![1]), floor = Math.min(...ys);
    let sum = 0;
    for (let k = 1; k < frames.length; k++) {
      if (ys[k]! - floor <= 2 && ys[k - 1]! - floor <= 2) sum += Math.abs(frames[k]!.tips[name]![0] - frames[k - 1]!.tips[name]![0]);
    }
    slide[name] = r1(sum);
  }
  const first = sampleRigPose(rig, timeline, 0), end = sampleRigPose(rig, timeline, timeline.duration);
  const loopGap = Math.max(0, ...first.rotation.map((v, i) => Math.abs(v - end.rotation[i]!) * 180 / Math.PI));
  return { frames, slide, loopGap: r1(loopGap) };
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * A clip as frames at one scale, in rows of up to six, and under them all the frames laid over each other, faint to strong in time
 * order, with the path each traced bone's tip takes and the ground line: what shows a foot that slides, a pop, or a motion with no weight.
 */
export function clipSheet(rig: RigSource, tex: RigBitmap, timeline: RigTimeline, times: readonly number[], traced: readonly number[], cell = 170): RigSheet {
  const poses = times.map((t) => posed(rig, sampleRigPose(rig, timeline, t)));
  const bounds = boundsOf(rig, poses);
  const perRow = Math.min(6, times.length), rows = Math.ceil(times.length / perRow);
  const onionH = Math.round(cell * 2.2), width = cell * perRow;
  const out = canvas(width, cell * rows + onionH), labels: RigLabel[] = [];
  poses.forEach((p, k) => {
    const f = fit(bounds, (k % perRow) * cell, Math.floor(k / perRow) * cell, cell, cell);
    drawGround(out, f);
    drawParts(out, rig, tex, p.skinned, f);
    drawBones(out, rig, p.worlds, f, 0.45);
    labels.push(title(f, `${Math.round(times[k]! * 1000) / 1000}s`));
  });
  const f = fit(bounds, 0, cell * rows, width, onionH, 20);
  drawGround(out, f);
  poses.forEach((p, k) => drawParts(out, rig, tex, p.skinned, f, { alpha: 0.18 + (0.5 * k) / Math.max(1, poses.length - 1) }));
  for (const b of traced) {
    const c = boneColor(b), pts = poses.map((p) => toScreen(f, ...boneTip(rig, p.worlds, b)));
    for (let k = 1; k < pts.length; k++) line(out, pts[k - 1]![0], pts[k - 1]![1], pts[k]![0], pts[k]![1], c, 2);
    pts.forEach(([x, y], k) => dot(out, x, y, k === 0 ? 4 : 2.5, c));
    labels.push({ x: pts[0]![0] + 6, y: pts[0]![1] - 4, text: rig.bones[b]!.name, color: hex(c), size: 10 });
  }
  labels.push(title(f, 'all frames over each other, with the paths of the traced tips (big dot = first frame) and the ground'));
  return { ...out, labels };
}
