// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rigAuthor.ts
 * @brief   A 2D rig as a model writes one: bones from a joint to a tip and parts as boxes on a picture, in the character's own pixels.
 *
 * @details The `.esrig` keeps bones in their parents' space and parts as meshes with a weight list per vertex, which is what a scene
 *          needs and nothing anyone can write by hand. This is the other side: every point is where it is on the assembled character,
 *          in pixels with y up and the point it stands on at 0, 0, and what each part follows is a list of bone names. Building one
 *          covers each part with the same grid the Rig editor uses and binds it with the same weights, so a rig made here opens there
 *          and goes on being edited by hand. Reading a rig back gives the description again, so a model can change one bone and write
 *          it whole without restating anything it did not mean to change.
 */
import {
  RIG_SOURCE_VERSION, autoWeightPart, bindPartToBone, checkRig, coverRigPart, findRigParts, rigBoneWorlds, rigVertex,
  type RigBone, type RigImage, type RigPart, type RigSource,
} from 'esengine/rig2d';

const DEG = Math.PI / 180;

export interface RigBoneSpec {
  name: string;
  /** A bone named earlier or later; none for a root. */
  parent?: string;
  /** The joint, in character pixels with y up. */
  from: [number, number];
  /** Where it reaches. Left out it has no length and points the way its parent does, or along `angle`. */
  to?: [number, number];
  /** Degrees counter-clockwise from right, for a bone with no `to`. */
  angle?: number;
}

export interface RigPartSpec {
  name: string;
  /** The box on the picture it was drawn in, [x, y, w, h] in the picture's pixels from its top left. Trimmed to what is drawn in it. */
  rect: [number, number, number, number];
  /** Where the middle of `rect` stands on the character. Left out, it stands where it lies on the picture, measured from `origin`. */
  at?: [number, number];
  /** Follows this bone alone and does not bend: a head, a hand, a sword. */
  bone?: string;
  /** Bends between these bones by how near each vertex is to each. */
  bones?: string[];
  /** How sharply a bone's pull ends between two of `bones`; 4 by default, higher for a crisper joint. */
  falloff?: number;
  /** Grid cell in picture pixels; 16 by default. Smaller bends smoother and costs triangles. */
  cell?: number;
}

export interface RigSpec {
  /** Project path of the picture the parts are cut from. */
  image: string;
  /** World units a picture pixel covers; 1 by default, which is what a 2D scene's camera usually counts in. */
  unitsPerPixel?: number;
  /** The picture pixel the character stands on, for parts with no `at`. The middle of its bottom edge by default. */
  origin?: [number, number];
  bones: RigBoneSpec[];
  /** Drawn in this order, the first at the back. */
  parts: RigPartSpec[];
  /** Alpha (0-255) below which a pixel counts as empty; 8 by default. */
  threshold?: number;
}

/** Pixel coverage of the picture, and its size. */
export type RigPicture = RigImage;

export interface RigBuild {
  rig: RigSource;
  /** What a reader should know: what each part was bound to when nothing was said, joints nothing covers, drawings no part takes. */
  notes: string[];
  /** Per part, the bones it follows, as chosen. */
  follows: Record<string, string[]>;
}

