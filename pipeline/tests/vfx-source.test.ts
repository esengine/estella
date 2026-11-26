// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { buildVfx, checkVfx, describeLightClip, describeVfx, VFX_TEXTURES, type StoredEntity, type VfxSpec } from '../src/vfx/vfxSource';
import { vfxTextureSource } from '../src/vfx/vfxTextures';
import { validateImageSource } from '../src/image/imageSource';

const fire = (): VfxSpec => ({
  unit: 100,
  layers: [
    { name: 'flames', shape: 'cone', radius: 0.2, angle: 12, rate: 60, life: [0.5, 0.9], speed: [0.6, 1.2], gravity: 0.8, size: [[0.5, 0.7], 0.1], color: [[0, '#ffd27000'], [0.15, '#ffb040ee'], [1, '#80200000']], texture: 'flame', blend: 'add', intensity: 2 },
    { name: 'smoke', rate: 5, life: [3, 5], speed: 0.4, size: [0.5, 2], color: [[0, '#40383000'], [0.2, '#4a443e55'], [1, '#60606000']], texture: 'smoke', blend: 'alpha', at: [0, 0.8, 0] },
  ],
  light: { color: '#ff8a3c', intensity: 8, radius: 4, at: [0, 0.4, 0], flicker: { amount: 0.3, speed: 8 } },
});

const boom = (): VfxSpec => ({
  layers: [
    { name: 'sparks', shape: 'sphere', radius: 0.1, bursts: [[0, 60]], life: [0.5, 1.2], speed: [4, 9], gravity: -9.8, size: [0.06, 0.02], color: '#ffd080ff', texture: 'spark', render: 'stretched', collide: { bounce: 0.4 } },
    { name: 'smoke', delay: 0.2, bursts: [[0, 16]], life: [2.5, 4], speed: [1, 2], drag: 1.5, size: [1, 3], color: [[0, '#30303000'], [0.1, '#40404066'], [1, '#55555500']], texture: 'smoke', blend: 'alpha' },
  ],
  light: { color: '#ffa050', intensity: 30, radius: 7, fade: 0.6 },
});

describe('an effect from a description', () => {
  it('refuses what it cannot build, saying what', () => {
    expect(checkVfx({ layers: [] })).toEqual([expect.stringContaining('at least one layer')]);
    const bad = checkVfx({ layers: [{ name: 'x', life: 1, size: [1, 1], color: '#zzz', blend: 'glow' as never }] }).join(' | ');
    expect(bad).toContain('emits nothing');
    expect(bad).toContain('"#zzz"');
    expect(bad).toContain('`blend` is add');
    expect(checkVfx({ layers: [{ name: 'x', rate: 1, life: 1, size: [1, 1], color: [[2, '#ffffff']] }] }).join(' ')).toContain('colour stop 0');
    expect(checkVfx({ ...fire(), light: { color: '#fff000', intensity: 1, radius: 1, flicker: { amount: 0.2 }, fade: 1 } }).join(' ')).toContain('not both');
  });

  it('writes emitters in world units, with the gradient in the shape the engine reads', () => {
    const b = buildVfx(fire());
    const flames = b.children.find((c) => c.name === 'flames')!.components.find((c) => c.type === 'ParticleEmitter')!.data as Record<string, any>;
    expect(flames.speedMin).toBeCloseTo(60);
    expect(flames.startSizeMax).toBeCloseTo(70);
    expect(flames.gravity).toEqual({ x: 0, y: 80, z: 0 });
    expect(flames.colorGradient.stops[1]).toEqual({ t: 0.15, color: expect.objectContaining({ r: 1, a: expect.closeTo(0.933, 2) }) });
    expect(flames.blendMode).toBe(1);
    expect(flames.looping).toBe(true);
    // Room for every particle it can have alive at once.
    expect(flames.maxParticles).toBeGreaterThanOrEqual(60 * 0.9);
    expect(b.textures.sort()).toEqual(['flame', 'smoke']);
    expect(b.lasts).toBeNull();
    // A flicker is a looping clip on the light that closes on itself.
    const keys = (b.lightClip as any).tracks[0].channels[0].keyframes;
    expect((b.lightClip as any).wrapMode).toBe('loop');
    expect(keys[0].value).toBe(keys[keys.length - 1].value);
    expect(Math.min(...keys.map((k: any) => k.value))).toBeGreaterThanOrEqual(8 * 0.7 - 1e-9);
  });

  it('makes a one-shot of bursts, says how long it lasts, and fades its light', () => {
    const b = buildVfx(boom());
    const sparks = b.children[0]!.components[1]!.data as Record<string, any>;
    expect(sparks.looping).toBe(false);
    expect(sparks.bursts).toEqual([{ time: 0, count: 60 }]);
    expect(sparks.renderMode).toBe(1);
    expect(sparks.collisionEnabled).toBe(true);
    expect(b.lasts).toBeCloseTo(0.2 + 0.05 + 4, 1);
    const clip = b.lightClip as any;
    expect(clip.wrapMode).toBe('once');
    expect(clip.tracks[0].channels[0].keyframes.at(-1).value).toBe(0);
    expect(b.reach).toBeGreaterThan(3);
  });

  it('reads back as the description that builds it', () => {
    for (const spec of [fire(), boom()]) {
      const b = buildVfx(spec);
      const stored: StoredEntity[] = b.children.map((c) => ({ name: c.name, parent: 'root', components: c.components.map((x) => ({ ...x, data: { ...x.data, ...(c.texture ? { texture: `@uuid:${c.texture}` } : {}) } })) }));
      const { spec: back } = describeVfx(stored, spec.unit ?? 1, (ref) => ref.slice(6));
      const again = buildVfx({ ...back, light: back.light ? describeLightClip(back.light, b.lightClip as never) : undefined });
      again.children.forEach((c, i) => expect(c.components).toEqual(b.children[i]!.components));
      expect(back.layers.map((l) => l.texture)).toEqual(spec.layers.map((l) => l.texture));
    }
  });

  it('draws its own textures from recipes the image tools accept', () => {
    for (const name of VFX_TEXTURES) expect(() => validateImageSource(vfxTextureSource(name)), name).not.toThrow();
  });
});
