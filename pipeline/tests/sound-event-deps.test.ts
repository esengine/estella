// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, renameSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAssetDatabase } from '../src/assets/assetDb';
import { cookAssets } from '../src/assets/cookAssets';
import { buildAddressableManifest } from '../src/assets/addressableManifest';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw new Error('Unexpected fixture root');
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
});

it('stages the indexed audio candidates of a nested event using their logical paths', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-sound-event-paths-')); roots.push(root);
    const put = (file: string, uuid: string, type: string, data: string) => {
        const absolute = path.join(root, file);
        mkdirSync(path.dirname(absolute), { recursive: true });
        writeFileSync(absolute, data);
        writeFileSync(absolute + '.meta', JSON.stringify({ uuid, type, version: '2.0', importer: {} }));
    };
    put('assets/events/hit.esaudioevent', 'event', 'json', JSON.stringify({ version: 1, clips: [
        { clip: 'impact', weight: 1 }, { clip: '../audio/alt.wav', weight: 0 },
    ], editorNote: './unused.wav' }));
    put('assets/events/impact', 'impact', 'audio', 'audio fixture');
    put('assets/audio/alt.wav', 'alt', 'audio', 'audio fixture');
    put('assets/events/unused.wav', 'unused', 'audio', 'audio fixture');
    put('main.esscene', 'scene', 'scene', JSON.stringify({ version: 4, entities: [{ id: 1, parent: null, children: [],
        components: [{ type: 'SoundEventSource', data: { event: '@uuid:event' } }],
    }] }));
    expect((await scanAssetDatabase(root, { write: false })).index.deps.event).toEqual(['alt', 'impact']);
    const cooked = await cookAssets(root, { entryScenes: ['main.esscene'], outDir: 'build', contentAddressed: true });
    expect(cooked.ok, cooked.warnings.join('\n')).toBe(true);
    expect(cooked.included.slice().sort()).toEqual(['alt', 'event', 'impact', 'scene']);
    const manifest = JSON.parse(readFileSync(cooked.manifestPath!, 'utf8'));
    const staged = manifest.entries.find((row: { uuid: string }) => row.uuid === 'event');
    expect(JSON.parse(readFileSync(path.join(cooked.outDir, staged.path), 'utf8'))).toMatchObject({
        clips: [{ clip: 'assets/events/impact', weight: 1 }, { clip: 'assets/audio/alt.wav', weight: 0 }], editorNote: './unused.wav',
    });
});

it.each(['json', 'sound-event', 'orphan'])('keeps every candidate and moved UUID reference with %s metadata', async meta => {
    const root = mkdtempSync(path.join(tmpdir(), 'estella-sound-event-')); roots.push(root);
    const clips = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const event = '33333333-3333-4333-8333-333333333333';
    for (let i = 0; i < clips.length; ++i) {
        writeFileSync(path.join(root, `${i}.wav`), 'audio fixture');
        writeFileSync(path.join(root, `${i}.wav.meta`), JSON.stringify({ uuid: clips[i], version: '2.0', type: 'audio', importer: {} }));
    }
    writeFileSync(path.join(root, 'steps.esaudioevent'), JSON.stringify({ version: 1, clips: clips.map((uuid, i) => ({ clip: `@uuid:${uuid}`, weight: i })) }));
    if (meta !== 'orphan') writeFileSync(path.join(root, 'steps.esaudioevent.meta'), JSON.stringify({ uuid: event, version: '2.0', type: meta, importer: {} }));
    const first = await scanAssetDatabase(root, { write: false });
    const registered = JSON.parse(readFileSync(path.join(root, 'steps.esaudioevent.meta'), 'utf8'));
    expect(registered.type).toBe(meta === 'json' ? 'json' : 'sound-event');
    expect(first.index.deps[registered.uuid]).toEqual(clips);
    renameSync(path.join(root, '0.wav'), path.join(root, 'renamed.wav'));
    renameSync(path.join(root, '0.wav.meta'), path.join(root, 'renamed.wav.meta'));
    const scene = '44444444-4444-4444-8444-444444444444';
    writeFileSync(path.join(root, 'main.esscene'), JSON.stringify({ version: '1.0', name: 'Sound source', entities: [
        { id: 1, name: 'Step', parent: null, children: [], components: [
            { type: 'SoundEventSource', data: { event: `@uuid:${registered.uuid}`, seed: 42 } },
        ] },
    ] }));
    writeFileSync(path.join(root, 'main.esscene.meta'), JSON.stringify({ uuid: scene, version: '2.0', type: 'scene', importer: {} }));
    const second = await scanAssetDatabase(root, { write: false });
    expect(second.index.deps[registered.uuid]).toEqual(clips);
    expect(second.index.deps[scene]).toEqual([registered.uuid]);
    expect(second.index.entries.find(entry => entry.uuid === clips[0])?.path).toBe('renamed.wav');
    const cooked = await cookAssets(root, { entryScenes: ['main.esscene'], outDir: 'build', contentAddressed: true });
    expect(cooked.failed).toEqual([]);
    expect(cooked.included.sort()).toEqual([scene, registered.uuid, ...clips].sort());
    expect(cooked.warnings.filter(warning => /does not carry/.test(warning))).toEqual([]);
    const manifest = JSON.parse(await buildAddressableManifest(cooked.outDir));
    const entries = Object.values(manifest.groups).flatMap(group => Object.entries((group as { assets: Record<string, unknown> }).assets));
    expect(entries.find(([uuid]) => uuid === registered.uuid)?.[1]).toMatchObject({ type: registered.type });
});
