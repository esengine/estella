/**
 * @file  AssetDatabase scanner (REARCH_ASSETS.md A2). A pure-node step: walk a
 *        project's `.meta` sidecars into a uuid↔path registry + a dependency
 *        graph (which scene/prefab references which asset), written to
 *        `.esengine/cache/assets.json`. Skips code/build/vcs dirs; reads the
 *        `type` each `.meta` already declares (no extension table).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase, type AssetIndex } from '../electron/assetDb';

let root: string;

const TEX_UUID = '11111111-1111-4111-8111-111111111111';
const FONT_UUID = '22222222-2222-4222-8222-222222222222';
const SCENE_UUID = '33333333-3333-4333-8333-333333333333';

function writeAsset(rel: string, type: string, uuid: string, body = ''): void {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  writeFileSync(`${abs}.meta`, JSON.stringify({ uuid, version: '2.0', type, importer: {} }));
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'estella-assetdb-'));
  // Two leaf assets + a scene that references them by @uuid:.
  writeAsset('assets/textures/player.png', 'texture', TEX_UUID, 'PNGDATA');
  writeAsset('assets/fonts/ui.fnt', 'font', FONT_UUID, 'FNTDATA');
  writeAsset(
    'assets/scenes/main.esscene',
    'scene',
    SCENE_UUID,
    JSON.stringify({
      version: '1.0',
      name: 'main',
      entities: [
        {
          id: 1,
          name: 'Hero',
          parent: null,
          children: [],
          components: [
            { type: 'Sprite', data: { texture: `@uuid:${TEX_UUID}` } },
            { type: 'BitmapText', data: { font: `@uuid:${FONT_UUID}` } },
          ],
        },
      ],
    }),
  );
  // A code dir that must be SKIPPED even though it contains a stray .meta.
  const nm = path.join(root, 'node_modules', 'pkg');
  mkdirSync(nm, { recursive: true });
  writeFileSync(path.join(nm, 'thing.png.meta'), JSON.stringify({ uuid: 'deadbeef', type: 'texture' }));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('scanAssetDatabase (A2)', () => {
  it('indexes every .meta into uuid↔path entries and writes assets.json', async () => {
    const res = await scanAssetDatabase(root);
    expect(res.ok).toBe(true);
    expect(res.outputPath).toBe(path.join(root, '.esengine/cache/assets.json'));
    expect(existsSync(res.outputPath!)).toBe(true);

    const byUuid = Object.fromEntries(res.index.entries.map((e) => [e.uuid, e]));
    expect(byUuid[TEX_UUID].path).toBe('assets/textures/player.png');
    expect(byUuid[TEX_UUID].type).toBe('texture');
    expect(byUuid[FONT_UUID].path).toBe('assets/fonts/ui.fnt');
    expect(byUuid[SCENE_UUID].type).toBe('scene');

    // The written artifact matches the returned index.
    const onDisk = JSON.parse(readFileSync(res.outputPath!, 'utf8')) as AssetIndex;
    expect(onDisk.entries.length).toBe(res.index.entries.length);
  });

  it('builds a dependency graph: the scene depends on the assets it references', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.deps[SCENE_UUID]).toEqual([FONT_UUID, TEX_UUID].sort());
    // Leaf assets have no deps.
    expect(index.deps[TEX_UUID]).toBeUndefined();
  });

  it('skips node_modules / build / vcs dirs', async () => {
    const { index } = await scanAssetDatabase(root, { write: false });
    expect(index.entries.some((e) => e.path.includes('node_modules'))).toBe(false);
    expect(index.entries.length).toBe(3); // texture + font + scene, nothing from node_modules
  });
});
