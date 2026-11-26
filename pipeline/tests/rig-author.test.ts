// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { bakeRig, rigImageFromRGBA, rigBonePaths } from 'esengine/rig2d';
import { buildRig, checkRigSpec, describeRig, type RigSpec } from '../src/rig/rigAuthor';
import { boneTip, buildRigClip, describeRigClip, poseWorlds, sampleRigPose, skinRig, bindPose } from '../src/rig/rigClip';
import { clipSheet, clipTimes, leafBones, measureClip, rigSheet } from '../src/rig/rigPicture';

/** A sheet with three boxes drawn on it apart: a body, an upper arm and a forearm, each a flat colour. */
function sheet(): { width: number; height: number; rgba: Uint8Array } {
  const width = 160, height = 120, rgba = new Uint8Array(width * height * 4);
  const fill = (x: number, y: number, w: number, h: number, c: number[]): void => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) rgba.set([...c, 255], (j * width + i) * 4);
  };
  fill(4, 4, 30, 60, [200, 60, 60]);    // body, 30 x 60
  fill(60, 10, 40, 14, [60, 200, 60]);  // upper arm, 40 x 14, drawn lying right
  fill(110, 10, 40, 14, [60, 60, 200]); // forearm
  return { width, height, rgba };
}

const spec = (): RigSpec => ({
  image: 'assets/arm.png',
  bones: [
    { name: 'body', from: [0, 0], to: [0, 60] },
    { name: 'upper', parent: 'body', from: [0, 52], to: [36, 52] },
    { name: 'lower', parent: 'upper', from: [36, 52], to: [72, 52] },
  ],
  parts: [
    { name: 'body', rect: [0, 0, 40, 70], at: [0, 30], bone: 'body' },
    { name: 'upper', rect: [58, 8, 44, 18], at: [18, 52], bones: ['body', 'upper', 'lower'] },
    { name: 'lower', rect: [108, 8, 44, 18], at: [54, 52], bones: ['upper', 'lower'] },
  ],
});

describe('a rig from a description', () => {
  const img = sheet(), image = rigImageFromRGBA(img.width, img.height, img.rgba);

  it('refuses what it cannot build, saying what', () => {
    expect(checkRigSpec({ ...spec(), bones: [...spec().bones, { name: 'a', parent: 'nope', from: [0, 0] }] })).toEqual([expect.stringContaining('"nope"')]);
    const loop = checkRigSpec({ ...spec(), bones: [{ name: 'a', parent: 'b', from: [0, 0] }, { name: 'b', parent: 'a', from: [0, 0] }] });
    expect(loop.join(' ')).toContain('its own ancestor');
    expect(() => buildRig({ ...spec(), parts: [{ name: 'x', rect: [0, 100, 10, 10], bone: 'body' }] }, image, 'tex')).toThrow(/nothing is drawn/);
  });

  it('puts the bones where they were said, in their parents\' space, and bakes', () => {
    const { rig } = buildRig(spec(), image, '@uuid:tex');
    expect(rig.bones.map((b) => b.name)).toEqual(['body', 'upper', 'lower']);
    expect(rig.bones[0]!.rotation).toBeCloseTo(Math.PI / 2);
    expect(rig.bones[1]!.rotation).toBeCloseTo(-Math.PI / 2);
    expect(rig.bones[2]!.x).toBeCloseTo(36);
    expect(rigBonePaths(rig.bones)).toEqual(['body', 'body/upper', 'body/upper/lower']);
    // The trimmed box keeps the drawing where the written box's middle was placed.
    const body = rig.parts[0]!;
    expect(body.rect).toEqual({ x: 4, y: 4, w: 30, h: 60 });
    expect(body.x).toBeCloseTo(-16);
    expect(body.y).toBeCloseTo(61);
    expect(() => bakeRig(rig)).not.toThrow();
  });

  it('reads back as the description that builds it again', () => {
    const { rig } = buildRig(spec(), image, '@uuid:tex');
    const again = buildRig(describeRig(rig, 'assets/arm.png'), image, '@uuid:tex').rig;
    expect(again.bones.map((b) => [b.name, b.parent])).toEqual(rig.bones.map((b) => [b.name, b.parent]));
    again.bones.forEach((b, i) => { expect(b.x).toBeCloseTo(rig.bones[i]!.x, 3); expect(b.rotation).toBeCloseTo(rig.bones[i]!.rotation, 3); });
    expect(again.parts.map((p) => [p.name, p.x, p.y, p.vertices.length])).toEqual(rig.parts.map((p) => [p.name, p.x, p.y, p.vertices.length]));
    expect(describeRig(rig, 'x').parts[0]!.bone).toBe('body');
  });

  it('says what it chose and what will tear', () => {
    const s = spec();
    delete s.parts[2]!.bones;
    // Moved off along x, the forearm no longer reaches the elbow.
    s.parts[2]!.at = [70, 52];
    const { notes, follows } = buildRig(s, image, 'tex');
    expect(follows.lower).toContain('lower');
    expect(notes.join('\n')).toContain('part "lower" said nothing to follow');
    const away = buildRig({ ...spec(), parts: spec().parts.map((p) => (p.name === 'lower' ? { ...p, at: [54, 0] } : p)) }, image, 'tex').notes.join('\n');
    expect(away).toMatch(/part "lower" is [\d.]+ px from the nearest bone/);
    const cut = buildRig({ ...spec(), parts: [{ ...spec().parts[0]!, rect: [10, 10, 10, 10] }] }, image, 'tex').notes.join('\n');
    expect(cut).toContain('goes on past');
    expect(cut).toContain('no part takes');
  });
});

