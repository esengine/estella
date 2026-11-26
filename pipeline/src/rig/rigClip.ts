// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rigClip.ts
 * @brief   A 2D rig's animation as a model writes one: turns in degrees and moves in pixels away from the rig's own pose, keyed in seconds.
 *
 * @details What it writes is an ordinary `.estimeline`: one property track per bone, named by the bone's path below the rig's root,
 *          writing that bone's Transform. A TimelinePlayer or an Animator state plays it, the timeline editor opens it, and a rig save
 *          that renames a bone rewrites it like any other clip. The pose a picture shows is sampled with the engine's own curve sampler
 *          from the very keys written, so the picture and the game cannot disagree about a frame.
 */
import { InterpType, sampleKeyframes, type Keyframe } from 'esengine';
import { rigBonePaths, rigBoneWorlds, type RigSource } from 'esengine/rig2d';

const DEG = Math.PI / 180;
const TIMELINE_VERSION = '1.3';

export type RigEase = 'smooth' | 'linear' | 'step';
/** [time, value...] and, last, an ease for the stretch after this key. */
export type RigKey = (number | string)[];

export interface RigBoneMotion {
  /** [t, degrees] counter-clockwise from the rig's pose. */
  turn?: RigKey[];
  /** [t, dx, dy] pixels from the rig's pose, in the parent bone's frame (for a root: right and up). */
  move?: RigKey[];
  /** [t, s] or [t, sx, sy], 1 being the rig's size. */
  scale?: RigKey[];
  /**
   * [t, x, y]: where this bone's TIP is to be, in character pixels (y up, the feet at 0, 0). This bone and its parent are turned to
   * reach it, as a leg reaches the ground; neither may have `turn` keys of its own. A foot on the floor is a shin reaching for it.
   */
  reach?: RigKey[];
  /** Which way the joint between the two bends: -1 (default) the lower bone turns clockwise from the upper, a knee of a character facing right; 1 an elbow. */
  bend?: number;
  /** How this bone's keys run into the next where a key does not say. */
  ease?: RigEase;
}

export interface RigClipSpec {
  /** Seconds. */
  duration: number;
  /** Plays round and round; true by default. */
  loop?: boolean;
  /** How keys run into the next where neither key nor bone says; smooth by default. */
  ease?: RigEase;
  /** By bone name. Bones not named keep the rig's pose. */
  bones: Record<string, RigBoneMotion>;
}

const EASES: Record<RigEase, string> = { smooth: InterpType.Hermite, linear: InterpType.Linear, step: InterpType.Step };
const EASE_OF: Record<string, RigEase> = { [InterpType.Hermite]: 'smooth', [InterpType.Linear]: 'linear', [InterpType.Step]: 'step' };

interface TimelineKey { time: number; value: number; inTangent: number; outTangent: number; interpolation: string }
interface TimelineChannel { property: string; keyframes: TimelineKey[] }
interface TimelineTrack { type: 'property'; name: string; childPath: string; component: 'Transform'; channels: TimelineChannel[] }
export interface RigTimeline { version: string; type: 'timeline'; duration: number; wrapMode: 'loop' | 'once'; tracks: TimelineTrack[] }

/** What each motion channel writes, and how many numbers a key of it carries. */
const CHANNELS = {
  turn: { width: 1 },
  move: { width: 2 },
  scale: { width: 2 },
  reach: { width: 2 },
} as const;

