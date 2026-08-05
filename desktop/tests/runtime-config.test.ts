// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  runtimeConfig — the one derivation of "what the game will run with".
 *
 * The play realm and every exported build read this, so what it says a project
 * runs with IS what both do. The cases here are the ones a second, hand-written
 * copy of the list used to get wrong: a mask that never made it out of the
 * editor, and a default that has to stay expressed by ABSENCE or an untouched
 * project ships different bytes.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG, packagedRuntimeFields, runtimeConfigOf,
} from '@/project/runtimeConfig';

describe('runtimeConfigOf', () => {
  it('answers with the engine defaults for a project that declares nothing', () => {
    const rc = runtimeConfigOf({});
    expect(rc.ySortLayers).toBe(0);
    expect(rc.depthLayers).toBe(0);
    expect(rc.colorSpace).toBe('gamma');
    expect(rc.uiTheme).toBe('dark');
    expect(rc.uiThemeColors).toEqual({});
    expect(rc.physicsEnabled).toBe(false);
    expect(rc.audioConfig).toEqual({});
    expect(rc.screenFit.scaleMode).toBe(-1); // fit off
    expect(rc.physicsConfig.gravity).toEqual({ x: 0, y: -9.81 });
    expect(rc).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('turns the sorting-layer lists into the masks the renderer takes', () => {
    const rc = runtimeConfigOf({
      features: { rendering: { ySortLayers: [0, 3], depthLayers: [1, 2] } },
    });
    expect(rc.ySortLayers).toBe(0b1001);
    expect(rc.depthLayers).toBe(0b0110);
  });

  it('drops layer indices no 32-bit mask can carry, rather than wrapping them', () => {
    const rc = runtimeConfigOf({
      features: { rendering: { depthLayers: [-1, 0, 31, 32, 1.5] } },
    });
    // Bit 31 + bit 0, UNSIGNED: the mask crosses to C++ as a u32, so a signed
    // `|` result here would be a different number than the renderer receives.
    expect(rc.depthLayers).toBe(((1 << 31) >>> 0) + 1);
  });

  it('sends the collision matrix only when it actually restricts a pair', () => {
    const open = runtimeConfigOf({ features: { physics: { collisionLayerMasks: [0xffff, 0xffff] } } });
    expect(open.physicsConfig.collisionLayerMasks).toBeUndefined();

    const restricted = runtimeConfigOf({ features: { physics: { collisionLayerMasks: [0xfffe] } } });
    expect(restricted.physicsConfig.collisionLayerMasks?.[0]).toBe(0xfffe);
    expect(restricted.physicsConfig.collisionLayerMasks).toHaveLength(16); // padded to the filter bits
  });

  it('folds the solver defaults in, so the settings page and the game agree', () => {
    const rc = runtimeConfigOf({ features: { physics: { enabled: true, subStepCount: 8 } } });
    expect(rc.physicsEnabled).toBe(true);
    expect(rc.physicsConfig.subStepCount).toBe(8);
    expect(rc.physicsConfig.fixedTimestep).toBeCloseTo(1 / 60, 9);
    expect(rc.physicsConfig.enableSleep).toBe(true);
  });
});

describe('packagedRuntimeFields', () => {
  // Absence IS the default in game.config.json, so an untouched project has to
  // produce an empty object — otherwise every existing build's config changes.
  it('is empty for a project that declared nothing', () => {
    expect(packagedRuntimeFields(runtimeConfigOf({}))).toEqual({});
  });

  it('carries the 2.5D depth mask — the field that used to reach Play and no build', () => {
    const fields = packagedRuntimeFields(runtimeConfigOf({
      features: { rendering: { depthLayers: [1, 2] } },
    }));
    expect(fields.depthLayers).toBe(0b110);
  });

  it('carries every non-default and nothing else', () => {
    const fields = packagedRuntimeFields(runtimeConfigOf({
      designResolution: { width: 800, height: 600 },
      features: {
        rendering: { ySortLayers: [1], depthLayers: [2], colorSpace: 'linear', cameraScaleMode: 'expand' },
        ui: { theme: 'light', colors: { accent: '#ff0000ff' } },
      },
    }));
    expect(Object.keys(fields).sort()).toEqual(
      ['colorSpace', 'depthLayers', 'screenFit', 'uiTheme', 'uiThemeColors', 'ySortLayers'],
    );
    expect(fields.screenFit).toEqual({
      designWidth: 800, designHeight: 600, scaleMode: 2, matchWidthOrHeight: 0.5,
    });
  });

  // The editor's live project state is not a manifest object, but it has the two
  // fields this reads — that structural match is what lets one derivation serve
  // the renderer and the main process.
  it('reads a project state as readily as a parsed manifest', () => {
    const state = { name: 'X', root: '/p', designResolution: { width: 640, height: 480 }, features: {} };
    expect(runtimeConfigOf(state).screenFit.designWidth).toBe(640);
  });
});