const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isBox = (v: unknown): v is [number, number, number, number] => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Every way a description is not one, as sentences; empty when it can be built. Does not look at the picture. */
export function checkRigSpec(spec: RigSpec): string[] {
  const out: string[] = [];
  if (!spec || typeof spec !== 'object') return ['the rig is not an object'];
  if (typeof spec.image !== 'string' || !spec.image) out.push('`image` must be the project path of the picture the parts are drawn on');
  if (spec.unitsPerPixel !== undefined && !(spec.unitsPerPixel > 0)) out.push('`unitsPerPixel` must be above 0');
  if (spec.origin !== undefined && !isPoint(spec.origin)) out.push('`origin` must be [x, y]');
  if (!Array.isArray(spec.bones) || spec.bones.length === 0) out.push('`bones` must list at least one bone');
  if (!Array.isArray(spec.parts) || spec.parts.length === 0) out.push('`parts` must list at least one part');
  if (out.length) return out;
  const names = new Set<string>();
  for (const b of spec.bones) {
    if (typeof b?.name !== 'string' || !b.name || b.name.includes('/')) { out.push(`a bone needs a name without "/" (${JSON.stringify(b?.name)})`); continue; }
    if (names.has(b.name)) out.push(`two bones are called "${b.name}"`);
    names.add(b.name);
    if (!isPoint(b.from)) out.push(`bone "${b.name}" needs \`from\`: [x, y], its joint`);
    if (b.to !== undefined && !isPoint(b.to)) out.push(`bone "${b.name}": \`to\` must be [x, y]`);
    if (b.angle !== undefined && !Number.isFinite(b.angle)) out.push(`bone "${b.name}": \`angle\` must be a number of degrees`);
  }
  for (const b of spec.bones) {
    if (b?.parent !== undefined && !names.has(b.parent)) out.push(`bone "${b.name}" names a parent "${b.parent}" that is not a bone`);
    if (b?.parent === b?.name) out.push(`bone "${b.name}" is its own parent`);
  }
  const parts = new Set<string>();
  for (const p of spec.parts) {
    const label = `part "${p?.name}"`;
    if (typeof p?.name !== 'string' || !p.name) { out.push('a part needs a name'); continue; }
    if (parts.has(p.name)) out.push(`two parts are called "${p.name}"`);
    parts.add(p.name);
    if (!isBox(p.rect) || p.rect[2] <= 0 || p.rect[3] <= 0) out.push(`${label} needs \`rect\`: [x, y, w, h], the box on the picture it is drawn in`);
    if (p.at !== undefined && !isPoint(p.at)) out.push(`${label}: \`at\` must be [x, y]`);
    if (p.bone !== undefined && p.bones !== undefined) out.push(`${label} has both \`bone\` and \`bones\`: one bone that holds it stiff, or several it bends between`);
    if (p.bone !== undefined && !names.has(p.bone)) out.push(`${label} follows "${p.bone}", which is not a bone`);
    for (const b of p.bones ?? []) if (!names.has(b)) out.push(`${label} follows "${b}", which is not a bone`);
    if (p.bones !== undefined && (!Array.isArray(p.bones) || p.bones.length === 0)) out.push(`${label}: \`bones\` lists at least one bone`);
    if (p.cell !== undefined && !(p.cell >= 2)) out.push(`${label}: \`cell\` must be 2 pixels or more`);
  }
  // A loop of parents would leave no bone first.
  const parentOf = new Map(spec.bones.map((b) => [b.name, b.parent]));
  for (const b of spec.bones) {
    const seen = new Set<string>();
    for (let at: string | undefined = b.name; at !== undefined; at = parentOf.get(at)) {
      if (seen.has(at)) { out.push(`bone "${b.name}" is its own ancestor`); break; }
      seen.add(at);
    }
  }
  return out;
}

/** The bones with every parent before its children, keeping the written order otherwise. */
function parentsFirst(bones: readonly RigBoneSpec[]): RigBoneSpec[] {
  const byName = new Map(bones.map((b) => [b.name, b])), placed = new Set<string>(), out: RigBoneSpec[] = [];
  const place = (b: RigBoneSpec): void => {
    if (placed.has(b.name)) return;
    if (b.parent !== undefined) place(byName.get(b.parent)!);
    placed.add(b.name);
    out.push(b);
  };
  bones.forEach(place);
  return out;
}

