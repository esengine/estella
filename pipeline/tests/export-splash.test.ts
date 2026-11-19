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
import { createHash } from 'node:crypto';
import { exportGame, splashScriptCspHash } from '../src/export/exportGame';
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
async function page(splash?: ProjectPackaging['splash'], webChannel?: 'poki' | 'crazygames' | 'youtube', leaderboardEncryptionKey?: string, extra: Record<string, unknown> = {}): Promise<{ html: string; config: Record<string, unknown>; warnings: string[]; splashBytes?: number }> {
  const outDir = path.join(root, `dist-${Math.random().toString(36).slice(2)}`);
  const res = await exportGame({
    root,
    entryScene: 'scenes/main.esscene',
    hostsDir: path.resolve(__dirname, '../src/runtime'), packagesDir: OFFICIAL_PACKAGES,
    sdkDistDir: path.join(root, '_sdk'),
    wasmDir: path.join(root, '_wasm'),
    outDir,
    title: 'My Game',
    platform: 'web', webChannel, leaderboardEncryptionKey,
    runtime: runtimeConfigOf({ designResolution: { width: 800, height: 600 } }),
    splash,
    ...extra,
  });
  expect(res.ok, res.errors.join('\n')).toBe(true);
  return { html: readFileSync(path.join(outDir, 'index.html'), 'utf8'), config: JSON.parse(readFileSync(path.join(outDir, 'game.config.json'), 'utf8')), warnings: res.warnings, splashBytes: res.size?.splashBytes };
}

describe('the exported page’s start screen', () => {
  it('shows loading and nothing more in a development preview: no logo, no minimum time', async () => {
    const authored = { logo: 'assets/logo.png', minMs: 3000 };
    const shipped = await page(authored);
    expect(shipped.html).toContain('class="es-splash-logo"');
    expect(shipped.html).toContain('data-min-ms="3000"');
    const preview = await page(authored, undefined, undefined, { developmentPreview: true });
    expect(preview.html).toContain('id="es-splash-bar"');
    expect(preview.html).not.toContain('class="es-splash-logo"');
    expect(preview.html).not.toContain('data-min-ms');
    expect(preview.html).not.toContain('data-ident-ms');
  }, 180_000);

  it('asks to be turned only on a touch screen, so a desktop browser always shows the game', async () => {
    const { html } = await page(undefined, undefined, undefined, { orientation: 'portrait' });
    expect(html).toContain('id="rotate-hint"');
    expect(html).toContain('@media (orientation:landscape) and (pointer:coarse){#canvas{display:none');
    expect(html).not.toContain('@media (orientation:landscape){');
  }, 180_000);

  it('has its own line in the size report, logo included', async () => {
    const plain = await page();
    const withLogo = await page({ logo: 'assets/logo.png' });
    expect(plain.splashBytes).toBeGreaterThan(0);
    expect(plain.html.length).toBeGreaterThan(plain.splashBytes!);
    expect(withLogo.splashBytes! - plain.splashBytes!).toBeGreaterThanOrEqual(Math.floor(PNG.length * 4 / 3));
  }, 180_000);

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

  it('holds for the engine’s ident, or longer if the project asked, and paints the colour it asked for', async () => {
    const { html } = await page({ background: '#102030', minMs: 800 });
    expect(html).toContain('data-min-ms="800"');
    expect(html).toContain('data-ident-ms="2800"');
    expect(html).toContain('#102030');
    expect((await page({ minMs: 5200 })).html).toContain('data-min-ms="5200"');
  }, 180_000);

  it('lists the ident’s script in the page’s policy, so the browser runs it', async () => {
    const { html } = await page();
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1];
    expect(html).toContain('<canvas id="es-splash-gl"');
    expect(policy).toContain(`'${splashScriptCspHash()}'`);
    const carried = /<script>(\(function\(\)\{var c=document\.getElementById\('es-splash-gl'\)[\s\S]*?)<\/script>/.exec(html)![1];
    expect(`sha256-${createHash('sha256').update(carried).digest('base64')}`).toBe(splashScriptCspHash());
    expect(policy).toContain("worker-src 'self' blob:");
  }, 180_000);

  it('opens a portal’s page on the ident too, under the portal’s own policy', async () => {
    for (const channel of ['poki', 'crazygames', 'youtube'] as const) {
      const { html } = await page(undefined, channel);
      const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1];
      expect(html).toContain('<canvas id="es-splash-gl"');
      expect(html).toContain('data-ident-ms="2800"');
      expect(policy).toContain(`'${splashScriptCspHash()}'`);
      expect(policy).toContain("worker-src 'self' blob:");
    }
  }, 180_000);

  it('leaves the ident out of a project that turned it off', async () => {
    const { html } = await page({ ident: false });
    const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1];
    expect(html).not.toMatch(/es-splash-gl|es-splash-marked|data-ident-ms/);
    expect(html).toContain('<div class="es-splash-title">My Game</div>');
    expect(policy).not.toContain(`'${splashScriptCspHash()}'`);
  }, 180_000);
});


describe('Poki host page', () => {
  it('loads YouTube SDK before game code and carries its fixed channel marker', async () => {
    const { html, config, warnings } = await page(undefined, 'youtube');
    const script = '<script src="https://www.youtube.com/game_api/v1"></script>';
    expect(html.indexOf(script)).toBeGreaterThan(html.indexOf('<head>'));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('src="./game.js"'));
    expect(html).toContain('data-web-channel="youtube"'); expect(config.webChannel).toBe('youtube');
    expect(html).not.toContain('crazygames-sdk'); expect(html).not.toContain('poki-sdk');
    expect(warnings.some(warning => warning.includes('static bundle checks do not measure'))).toBe(true);
  });
  it('packages the client leaderboard key only for CrazyGames', async () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    expect((await page(undefined, 'crazygames', key)).config.leaderboardEncryptionKey).toBe(key);
    expect((await page(undefined, 'poki', key)).config.leaderboardEncryptionKey).toBeUndefined();
    expect((await page(undefined, undefined, key)).config.leaderboardEncryptionKey).toBeUndefined();
  });
  it('loads CrazyGames v3 before the game without injecting Poki', async () => {
    const { html } = await page(undefined, 'crazygames');
    const script = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>';
    expect(html.indexOf(script)).toBeGreaterThan(html.indexOf('<head>'));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('src="./game.js"'));
    expect(html).toContain('data-web-channel="crazygames"');
    expect(html).toContain('frame-src https:');
    expect(html).not.toContain('poki-sdk');
  });
  it('loads the official SDK in the head before the game, with its channel policy', async () => {
    const { html } = await page(undefined, 'poki');
    const script = '<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>';
    expect(html.indexOf(script)).toBeGreaterThan(html.indexOf('<head>'));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('</head>'));
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('src="./game.js"'));
    expect(html).toContain('data-web-channel="poki"');
    expect(html).toContain('frame-src https:');
    expect(html).toContain("script-src 'self' 'unsafe-eval' blob: https:");
  });
  it('keeps standalone exports free of SDK injection and broad HTTPS policy', async () => {
    const { html } = await page();
    expect(html).toContain('data-web-channel="standalone"');
    expect(html).not.toContain('poki-sdk');
    expect(html).not.toContain('crazygames-sdk');
    expect(html).not.toContain('frame-src https:');
    expect(html).toContain("default-src 'self';");
  });
});