/** Every way a clip cannot be written for this rig, as sentences. */
export function checkRigClip(clip: RigClipSpec, rig: RigSource): string[] {
  const out: string[] = [];
  if (!clip || typeof clip !== 'object') return ['the clip is not an object'];
  if (!(clip.duration > 0) || !Number.isFinite(clip.duration)) out.push('`duration` must be a number of seconds above 0');
  if (clip.ease !== undefined && !(clip.ease in EASES)) out.push('`ease` is "smooth", "linear" or "step"');
  if (!clip.bones || typeof clip.bones !== 'object') return [...out, '`bones` must map bone names to their motion'];
  const names = new Set(rig.bones.map((b) => b.name));
  for (const [bone, motion] of Object.entries(clip.bones)) {
    if (!names.has(bone)) { out.push(`"${bone}" is not a bone of this rig (${[...names].join(', ')})`); continue; }
    if (motion.ease !== undefined && !(motion.ease in EASES)) out.push(`"${bone}": \`ease\` is "smooth", "linear" or "step"`);
    for (const kind of Object.keys(motion)) if (kind !== 'ease' && kind !== 'bend' && !(kind in CHANNELS)) out.push(`"${bone}": "${kind}" is not a motion; there are turn, move, scale and reach`);
    if (motion.bend !== undefined && motion.bend !== 1 && motion.bend !== -1) out.push(`"${bone}": \`bend\` is 1 or -1`);
    if (motion.reach) {
      const b = rig.bones.find((x) => x.name === bone)!, parent = rig.bones[b.parent];
      if (!parent) out.push(`"${bone}" has no parent bone, so it cannot reach: reach is a two-bone chain, this bone and the one above it`);
      else {
        if (motion.turn) out.push(`"${bone}" has both turn and reach: reach decides its turn`);
        const up = clip.bones[parent.name];
        if (up?.turn || up?.reach) out.push(`"${parent.name}" has its own ${up.turn ? 'turn' : 'reach'}, but "${bone}" reaching turns it too`);
        if (!(b.length > 0)) out.push(`"${bone}" has no length, so it has no tip to reach with`);
      }
    }
    for (const kind of Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]) {
      const keys = motion[kind];
      if (keys === undefined) continue;
      if (!Array.isArray(keys) || keys.length === 0) { out.push(`"${bone}".${kind} must list keys`); continue; }
      let last = -Infinity;
      keys.forEach((k, i) => {
        const values = Array.isArray(k) ? k.filter((v) => typeof v === 'number') : [];
        const ease = Array.isArray(k) ? k.find((v) => typeof v === 'string') : undefined;
        const want = kind === 'scale' ? [2, 3] : [CHANNELS[kind].width + 1];
        if (!Array.isArray(k) || !want.includes(values.length) || !values.every(Number.isFinite)) {
          out.push(`"${bone}".${kind} key ${i} must be [t, ${kind === 'turn' ? 'degrees' : kind === 'move' ? 'dx, dy' : kind === 'reach' ? 'x, y' : 's'}]${kind === 'scale' ? ' or [t, sx, sy]' : ''}, and may end with an ease`);
          return;
        }
        if (ease !== undefined && !((ease as string) in EASES)) out.push(`"${bone}".${kind} key ${i}: "${ease}" is not an ease (smooth, linear, step)`);
        const t = values[0]!;
        if (t < 0 || t > clip.duration + 1e-9) out.push(`"${bone}".${kind} key ${i} is at ${t}s, outside the clip (0 to ${clip.duration}s)`);
        if (t <= last) out.push(`"${bone}".${kind} keys must go forward in time (key ${i} at ${t}s)`);
        last = t;
      });
    }
  }
  return out;
}

/** Tangents that pass smoothly through each key, as a hand would draw the curve; a loop's ends meet with the same slope. */
function smoothTangents(times: number[], values: number[], duration: number, loop: boolean): number[] {
  const n = times.length, out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  const closed = loop && times[0] === 0 && Math.abs(times[n - 1]! - duration) < 1e-9 && Math.abs(values[0]! - values[n - 1]!) < 1e-9 && n > 2;
  for (let i = 0; i < n; i++) {
    if (i > 0 && i < n - 1) out[i] = (values[i + 1]! - values[i - 1]!) / (times[i + 1]! - times[i - 1]!);
    else if (closed) out[i] = (values[1]! - values[n - 2]!) / (times[1]! + duration - times[n - 2]!);
  }
  return out;
}

/**
 * Turns `reach` into the turns that do it. Each key is solved on the pose the rest of the clip gives at its time (the hips where
 * they have moved to), with the two bones' lengths as rigged; a target past their reach is reached for as far as they go, and said.
 */