/** The part of `rect` (clipped to the picture) with something drawn in it, or null when it is empty. */
function trimmed(image: RigPicture, rect: readonly number[], threshold: number): { x: number; y: number; w: number; h: number } | null {
  const x0 = Math.max(0, Math.floor(rect[0]!)), y0 = Math.max(0, Math.floor(rect[1]!));
  const x1 = Math.min(image.width, Math.ceil(rect[0]! + rect[2]!)), y1 = Math.min(image.height, Math.ceil(rect[1]! + rect[3]!));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (image.alpha(x, y) < threshold) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Which sides of the box run through the drawing: what was drawn there goes on past the box and is cut off. */
function cutSides(image: RigPicture, rect: readonly number[], threshold: number): string[] {
  const x0 = Math.floor(rect[0]!), y0 = Math.floor(rect[1]!), x1 = Math.ceil(rect[0]! + rect[2]!) - 1, y1 = Math.ceil(rect[1]! + rect[3]!) - 1;
  const drawn = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < image.width && y < image.height && image.alpha(x, y) >= threshold;
  // Drawn on the edge AND just past it: a part that merely touches its box is not cut.
  const side = (name: string, n: number, at: (i: number) => [number, number, number, number]): string | null => {
    for (let i = 0; i < n; i++) { const [x, y, ox, oy] = at(i); if (drawn(x, y) && drawn(ox, oy)) return name; }
    return null;
  };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  return [
    side('left', h, (i) => [x0, y0 + i, x0 - 1, y0 + i]),
    side('right', h, (i) => [x1, y0 + i, x1 + 1, y0 + i]),
    side('top', w, (i) => [x0 + i, y0, x0 + i, y0 - 1]),
    side('bottom', w, (i) => [x0 + i, y1, x0 + i, y1 + 1]),
  ].filter((s): s is string => s !== null);
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How far a bone comes to a box (left, top, w, h in rig space, y up): 0 when it runs through it. */
function segmentToBox(g: { ax: number; ay: number; bx: number; by: number }, left: number, top: number, w: number, h: number): number {
  let best = Infinity;
  for (let k = 0; k <= 16; k++) {
    const x = g.ax + ((g.bx - g.ax) * k) / 16, y = g.ay + ((g.by - g.ay) * k) / 16;
    const dx = Math.max(left - x, 0, x - (left + w)), dy = Math.max(y - top, 0, top - h - y);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/** Where each bone runs in rig space, joint to tip. */
export function rigBoneSegments(rig: RigSource): { ax: number; ay: number; bx: number; by: number }[] {
  return rigBoneWorlds(rig.bones).map((w, i) => {
    const length = rig.bones[i]!.length;
    return { ax: w.x, ay: w.y, bx: w.x + Math.cos(w.rotation) * length, by: w.y + Math.sin(w.rotation) * length };
  });
}

/** Whether a rig-space point lies on something drawn of a part. */
function partCovers(rig: RigSource, image: RigPicture, part: RigPart, x: number, y: number, threshold: number): boolean {
  const px = (x - part.x) / rig.unitsPerPixel + part.rect.x, py = (part.y - y) / rig.unitsPerPixel + part.rect.y;
  const ix = Math.floor(px), iy = Math.floor(py);
  if (ix < part.rect.x || iy < part.rect.y || ix >= part.rect.x + part.rect.w || iy >= part.rect.y + part.rect.h) return false;
  return image.alpha(ix, iy) >= threshold;
}

/** Builds the `.esrig` a description says, on `texture` (the asset ref the rig names its picture by). Throws on one that cannot be built. */
export function buildRig(spec: RigSpec, image: RigPicture, texture: string): RigBuild {
  const problems = checkRigSpec(spec);
  if (problems.length) throw new Error(problems.join('; '));
  const upp = spec.unitsPerPixel ?? 1, threshold = spec.threshold ?? 8;
  const origin = spec.origin ?? [image.width / 2, image.height];
  const notes: string[] = [];

  const ordered = parentsFirst(spec.bones);
  const index = new Map(ordered.map((b, i) => [b.name, i]));
  const bones: RigBone[] = [];
  const worldTurn: number[] = [];
  ordered.forEach((b, i) => {
    const parent = b.parent !== undefined ? index.get(b.parent)! : -1;
    const fx = b.from[0] * upp, fy = b.from[1] * upp;
    let turn: number, length = 0;
    if (b.to && (b.to[0] !== b.from[0] || b.to[1] !== b.from[1])) {
      turn = Math.atan2(b.to[1] - b.from[1], b.to[0] - b.from[0]);
      length = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1]) * upp;
    } else turn = b.angle !== undefined ? b.angle * DEG : parent >= 0 ? worldTurn[parent]! : 0;
    worldTurn[i] = turn;
    if (parent < 0) { bones.push({ name: b.name, parent: -1, x: fx, y: fy, rotation: turn, length, id: `b${i}` }); return; }
    const p = ordered[parent]!, pr = worldTurn[parent]!, px = p.from[0] * upp, py = p.from[1] * upp;
    const c = Math.cos(pr), s = Math.sin(pr), dx = fx - px, dy = fy - py;
    bones.push({ name: b.name, parent, x: c * dx + s * dy, y: -s * dx + c * dy, rotation: turn - pr, length, id: `b${i}` });
  });

  const rig: RigSource = { version: RIG_SOURCE_VERSION, texture, textureWidth: image.width, textureHeight: image.height, unitsPerPixel: upp, bones, parts: [], deforms: [] };
  const segments = rigBoneSegments(rig);
  const follows: Record<string, string[]> = {};
  for (const p of spec.parts) {
    const box = trimmed(image, p.rect, threshold);
    if (!box) throw new Error(`part "${p.name}": nothing is drawn in its rect [${p.rect.join(', ')}] of ${spec.image} (${image.width}x${image.height})`);
    const cut = cutSides(image, p.rect, threshold);
    if (cut.length) notes.push(`part "${p.name}": the drawing goes on past the ${cut.join(' and ')} of its rect and is cut off there; widen the rect, or leave a clear gap between parts on the picture`);
    const cx = p.rect[0] + p.rect[2] / 2, cy = p.rect[1] + p.rect[3] / 2;
    const at = p.at ?? [cx - origin[0], origin[1] - cy];
    // The trimmed box's top left, moved as the middle of the written box is.
    const left = at[0] + (box.x - cx), top = at[1] - (box.y - cy);
    const cell = p.cell ?? 16;
    const part: RigPart = { name: p.name, rect: box, x: left * upp, y: top * upp, ...coverRigPart(image, box, { cell, threshold }), weights: [] };
    let chosen: number[];
    if (p.bone !== undefined) {
      chosen = [index.get(p.bone)!];
      bindPartToBone(part, chosen[0]!);
    } else {
      if (p.bones) chosen = p.bones.map((n) => index.get(n)!);
      else {
        // Nothing said: the bone nearest the middle of the part, and those joined to it that run through the part.
        const mx = (left + box.w / 2) * upp, my = (top - box.h / 2) * upp, reach = Math.hypot(box.w, box.h) / 2 * upp + cell * upp;
        const dist = segments.map((g) => distanceToSegment(mx, my, g.ax, g.ay, g.bx, g.by));
        const nearest = dist.indexOf(Math.min(...dist));
        const joined = bones.flatMap((b, i) => (i === bones[nearest]!.parent || b.parent === nearest ? [i] : []));
        chosen = [nearest, ...joined.filter((i) => dist[i]! <= reach)];
        notes.push(`part "${p.name}" said nothing to follow and follows ${chosen.map((i) => bones[i]!.name).join(', ')}; give it \`bone\` or \`bones\` to choose`);
      }
      part.weights = Array.from({ length: part.vertices.length / 2 }, () => []);
      autoWeightPart(rig, part, { bones: chosen, falloff: p.falloff });
    }
    follows[p.name] = chosen.map((i) => bones[i]!.name);
    // A part away from every bone it follows swings round them at a distance, as a flag round its pole.
    const gap = Math.min(...chosen.map((i) => segmentToBox(segments[i]!, left * upp, top * upp, box.w * upp, box.h * upp))) / upp;
    if (gap > Math.max(4, Math.min(box.w, box.h) / 4)) {
      notes.push(`part "${p.name}" is ${round(gap)} px from the nearest bone it follows (${follows[p.name]!.join(', ')}): it will swing round it at a distance. Check its \`at\`, or which bones it follows`);
    }
    rig.parts.push(part);
  }

  // A joint is where two parts have to overlap, or bending it opens a gap.
  bones.forEach((b, i) => {
    if (b.parent < 0) return;
    const j = segments[i]!;
    const over = rig.parts.filter((part) => partCovers(rig, image, part, j.ax, j.ay, threshold)).map((part) => part.name);
    if (over.length === 0) notes.push(`the joint of "${b.name}" at [${round(j.ax / upp)}, ${round(j.ay / upp)}] is on nothing drawn: no part covers it, so turning it moves parts apart. Move the joint onto the drawing, or draw the parts to overlap there`);
    else if (over.length === 1) {
      const follow = follows[over[0]!] ?? [];
      if (!(follow.includes(b.name) && follow.includes(bones[b.parent]!.name))) {
        notes.push(`the joint of "${b.name}" is covered by "${over[0]}" alone, which does not bend between "${bones[b.parent]!.name}" and "${b.name}": turning it opens a gap there. Draw the neighbouring part on past the joint (a rounded end under the other), or let one part follow both bones`);
      }
    }
  });

  // What is drawn that no part takes.
  const taken = rig.parts.map((p) => p.rect);
  for (const island of findRigParts(image, { threshold, minArea: 64 })) {
    const cx = island.x + island.w / 2, cy = island.y + island.h / 2;
    if (!taken.some((r) => cx >= r.x && cy >= r.y && cx < r.x + r.w && cy < r.y + r.h)) notes.push(`something is drawn at [${island.x}, ${island.y}, ${island.w}, ${island.h}] that no part takes`);
  }

  const bad = checkRig(rig);
  if (bad.length) throw new Error(`the rig came out wrong: ${bad.join('; ')}`);
  return { rig, notes, follows };
}

const round = (v: number, places = 1): number => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

/** The description an `.esrig` is, as {@link buildRig} reads one: what rig_read answers, to change and write again. */
export function describeRig(rig: RigSource, image: string): RigSpec {
  const upp = rig.unitsPerPixel, worlds = rigBoneWorlds(rig.bones);
  const bones: RigBoneSpec[] = rig.bones.map((b, i) => {
    const w = worlds[i]!;
    const spec: RigBoneSpec = { name: b.name, from: [round(w.x / upp), round(w.y / upp)] };
    if (b.parent >= 0) spec.parent = rig.bones[b.parent]!.name;
    if (b.length > 0) spec.to = [round((w.x + Math.cos(w.rotation) * b.length) / upp), round((w.y + Math.sin(w.rotation) * b.length) / upp)];
    else if (Math.abs(w.rotation) > 1e-6) spec.angle = round(w.rotation / DEG);
    return spec;
  });
  const parts: RigPartSpec[] = rig.parts.map((p) => {
    const spec: RigPartSpec = {
      name: p.name, rect: [p.rect.x, p.rect.y, p.rect.w, p.rect.h],
      at: [round(p.x / upp + p.rect.w / 2), round(p.y / upp - p.rect.h / 2)],
    };
    const used = new Set<number>();
    for (const w of p.weights) for (let k = 0; k < w.length; k += 2) if (w[k + 1]! > 0) used.add(w[k]!);
    const names = [...used].sort((a, b) => a - b).map((i) => rig.bones[i]!.name);
    const stiff = used.size === 1 && p.weights.every((w) => w.length === 2 && w[1] === 1);
    if (stiff) spec.bone = names[0]!;
    else if (names.length) spec.bones = names;
    return spec;
  });
  return { image, unitsPerPixel: upp, bones, parts };
}

/** Where a part's vertex is in character pixels; for tests and pictures. */
export function rigVertexPixels(rig: RigSource, part: RigPart, vertex: number): [number, number] {
  const v = rigVertex(rig, part, vertex);
  return [v.x / rig.unitsPerPixel, v.y / rig.unitsPerPixel];
}
