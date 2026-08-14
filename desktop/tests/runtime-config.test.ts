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
} from '../../pipeline/src/project/runtimeConfig';

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
  // Absence IS the default in game.config.json, so an untouched project carries
  // nothing it did not declare.
  it('carries only the design resolution for a project that declared nothing', () => {
    // Not a setting a project opts into: every project HAS a design resolution,
    // and a desktop window opens at it. Everything else stays absent so a build
    // with default settings keeps the config it has always had.
    expect(packagedRuntimeFields(runtimeConfigOf({}))).toEqual({
      screenFit: { designWidth: 1920, designHeight: 1080, scaleMode: -1, matchWidthOrHeight: 0.5 },
    });
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

  // The design resolution is what a desktop window opens at, and a window has a
  // size whether or not the camera scales to it — so it ships even with the fit
  // off, which is the case every project starts in.
  it('carries the design resolution even when the camera fit is off', () => {
    const fields = packagedRuntimeFields(runtimeConfigOf({
      designResolution: { width: 1080, height: 1920 },
    }));
    expect(fields.screenFit).toEqual({
      designWidth: 1080, designHeight: 1920, scaleMode: -1, matchWidthOrHeight: 0.5,
    });
  });

  // Physics and the mixer used to reach Play and no shipped build at all, so a
  // game verified in Play could ship with different gravity and a silent mixer.
  it('carries physics and the mixer, which used to reach Play and no build', () => {
    const fields = packagedRuntimeFields(runtimeConfigOf({
      features: {
        physics: { enabled: true, gravity: { x: 0, y: -20 }, collisionLayerMasks: [0xfffe] },
        audio: { buses: [{ name: 'sfx', volume: 0.5 }] },
      },
    }));
    expect(fields.physicsEnabled).toBe(true);
    expect(fields.physicsConfig?.gravity).toEqual({ x: 0, y: -20 });
    expect(fields.physicsConfig?.collisionLayerMasks?.[0]).toBe(0xfffe);
    expect(fields.audioConfig?.buses?.[0]).toEqual({ name: 'sfx', volume: 0.5 });
  });

  // ...but only when declared: a default world would otherwise be spelled out in
  // every existing build's config, and a runtime falls back to the same values.
  it('omits a physics world and a mixer that are just the defaults', () => {
    const declaredButDefault = packagedRuntimeFields(runtimeConfigOf({
      features: { physics: { gravity: { x: 0, y: -9.81 } }, audio: {} },
    }));
    expect(declaredButDefault.physicsConfig).toBeUndefined();
    expect(declaredButDefault.audioConfig).toBeUndefined();
    expect(declaredButDefault.physicsEnabled).toBeUndefined();
  });

  // The editor's live project state is not a manifest object, but it has the two
  // fields this reads — that structural match is what lets one derivation serve
  // the renderer and the main process.
  it('reads a project state as readily as a parsed manifest', () => {
    const state = { name: 'X', root: '/p', designResolution: { width: 640, height: 480 }, features: {} };
    expect(runtimeConfigOf(state).screenFit.designWidth).toBe(640);
  });
});