function solveReaches(clip: RigClipSpec, rig: RigSource, notes: string[]): RigClipSpec {
  const reaching = Object.entries(clip.bones).filter(([, m]) => m.reach);
  if (!reaching.length) return clip;
  const rest: RigClipSpec = { ...clip, bones: {} };
  for (const [name, m] of Object.entries(clip.bones)) if (!m.reach) rest.bones[name] = m;
  const base = buildRigClip(rest, rig).timeline;
  const out: RigClipSpec = { ...rest, bones: { ...rest.bones } };
  const upp = rig.unitsPerPixel;
  for (const [name, motion] of reaching) {
    const i = rig.bones.findIndex((b) => b.name === name), bone = rig.bones[i]!, p = bone.parent, parent = rig.bones[p]!;
    const bend = motion.bend ?? -1;
    const upper = Math.hypot(bone.x, bone.y), lower = bone.length, offset = Math.atan2(bone.y, bone.x);
    const turnsUp: RigKey[] = [], turnsLow: RigKey[] = [];
    let far = 0;
    for (const key of motion.reach!) {
      const t = key[0] as number, ease = key.find((v) => typeof v === 'string');
      const tx = (key[1] as number) * upp, ty = (key[2] as number) * upp;
      const worlds = poseWorlds(rig, sampleRigPose(rig, base, t));
      // The parent's joint, and the turn of what it hangs from.
      const g: Affine = parent.parent >= 0 ? worlds[parent.parent]! : [1, 0, 0, 1, 0, 0];
      const px = g[0] * parent.x + g[2] * parent.y + g[4], py = g[1] * parent.x + g[3] * parent.y + g[5];
      const above = Math.atan2(g[1], g[0]);
      const toward = Math.atan2(ty - py, tx - px), wanted = Math.hypot(tx - px, ty - py);
      const d = Math.min(Math.max(wanted, Math.abs(upper - lower) + 1e-6), upper + lower - 1e-6);
      if (wanted - d > 0.5 * upp) far = Math.max(far, (wanted - d) / upp);
      const inner = Math.acos(Math.min(1, Math.max(-1, (upper * upper + d * d - lower * lower) / (2 * upper * d))));
      const jointDir = toward - bend * inner;
      const jx = px + Math.cos(jointDir) * upper, jy = py + Math.sin(jointDir) * upper;
      const upTurn = jointDir - offset, lowTurn = Math.atan2(ty - jy, tx - jx);
      const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
      const upDeg = wrap(upTurn - above - parent.rotation) / DEG, lowDeg = wrap(lowTurn - upTurn - bone.rotation) / DEG;
      turnsUp.push([t, Math.round(upDeg * 100) / 100, ...(ease ? [ease] : [])]);
      turnsLow.push([t, Math.round(lowDeg * 100) / 100, ...(ease ? [ease] : [])]);
    }
    if (far > 0) notes.push(`${name}.reach: some targets are out of reach, up to ${Math.round(far * 10) / 10} px past what "${parent.name}" and "${name}" stretch to; it reaches as far as it can`);
    out.bones[parent.name] = { ...(out.bones[parent.name] ?? {}), turn: turnsUp, ...(motion.ease ? { ease: motion.ease } : {}) };
    const { reach: _r, bend: _b, ...own } = motion;
    out.bones[name] = { ...own, turn: turnsLow };
  }
  return out;
}

/** The `.estimeline` a clip is, for this rig. Throws on one {@link checkRigClip} refuses. */
export function buildRigClip(spec: RigClipSpec, rig: RigSource): { timeline: RigTimeline; notes: string[] } {
  const problems = checkRigClip(spec, rig);
  if (problems.length) throw new Error(problems.join('; '));
  const reachNotes: string[] = [];
  const clip = solveReaches(spec, rig, reachNotes);
  const loop = clip.loop ?? true, upp = rig.unitsPerPixel, notes: string[] = [];
  const paths = rigBonePaths(rig.bones);
  const tracks: TimelineTrack[] = [];
  for (const [boneName, motion] of Object.entries(clip.bones)) {
    const i = rig.bones.findIndex((b) => b.name === boneName), bone = rig.bones[i]!;
    const fallback = motion.ease ?? clip.ease ?? 'smooth';
    const channels: TimelineChannel[] = [];
    const add = (property: string, keys: RigKey[], value: (k: number[]) => number, label: string): void => {
      const times = keys.map((k) => k[0] as number);
      const values = keys.map((k) => value(k.filter((v) => typeof v === 'number') as number[]));
      const eases = keys.map((k) => (k.find((v) => typeof v === 'string') as RigEase | undefined) ?? fallback);
      const slopes = smoothTangents(times, values, clip.duration, loop);
      channels.push({
        property,
        keyframes: times.map((time, k) => ({
          time, value: values[k]!, inTangent: eases[k - 1] === 'smooth' || k === 0 ? slopes[k]! : 0,
          outTangent: eases[k] === 'smooth' ? slopes[k]! : 0, interpolation: EASES[eases[k]!],
        })),
      });
      if (loop && keys.length > 1 && (times[0] !== 0 || Math.abs(times[times.length - 1]! - clip.duration) > 1e-9 || Math.abs(values[0]! - values[values.length - 1]!) > 1e-6)) {
        notes.push(`${boneName}.${label} does not end where it starts (a key at 0 and the same at ${clip.duration}s): the loop jumps there`);
      }
    };
    if (motion.turn) add('rotation.angle', motion.turn, (k) => bone.rotation + k[1]! * DEG, 'turn');
    if (motion.move) {
      add('position.x', motion.move, (k) => bone.x + k[1]! * upp, 'move');
      add('position.y', motion.move, (k) => bone.y + k[2]! * upp, 'move');
    }
    if (motion.scale) {
      add('scale.x', motion.scale, (k) => k[1]!, 'scale');
      add('scale.y', motion.scale, (k) => k[2] ?? k[1]!, 'scale');
    }
    if (channels.length) tracks.push({ type: 'property', name: boneName, childPath: paths[i]!, component: 'Transform', channels });
  }
  // One note per bone and motion is enough: move writes two channels.
  return { timeline: { version: TIMELINE_VERSION, type: 'timeline', duration: clip.duration, wrapMode: loop ? 'loop' : 'once', tracks }, notes: [...new Set([...reachNotes, ...notes])] };
}

