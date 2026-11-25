// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Layer } from 'ag-psd';
import { PNG } from 'pngjs';
import { expandEntry, PREFAB_FORMAT_VERSION, type PrefabData } from 'esengine';
import { expect, it, onTestFinished } from 'vitest';
import { importSourceFile } from '../src/assets/importSourceFile';
import { scanAssetDatabase } from '../src/assets/assetDb';
import { photoshopFile, pixelLayer as layer } from './fixtures/photoshopLayers';

const spriteOf = (prefab: PrefabData, name: string) => prefab.entities.find(e => e.name === name)!.components.find(c => c.type === 'Sprite')!.data;

async function fixture() {
    const base = await realpath(tmpdir()), root = await mkdtemp(path.join(base, 'estella-psd-identity-'));
    onTestFinished(async () => { if (path.dirname(root) === base) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); });
    const dir = path.join(root, 'assets');
    await mkdir(dir);
    const file = (name: string) => path.join(dir, name);
    const read = (name: string) => readFile(file(name), 'utf8').then(s => JSON.parse(s));
    const write = (name: string, data: unknown) => writeFile(file(name), JSON.stringify(data));
    const source = (children: Layer[]) => writeFile(file('Card.psd'), photoshopFile(children));
    const run = (beforeWrite?: (rel: string) => void) => importSourceFile({ root, destDir: 'assets', absSource: file('Card.psd'), beforeWrite });
    const prefab = (): Promise<PrefabData> => read('Card.esprefab');
    return { root, file, read, write, source, run, prefab };
}

it('keeps native layers, PNGs and a placed override through rename, reorder, removal, an empty stack and restoration', async () => {
    const f = await fixture();
    await f.source([layer('Ink', 7, 10), layer('Light', 44, 20)]);
    await f.run();
    const first = await f.prefab(), light = first.entities.find(e => e.name === 'Light')!.prefabEntityId;
    const original = await f.read('Card_Light.png.meta'), ink = await f.read('Card_Ink.png.meta');
    await f.write('Card_Light.png.meta', { ...original, labels: ['keep'], importer: { ...original.importer, filterMode: 'nearest' } });
    await f.write('Card_Ink.png.meta', { ...ink, labels: ['standalone'] });
    const prefabUuid = (await f.read('Card.esprefab.meta')).uuid;
    const entry = { id: 10, parent: null, prefab: 'assets/Card.esprefab', added: [], removed: [], overrides: [
        { prefabEntityId: light, type: 'name' as const, value: 'Selected' },
    ] };
    await f.source([{ name: 'Fx', id: 130, children: [layer('Glow', 88, 20)] }, layer('Light', 99, 30)]);
    expect((await f.run())?.warnings.join(' ')).toContain('Card_Ink.png');
    const changed = await f.prefab();
    const kept = changed.entities.find(e => e.prefabEntityId === light)!;
    expect(kept.name).toBe('Glow');
    expect(kept.parent).toBe(changed.entities.find(e => e.name === 'Fx')!.prefabEntityId);
    expect(spriteOf(changed, 'Glow').texture).toBe('assets/Card_Light.png');
    expect(spriteOf(changed, 'Light').texture).toBe('assets/Card_Light-2.png');
    let next = 40;
    const placed = expandEntry(changed, entry, () => next++);
    expect(placed.unresolved).toHaveLength(0);
    expect(placed.entities.find(e => e.name === 'Selected')?.prefabEntityId).toBe(light);
    const removedOverride = { prefabEntityId: first.entities.find(e => e.name === 'Ink')!.prefabEntityId, type: 'name' as const, value: 'Ink only' };
    const stale = expandEntry(changed, { ...entry, overrides: [removedOverride] }, () => next++);
    expect(stale.unresolved).toEqual([removedOverride]);
    expect(stale.entities.some(e => e.name === 'Ink only')).toBe(false);
    expect(await f.read('Card_Light.png.meta')).toMatchObject({ uuid: original.uuid, labels: ['keep'], importer: { filterMode: 'nearest' } });
    expect(PNG.sync.read(await readFile(f.file('Card_Light.png'))).data[0]).toBe(88);
    expect((await f.read('Card_Ink.png.meta')).source).toBeUndefined();
    expect(await f.read('Card_Ink.png.meta')).toMatchObject({ uuid: ink.uuid, labels: ['standalone'] });
    const { index } = await scanAssetDatabase(f.root);
    expect(index.entries.find(e => e.uuid === ink.uuid)?.path).toBe('assets/Card_Ink.png');
    expect(index.entries.filter(e => e.source === ink.source).map(e => e.path).sort())
        .toEqual(['assets/Card.esprefab', 'assets/Card_Light-2.png', 'assets/Card_Light.png']);
    await f.source([]);
    await f.run();
    expect((await f.prefab()).entities.map(e => e.name)).toEqual(['Card']);
    expect((await f.read('Card.esprefab.meta')).uuid).toBe(prefabUuid);
    await f.source([layer('Sun', 111, 20)]);
    await f.run();
    expect(spriteOf(await f.prefab(), 'Sun').texture).toBe('assets/Card_Light.png');
    expect((await f.read('Card_Light.png.meta')).uuid).toBe(original.uuid);
    const before = (await stat(f.file('Card.esprefab.meta'))).mtimeMs;
    await f.run();
    expect((await stat(f.file('Card.esprefab.meta'))).mtimeMs).toBe(before);
});