describe('a clip for a rig', () => {
  const img = sheet(), image = rigImageFromRGBA(img.width, img.height, img.rgba);
  const { rig } = buildRig(spec(), image, 'tex');

  it('writes a timeline the engine samples to the pose it said', () => {
    const { timeline, notes } = buildRigClip({ duration: 1, bones: { lower: { turn: [[0, 0], [0.5, 90], [1, 0]] }, body: { move: [[0, 0, 0], [0.5, 0, -4, 'linear'], [1, 0, 0]] } } }, rig);
    expect(notes).toEqual([]);
    expect(timeline.wrapMode).toBe('loop');
    expect(timeline.tracks.map((t) => t.childPath).sort()).toEqual(['body', 'body/upper/lower']);
    const half = sampleRigPose(rig, timeline, 0.5);
    expect(half.rotation[2]).toBeCloseTo(Math.PI / 2);
    expect(half.y[0]).toBeCloseTo(-4);
    // The forearm's far end swings up round the elbow.
    const skinned = skinRig(rig, poseWorlds(rig, half)), rest = skinRig(rig, poseWorlds(rig, bindPose(rig)));
    const top = (v: Float32Array): number => Math.max(...Array.from(v).filter((_, i) => i % 2 === 1));
    expect(top(skinned[2]!)).toBeGreaterThan(top(rest[2]!) + 20);
  });

  it('says when a loop does not close, and reads back', () => {
    const { timeline, notes } = buildRigClip({ duration: 1, bones: { upper: { turn: [[0, 0], [1, 40]] } } }, rig);
    expect(notes.join(' ')).toContain('the loop jumps');
    const back = describeRigClip(timeline, rig).clip;
    expect(back.bones.upper!.turn).toEqual([[0, 0], [1, 40]]);
    expect(measureClip(rig, timeline, [0, 0.5], [2]).loopGap).toBeCloseTo(40);
  });

  it('reaches a tip for a point by turning it and its parent', () => {
    const { timeline, notes } = buildRigClip({ duration: 1, loop: false, bones: { lower: { reach: [[0, 40, 20], [1, 10, 80]], bend: 1 } } }, rig);
    expect(notes).toEqual([]);
    for (const [t, x, y] of [[0, 40, 20], [1, 10, 80]] as const) {
      const worlds = poseWorlds(rig, sampleRigPose(rig, timeline, t));
      const [tx, ty] = boneTip(rig, worlds, 2);
      expect(tx).toBeCloseTo(x, 1);
      expect(ty).toBeCloseTo(y, 1);
    }
    const far = buildRigClip({ duration: 1, loop: false, bones: { lower: { reach: [[0, 300, 52]] } } }, rig).notes.join(' ');
    expect(far).toContain('out of reach');
    expect(() => buildRigClip({ duration: 1, bones: { lower: { reach: [[0, 1, 1]] }, upper: { turn: [[0, 1]] } } }, rig)).toThrow(/turns it too/);
    expect(() => buildRigClip({ duration: 1, bones: { body: { reach: [[0, 1, 1]] } } }, rig)).toThrow(/no parent/);
  });

  it('keeps a child flat while its parent reaches, and copies a motion shifted', () => {
    const r = { ...rig, bones: rig.bones.map((b) => ({ ...b })) };
    // A short "foot" under lower, so lower's reach has a child to keep flat.
    r.bones.push({ name: 'foot', parent: 2, x: 36, y: 0, rotation: 0, length: 10, id: 'b9' });
    const { timeline } = buildRigClip({ duration: 1, loop: false, bones: { lower: { reach: [[0, 40, 20], [1, 10, 80]], bend: 1, flat: true }, foot: { turn: [[0, 0], [1, 20]] } } }, r);
    const world = (t: number): number => { const m = poseWorlds(r, sampleRigPose(r, timeline, t))[3]!; return Math.atan2(m[1], m[0]) * 180 / Math.PI; };
    expect(world(0)).toBeCloseTo(0, 0);
    expect(world(1)).toBeCloseTo(20, 0);
    const like = buildRigClip({ duration: 1, ease: 'linear', bones: { upper: { turn: [[0, 0], [0.5, 40], [1, 0]] }, lower: { like: { bone: 'upper', shift: 0.25 } } } }, rig).timeline;
    const lower = (t: number): number => (sampleRigPose(rig, like, t).rotation[2]! - rig.bones[2]!.rotation) * 180 / Math.PI;
    const upper = (t: number): number => (sampleRigPose(rig, like, t).rotation[1]! - rig.bones[1]!.rotation) * 180 / Math.PI;
    for (const t of [0, 0.1, 0.3, 0.6, 0.9]) expect(lower(t)).toBeCloseTo(upper((t - 0.25 + 1) % 1), 1);
    expect(() => buildRigClip({ duration: 1, bones: { lower: { like: { bone: 'upper' } } } }, rig)).toThrow(/has no motion/);
  });

  it('measures how a tip on the ground moves while it is down', () => {
    // The whole figure carried back 60 px over the clip: every tip is down all the time, moving at -60 px/s and nowhere else.
    const { timeline } = buildRigClip({ duration: 1, loop: false, ease: 'linear', bones: { body: { move: [[0, 0, 0], [1, -60, 0]] } } }, rig);
    const m = measureClip(rig, timeline, [0, 0.5], [2]);
    expect(m.planted.lower!.speed).toBeCloseTo(-60, 0);
    expect(m.planted.lower!.wobble).toBeLessThan(0.2);
    expect(m.planted.lower!.share).toBe(1);
  });

  it('refuses a bone it does not have and keys out of order', () => {
    expect(() => buildRigClip({ duration: 1, bones: { tail: { turn: [[0, 1]] } } }, rig)).toThrow(/not a bone/);
    expect(() => buildRigClip({ duration: 1, bones: { upper: { turn: [[0.5, 1], [0.2, 0]] } } }, rig)).toThrow(/forward in time/);
  });

  it('draws the rig and the clip', () => {
    const tex = { width: img.width, height: img.height, rgba: img.rgba };
    const s = rigSheet(rig, tex, 200);
    const coloured = (b: { rgba: Uint8Array }): number => { let n = 0; for (let i = 0; i < b.rgba.length; i += 4) if (b.rgba[i]! > 150 && b.rgba[i + 1]! < 100) n++; return n; };
    expect(coloured(s)).toBeGreaterThan(200);
    expect(s.labels.some((l) => l.text === 'upper')).toBe(true);
    const { timeline } = buildRigClip({ duration: 1, bones: { lower: { turn: [[0, 0], [0.5, 60], [1, 0]] } } }, rig);
    const times = clipTimes(1, 8, true);
    expect(times).toHaveLength(8);
    expect(times[7]).toBeCloseTo(0.875);
    const c = clipSheet(rig, tex, timeline, times, leafBones(rig), 120);
    expect(c.width).toBe(960);
    // Measured on the drawing, not the mesh: the body's bottom edge is drawn on the ground, and it says which part is lowest.
    const m = measureClip(rig, timeline, [0], [2], tex);
    expect(m.frames[0]!.lowPart).toBe('body');
    expect(Math.abs(m.frames[0]!.low)).toBeLessThan(1.5);
    expect(coloured(c)).toBeGreaterThan(200);
  });
});