const round = (v: number, places = 2): number => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

/** A timeline read back as the clip that would write it, for the rig it moves. Tracks on other things are counted, not read. */
export function describeRigClip(timeline: { duration: number; wrapMode?: string | number; tracks?: unknown[] }, rig: RigSource): { clip: RigClipSpec; skipped: number } {
  const paths = rigBonePaths(rig.bones), upp = rig.unitsPerPixel;
  const bones: Record<string, RigBoneMotion> = {};
  let skipped = 0;
  const easeOf = (k: { interpolation?: string }): RigEase => EASE_OF[k.interpolation ?? InterpType.Hermite] ?? 'smooth';
  for (const raw of timeline.tracks ?? []) {
    const track = raw as Partial<TimelineTrack>;
    const i = track.type === 'property' && track.component === 'Transform' ? paths.indexOf(track.childPath ?? '') : -1;
    if (i < 0) { skipped++; continue; }
    const bone = rig.bones[i]!, motion: RigBoneMotion = {};
    const channel = (p: string): TimelineKey[] | undefined => track.channels?.find((c) => c.property === p)?.keyframes;
    const keyed = (keys: TimelineKey[], values: (k: TimelineKey, at: number) => number[]): RigKey[] =>
      keys.map((k, at) => {
        const e = easeOf(k);
        return [round(k.time, 4), ...values(k, at), ...(e === 'smooth' ? [] : [e])];
      });
    const turn = channel('rotation.angle');
    if (turn) motion.turn = keyed(turn, (k) => [round((k.value - bone.rotation) / DEG)]);
    const px = channel('position.x'), py = channel('position.y');
    if (px || py) {
      const lead = (px ?? py)!;
      motion.move = keyed(lead, (k) => [
        round(((px ? sampleKeyframes(px as Keyframe[], k.time) : bone.x) - bone.x) / upp),
        round(((py ? sampleKeyframes(py as Keyframe[], k.time) : bone.y) - bone.y) / upp),
      ]);
    }
    const sx = channel('scale.x'), sy = channel('scale.y');
    if (sx || sy) {
      const lead = (sx ?? sy)!;
      motion.scale = keyed(lead, (k) => {
        const x = sx ? sampleKeyframes(sx as Keyframe[], k.time) : 1, y = sy ? sampleKeyframes(sy as Keyframe[], k.time) : 1;
        return Math.abs(x - y) < 1e-6 ? [round(x, 3)] : [round(x, 3), round(y, 3)];
      });
    }
    bones[bone.name] = motion;
  }
  const loop = timeline.wrapMode === 'loop' || timeline.wrapMode === 1;
  return { clip: { duration: timeline.duration, loop, bones }, skipped };
}

/** A bone's place in rig space as a 2D affine [a, b, c, d, tx, ty]: x' = a x + c y + tx, y' = b x + d y + ty. */
export type Affine = [number, number, number, number, number, number];

const multiply = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

export const invertAffine = (m: Affine): Affine => {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
};

/** A local pose: what the clip says each bone holds, by bone index. */
export interface RigLocalPose { x: number[]; y: number[]; rotation: number[]; sx: number[]; sy: number[] }

