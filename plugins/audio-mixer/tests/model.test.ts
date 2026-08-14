// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a strip is, before anything is drawn.
 *
 * The mixer shows buses the project never declared — the engine always has
 * master/music/sfx/ui/voice — so "what is on screen" and "what is written down"
 * are different lists, and the merge between them is where a fader would
 * otherwise start at the wrong place.
 */
import { describe, it, expect } from 'vitest';
import { stripsOf, patchBus, freeBusName, defaultEffect, DEFAULT_BUSES } from '../src/model';

describe('the strips a project shows', () => {
  it('shows the engine buses even when the project declares nothing', () => {
    const strips = stripsOf({});
    expect(strips.map((s) => s.name)).toEqual(DEFAULT_BUSES);
    expect(strips.every((s) => s.builtin)).toBe(true);
    // Music is quieter by default, and a fader must open where the engine is.
    expect(strips.find((s) => s.name === 'music')!.volume).toBe(0.8);
  });

  it('lets a declaration override a built-in bus without moving it', () => {
    const strips = stripsOf({ buses: [{ name: 'music', volume: 0.2, muted: true }] });
    expect(strips.map((s) => s.name)).toEqual(DEFAULT_BUSES);
    const music = strips.find((s) => s.name === 'music')!;
    expect([music.volume, music.muted, music.builtin]).toEqual([0.2, true, true]);
  });

  it('appends a custom bus after the built-ins, in declaration order', () => {
    const strips = stripsOf({ buses: [{ name: 'ambience' }, { name: 'radio' }] });
    expect(strips.slice(DEFAULT_BUSES.length).map((s) => s.name)).toEqual(['ambience', 'radio']);
    expect(strips.slice(DEFAULT_BUSES.length).every((s) => s.builtin)).toBe(false);
  });
});

describe('editing one bus', () => {
  it('declares a built-in the first time it is touched', () => {
    // Nothing was written down before: the volume came from the engine.
    expect(patchBus({}, 'sfx', { volume: 0.5 })).toEqual({ buses: [{ name: 'sfx', volume: 0.5 }] });
  });

  it('merges into an existing declaration rather than replacing it', () => {
    const config = { buses: [{ name: 'sfx', volume: 0.5, muted: true }] };
    expect(patchBus(config, 'sfx', { volume: 0.9 })).toEqual({ buses: [{ name: 'sfx', volume: 0.9, muted: true }] });
  });

  it('removes a bus with a null patch, leaving the others in order', () => {
    const config = { buses: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] };
    expect(patchBus(config, 'b', null)).toEqual({ buses: [{ name: 'a' }, { name: 'c' }] });
  });

  it('never edits the config it was handed', () => {
    const config = { buses: [{ name: 'sfx', volume: 0.5 }] };
    patchBus(config, 'sfx', { volume: 0.1 });
    expect(config.buses[0].volume).toBe(0.5);
  });
});

describe('adding a bus', () => {
  it('picks a name nothing is using, including the built-ins', () => {
    expect(freeBusName(stripsOf({}))).toBe('bus');
    expect(freeBusName(stripsOf({ buses: [{ name: 'bus' }, { name: 'bus-1' }] }))).toBe('bus-2');
  });
});

describe('a new effect', () => {
  it('starts audible rather than at zero', () => {
    // An effect added with null values does nothing and reads as broken.
    expect(defaultEffect('filter')).toMatchObject({ type: 'filter', filter: 'lowpass', frequency: 1200 });
    expect(defaultEffect('reverb')).toMatchObject({ type: 'reverb', seconds: 1.5 });
    expect(defaultEffect('compressor')).toMatchObject({ type: 'compressor', ratio: 4 });
  });
});