it('upgrades an older ordinal prefab by names and pixels, even if the first new import already removed a duplicate', async () => {
    const f = await fixture();
    const dotUuid = randomUUID(), lineUuid = randomUUID();
    const old = (n: number, name: string, texture: string) => ({
        prefabEntityId: 'l' + n, name, parent: null, children: [], visible: true,
        components: [{ type: 'Transform', data: {} }, { type: 'Sprite', data: { texture } }],
    });
    await f.write('Card.esprefab', { version: PREFAB_FORMAT_VERSION, name: 'Card', rootEntityId: 'root', entities: [
        { prefabEntityId: 'root', name: 'Card', parent: null, children: ['l0', 'l1', 'l2'], components: [] },
        old(0, 'Dot', 'assets/Card_Dot.png'), old(1, 'Dot', '@uuid:' + dotUuid), old(2, 'Line', lineUuid),
    ] });
    await f.write('Card_Dot-2.png.meta', { uuid: dotUuid, type: 'texture' });
    await f.write('Card_Line.png.meta', { uuid: lineUuid, type: 'texture' });
    for (const [file, red] of [['Card_Dot.png', 4], ['Card_Dot-2.png', 77], ['Card_Line.png', 13]] as const) {
        const image = new PNG({ width: 1, height: 1 });
        image.data.set([red, 0, 0, 255]);
        await writeFile(f.file(file), PNG.sync.write(image));
    }
    await f.source([layer('Line', 29, 3), layer('Dot', 77, 2)]);
    await f.run();
    const upgraded = await f.prefab();
    expect(upgraded.entities.map(e => [e.name, e.prefabEntityId])).toEqual([['Card', 'root'], ['Line', 'l2'], ['Dot', 'l1']]);
    expect(spriteOf(upgraded, 'Dot').texture).toBe('assets/Card_Dot-2.png');
    expect((await f.read('Card_Dot-2.png.meta')).uuid).toBe(dotUuid);
    expect(PNG.sync.read(await readFile(f.file('Card_Dot.png'))).data[0]).toBe(4);
    await f.source([layer('Renamed', 12, 2)]);
    await f.run();
    expect((await f.prefab()).entities[1]!.prefabEntityId).toBe('l1');
    expect(spriteOf(await f.prefab(), 'Renamed').texture).toBe('assets/Card_Dot-2.png');
});