export function bindPose(rig: RigSource): RigLocalPose {
  return {
    x: rig.bones.map((b) => b.x), y: rig.bones.map((b) => b.y), rotation: rig.bones.map((b) => b.rotation),
    sx: rig.bones.map(() => 1), sy: rig.bones.map(() => 1),
  };
}

/** Each bone in rig space, composed as a scene composes Transforms: parent, then position, turn and scale. */
export function poseWorlds(rig: RigSource, pose: RigLocalPose): Affine[] {
  const out: Affine[] = [];
  rig.bones.forEach((b, i) => {
    const c = Math.cos(pose.rotation[i]!), s = Math.sin(pose.rotation[i]!);
    const local: Affine = [c * pose.sx[i]!, s * pose.sx[i]!, -s * pose.sy[i]!, c * pose.sy[i]!, pose.x[i]!, pose.y[i]!];
    out.push(b.parent >= 0 ? multiply(out[b.parent]!, local) : local);
  });
  return out;
}

/** The pose at `time`, sampled from the timeline's keys by the engine's own sampler. */
export function sampleRigPose(rig: RigSource, timeline: RigTimeline, time: number): RigLocalPose {
  const pose = bindPose(rig), paths = rigBonePaths(rig.bones);
  for (const track of timeline.tracks) {
    const i = paths.indexOf(track.childPath);
    if (i < 0) continue;
    for (const ch of track.channels) {
      const v = sampleKeyframes(ch.keyframes as Keyframe[], time);
      if (ch.property === 'rotation.angle') pose.rotation[i] = v;
      else if (ch.property === 'position.x') pose.x[i] = v;
      else if (ch.property === 'position.y') pose.y[i] = v;
      else if (ch.property === 'scale.x') pose.sx[i] = v;
      else if (ch.property === 'scale.y') pose.sy[i] = v;
    }
  }
  return pose;
}

/**
 * Every joint bent `degrees`, one way and the next joint down the other, roots left as they are: what shows a joint that tears or a
 * weight that bleeds. Alternating keeps each limb near where it hangs; bent all one way, the turns add up along a chain and the figure
 * curls into a ball that hides what it is meant to show.
 */
export function bentPose(rig: RigSource, degrees: number): RigLocalPose {
  const pose = bindPose(rig), depth: number[] = [];
  rig.bones.forEach((b, i) => {
    depth[i] = b.parent >= 0 ? depth[b.parent]! + 1 : 0;
    if (b.parent >= 0) pose.rotation[i] = b.rotation + (depth[i]! % 2 ? degrees : -degrees) * DEG;
  });
  return pose;
}

/** The rig's own pose as affines: what a vertex is skinned away from. */
export function bindWorlds(rig: RigSource): Affine[] {
  return rigBoneWorlds(rig.bones).map((w) => {
    const c = Math.cos(w.rotation), s = Math.sin(w.rotation);
    return [c, s, -s, c, w.x, w.y] as Affine;
  });
}

/** Every part's vertices posed, flat [x, y, ...] in rig space, by the sum the skinning shader does. */
export function skinRig(rig: RigSource, worlds: readonly Affine[]): Float32Array[] {
  const skin = bindWorlds(rig).map((bind, i) => multiply(worlds[i]!, invertAffine(bind)));
  return rig.parts.map((part) => {
    const n = part.vertices.length / 2, out = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) {
      const px = part.x + part.vertices[v * 2]! * rig.unitsPerPixel, py = part.y - part.vertices[v * 2 + 1]! * rig.unitsPerPixel;
      const w = part.weights[v]!;
      let x = 0, y = 0, sum = 0;
      for (let k = 0; k < w.length; k += 2) {
        const m = skin[w[k]!]!, weight = w[k + 1]!;
        x += (m[0] * px + m[2] * py + m[4]) * weight;
        y += (m[1] * px + m[3] * py + m[5]) * weight;
        sum += weight;
      }
      out[v * 2] = sum > 0 ? x / sum : px;
      out[v * 2 + 1] = sum > 0 ? y / sum : py;
    }
    return out;
  });
}

/** Where a bone's tip is, in rig space. */
export function boneTip(rig: RigSource, worlds: readonly Affine[], bone: number): [number, number] {
  const m = worlds[bone]!, l = rig.bones[bone]!.length;
  return [m[0] * l + m[4], m[1] * l + m[5]];
}
