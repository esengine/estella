// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A WeChat package's HUD has a second thing to clear.
 *
 * The capsule menu sits INSIDE the safe area: measured on the iPhone 12 the
 * simulator offers, `safeArea.top` is 47 and the capsule's bottom is 76, so a
 * node anchored to the top of the safe area is under the capsule for 29 of its
 * 32 pixels.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { App } from '../src/app/app';
import { safeAreaPlugin, SafeArea } from '../src/ui/layout/safe-area';
import { uiLayoutPlugin } from '../src/ui/layout/layout';
import { ScreenLayout } from '../src/ui/core/screen-layout';
import { UINode } from '../src/ui/core/ui-node';
import type { UINodeData } from '../src/ui/core/ui-node';
import { createMockModule } from './mocks/wasm';
import { setPlatform } from '../src/platform/base';
import { webAdapter } from '../src/platform/web';
import { MiniGamePlatformAdapter } from '../src/platform/minigame/adapter';
import { wechatProfile } from '../src/platform/wechat/profile';

/** The numbers the WeChat simulator reports for an iPhone 12/13. */
const SCREEN = { width: 390, height: 844 };
const SAFE_AREA = { top: 47, bottom: 810, left: 0, right: 390 };
const CAPSULE = { top: 44, bottom: 76, left: 292, right: 380 };

interface FakeWx {
  getSystemInfoSync(): unknown;
  getMenuButtonBoundingClientRect(): unknown;
  onWindowResize(cb: () => void): void;
}

let savedWx: unknown;

function installFakeWx(capsule: typeof CAPSULE | null): void {
  const wx: FakeWx = {
    getSystemInfoSync: () => ({
      safeArea: SAFE_AREA, screenWidth: SCREEN.width, screenHeight: SCREEN.height, pixelRatio: 3,
    }),
    getMenuButtonBoundingClientRect: () => capsule ?? { top: 0, bottom: 0, left: 0, right: 0 },
    onWindowResize: () => {},
  };
  (globalThis as unknown as { wx?: unknown }).wx = wx;
  setPlatform(new MiniGamePlatformAdapter(wechatProfile));
}

beforeEach(() => { savedWx = (globalThis as unknown as { wx?: unknown }).wx; });
afterEach(() => {
  (globalThis as unknown as { wx?: unknown }).wx = savedWx;
  setPlatform(webAdapter);
});

/** One tick with a screen box whose scale is 1, so insets read as CSS pixels. */
async function insetTopOf(avoidHostMenu: boolean): Promise<number> {
  const module = createMockModule();
  const app = App.new();
  app.connectCpp(module.getRegistry(), module);
  app.insertResource(ScreenLayout, {
    ...ScreenLayout._default,
    valid: true, scale: 1,
    left: 0, bottom: 0, right: SCREEN.width, top: SCREEN.height,
    viewportW: SCREEN.width, viewportH: SCREEN.height,
  });
  app.addPlugin(uiLayoutPlugin);
  app.addPlugin(safeAreaPlugin);

  const e = app.world.spawn();
  app.world.insert(e, UINode, { ...UINode._default } as UINodeData);
  app.world.insert(e, SafeArea, {
    applyTop: true, applyBottom: true, applyLeft: true, applyRight: true, avoidHostMenu,
  });
  await app.tick(1 / 60);
  return (app.world.get(e, UINode) as UINodeData).insetTop.value;
}

describe('a node that must clear the host menu', () => {
  it('stops at the safe area when it does not ask to', async () => {
    installFakeWx(CAPSULE);
    expect(await insetTopOf(false)).toBe(SAFE_AREA.top);
  });

  it('clears the capsule when it does', async () => {
    installFakeWx(CAPSULE);
    expect(await insetTopOf(true)).toBe(CAPSULE.bottom);
  });

  it('is the safe area again on a host with no capsule to clear', async () => {
    installFakeWx(null);
    expect(await insetTopOf(true)).toBe(SAFE_AREA.top);
  });
});