it('keeps ID-less duplicate layers by pixels and refuses to redirect ambiguous overrides', async () => {
    const f = await fixture();
    await f.source([layer('Dot', 10), layer('Dot', 20)]);
    await f.run();
    const initial = (await f.prefab()).entities.slice(1).map(e => e.prefabEntityId);
    await f.source([layer('Dot', 20), layer('Dot', 10)]);
    await f.run();
    expect((await f.prefab()).entities.slice(1).map(e => e.prefabEntityId)).toEqual([...initial].reverse());
    await f.source([layer('Dot', 30), layer('Dot', 30)]);
    expect((await f.run())?.warnings.join(' ')).toMatch(/ambiguous/i);
    const added = (await f.prefab()).entities.slice(1).map(e => e.prefabEntityId);
    expect(added.every(id => !initial.includes(id))).toBe(true);
    await f.run();
    expect((await f.prefab()).entities.slice(1).map(e => e.prefabEntityId)).toEqual(added);
});

it('keeps independent images, retries reserved names after an interruption, and preserves the last published prefab on bad input', async () => {
    const f = await fixture();
    await writeFile(f.file('Card_Ink.png'), 'artist file');
    await f.source([layer('Ink', 3, 8), layer('Fx', 80, 9)]);
    await expect(f.run(rel => { if (rel === 'assets/Card_Fx.png') throw new Error('interrupted'); })).rejects.toThrow('interrupted');
    await f.run();
    expect(spriteOf(await f.prefab(), 'Ink').texture).toBe('assets/Card_Ink-2.png');
    expect(await readFile(f.file('Card_Ink.png'), 'utf8')).toBe('artist file');
    const before = await readFile(f.file('Card.esprefab'));
    const meta = await f.read('Card_Fx.png.meta');
    await writeFile(f.file('Card.psd'), 'incomplete PSD');
    await expect(f.run()).rejects.toThrow();
    expect(await readFile(f.file('Card.esprefab'))).toEqual(before);
    expect(await f.read('Card_Fx.png.meta')).toEqual(meta);
    await f.write('Card_Fx.png.meta', { ...meta, uuid: 'someone-elses-asset' });
    await f.source([layer('Fx', 61, 9)]);
    expect((await f.run())?.warnings.join(' ')).toContain('another asset');
    expect(spriteOf(await f.prefab(), 'Fx').texture).toBe('assets/Card_Fx-2.png');
    expect(PNG.sync.read(await readFile(f.file('Card_Fx.png'))).data[0]).toBe(80);
    expect((await f.read('Card_Fx.png.meta')).source).toBeUndefined();
    const otherSource = { ...await f.read('Card_Fx-2.png.meta'), source: randomUUID() };
    await f.write('Card_Fx-2.png.meta', otherSource);
    await f.run();
    expect(spriteOf(await f.prefab(), 'Fx').texture).toBe('assets/Card_Fx-3.png');
    expect(await f.read('Card_Fx-2.png.meta')).toEqual(otherSource);
});

it('keeps an authored prefab that shares the source basename and old-looking entity IDs', async () => {
    const f = await fixture();
    const authored = { name: 'Card', rootEntityId: 'root', entities: [
        { prefabEntityId: 'root', name: 'Card', parent: null, children: ['l0'], components: [] },
        { prefabEntityId: 'l0', name: 'Ink', parent: 'root', children: [], components: [
            { type: 'Sprite', data: { texture: 'assets/Card_Ink.png' } }, { type: 'Health', data: { max: 37 } },
        ] },
    ] };
    await f.write('Card.esprefab', authored);
    await writeFile(f.file('Card_Ink.png'), 'painted separately');
    await f.source([layer('Ink', 32, 20)]);
    await expect(f.run()).rejects.toThrow(/authored/);
    expect(await f.read('Card.esprefab')).toEqual(authored);
    expect(await readFile(f.file('Card_Ink.png'), 'utf8')).toBe('painted separately');
});
