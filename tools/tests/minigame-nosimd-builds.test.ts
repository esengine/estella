// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every side module a SIMD-refusing mini-game host loads has a build without SIMD, beside the engine built that way.
 *        An export names the build to run when a file is missing (`sideModuleBuildTargets`); a name with no target behind it,
 *        or a target that quietly keeps SIMD, is a package that only fails on the phone.
 */
import { describe, expect, it } from 'vitest';
import config from '../../build-tools/build.config.js';
import { QUICKGAME_MODULE_BUILD_TARGET, WECHAT_MODULE_BUILD_TARGET } from '../../pipeline/src/bundle/sideModuleScan';

const wasm = config.wasm as Record<string, { cmakeFlags: string[]; outputs: Record<string, string> }>;

describe('the mini-game runtime without wasm SIMD', () => {
  it('has the same side modules as the one with it', () => {
    expect(Object.keys(QUICKGAME_MODULE_BUILD_TARGET).sort()).toEqual(Object.keys(WECHAT_MODULE_BUILD_TARGET).sort());
  });

  it.each([...new Set(Object.values(QUICKGAME_MODULE_BUILD_TARGET))].map((t) => [t]))('%s builds without SIMD into wasm/quickgame', (target) => {
    const build = wasm[target];
    expect(build, `no build target ${target}`).toBeTruthy();
    expect(build.cmakeFlags).toContain('-DES_MAIN_DISABLE_SIMD=ON');
    for (const out of Object.values(build.outputs)) expect(out.startsWith('wasm/quickgame/')).toBe(true);
    // The same files the SIMD build makes, so the export reads either directory the same way.
    const twin = wasm[target.replace(/-quickgame$/, '-wechat')];
    expect(Object.values(build.outputs).map((o) => o.replace('wasm/quickgame/', '')).sort())
      .toEqual(Object.values(twin.outputs).map((o) => o.replace('wasm/wechat/', '')).sort());
  });

  it('builds the engine itself without SIMD there too', () => {
    expect(wasm.quickgame.cmakeFlags).toContain('-DES_MAIN_DISABLE_SIMD=ON');
  });
});

describe('the lite engine without wasm SIMD', () => {
  it('is wechat-lite built the way quickgame is, beside it', () => {
    const lite = wasm['quickgame-lite'];
    expect(lite.cmakeFlags).toContain('-DES_MAIN_DISABLE_SIMD=ON');
    for (const flag of wasm['wechat-lite'].cmakeFlags) expect(lite.cmakeFlags).toContain(flag);
    // The export looks for `<engine dir>-lite`, so the directory name is the contract.
    for (const out of Object.values(lite.outputs)) expect(out.startsWith('wasm/quickgame-lite/')).toBe(true);
    // ...and the editor finds it as `<wasm-quickgame>-lite` the same way.
    const sync = (config as unknown as { sync: { wasm: Record<string, string> } }).sync.wasm;
    expect(sync['build/wasm/quickgame-lite']).toBe(`${sync['build/wasm/quickgame']}-lite`);
  });
});
