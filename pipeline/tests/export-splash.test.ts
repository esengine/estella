// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The start screen the exported page carries.
 *
 * It has to be on screen before `game.js` is even fetched, so everything it
 * needs is IN the page — a logo that arrives over the network arrives in the
 * same window the engine does, with nothing left to cover.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportGame } from '../src/export/exportGame';
import { runtimeConfigOf } from '../src/project/runtimeConfig';
import type { ProjectPackaging } from '../src/project/format';
import { writeFakeSdkDist } from './fixtures/fakeSdkDist';
import { OFFICIAL_PACKAGES } from './officialPackagesDir';

let root: string;
const TEX = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const meta = (uuid: string, type: string) => JSON.stringify({ uuid, version: '2.0', type, importer: {} });
/** A one-pixel PNG, so the inlined bytes are a real image rather than a string. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-export-splash-'));
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'hero.png'), PNG);
  writeFileSync(path.join(root, 'assets', 'hero.png.meta'), meta(TEX, 'texture'));
  writeFileSync(path.join(root, 'assets', 'logo.png'), PNG);
  mkdirSync(path.join(root, 'scenes'), { recursive: true });
  writeFileSync(
    path.join(root, 'scenes', 'main.esscene'),
    JSON.stringify({ version: '1.0', name: 'Main', entities: [{ id: 0, components: [{ type: 'Sprite', data: { texture: `@uuid:${TEX}` } }] }] }),
  );
  writeFileSync(path.join(root, 'scenes', 'main.esscene.meta'), meta(SCN, 'scene'));
  writeFakeSdkDist(path.join(root, '_sdk'), {
    'index.js': 'export function initWebRuntime(){return Promise.resolve();}\n',
  });
  mkdirSync(path.join(root, '_wasm'), { recursive: true });
  writeFileSync(path.join(root, '_wasm', 'esengine.js'), 'const M=()=>{};\nexport default M;\n');
  writeFileSync(path.join(root, '_wasm', 'esengine.wasm'), 'wasmbytes');
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

/** Export for web and hand back the page plus whatever the build said about it. */
async function page(splash?: ProjectPackaging['splash']): Promise<{ html: string; warnings: string[] }> {
  const outDir = path.join(root, `dist-${Math.random().toString(36).slice(2)}`);
  const res = await exportGame({
    root,
    entryScene: 'scenes/main.esscene',
    hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
    sdkDistDir: path.join(root, '_sdk'),
    wasmDir: path.join(root, '_wasm'),
    outDir,
    title: 'My Game',
    platform: 'web',
    runtime: runtimeConfigOf({ designResolution: { width: 800, height: 600 } }),
    splash,
  });
  expect(res.ok, res.errors.join('\n')).toBe(true);
  return { html: readFileSync(path.join(outDir, 'index.html'), 'utf8'), warnings: res.warnings };
}

describe('the exported page’s start screen', () => {
  it('is there with nothing configured, showing the game’s name', async () => {
    const { html } = await page();
    expect(html).toContain('id="es-splash"');
    expect(html).toContain('My Game');
    expect(html).not.toContain('class="es-splash-logo"');
  }, 180_000);

  it('carries the logo IN the page, not as a request that races the engine', async () => {
    const { html, warnings } = await page({ logo: 'assets/logo.png' });
    // Nothing REFUSED it. What it costs the page is said separately, below.
    expect(warnings.join('\n')).not.toMatch(/does not exist|not an image/);
    expect(html).toContain('class="es-splash-logo"');
    expect(html).toContain(`src="data:image/png;base64,${PNG.toString('base64')}"`);
    // The path itself must not survive into the page: a start screen that
    // fetches its own logo is the failure this inlining exists to prevent.
    expect(html).not.toContain('assets/logo.png');
  }, 180_000);

  // Inlined, the logo is page bytes: a size report files it under the html and a
  // start screen can take a share of a main-package limit with nothing saying so.
  it('says what the logo costs the page, since the page hides it', async () => {
    const { warnings } = await page({ logo: 'assets/logo.png' });
    const said = warnings.find((w) => w.includes('assets/logo.png'));
    expect(said, 'the inlined logo cost nothing was told about').toBeDefined();
    expect(said).toContain(`${PNG.length} bytes`);
    // …and the base64 tax, which is the part a file listing cannot show.
    expect(said).toMatch(/\b\d+ in the page/);
  }, 180_000);

  it('says so and ships anyway when the logo is not there', async () => {
    const { html, warnings } = await page({ logo: 'assets/missing.png' });
    expect(warnings.join('\n')).toContain('assets/missing.png');
    // Still a start screen, still the game's name — a bad path must not leave
    // the player watching a blank page.
    expect(html).toContain('id="es-splash"');
    expect(html).toContain('My Game');
  }, 180_000);

  it('refuses a file the page could not decode, rather than a broken first screen', async () => {
    const { html, warnings } = await page({ logo: 'assets/hero.tga' });
    expect(warnings.join('\n')).toContain('assets/hero.tga');
    expect(html).not.toContain('class="es-splash-logo"');
  }, 180_000);

  it('holds for as long as the project asked, and paints the colour it asked for', async () => {
    const { html } = await page({ background: '#102030', minMs: 800 });
    expect(html).toContain('data-min-ms="800"');
    expect(html).toContain('#102030');
  }, 180_000);
});
