// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Cook-time video: mp4 → `.esv` (MPEG-1 PS for the wasm decoder) + `.m4a`
 * audio-track sibling, through the real bundled ffmpeg. Sources are generated
 * at test time with the same binary (lavfi), so no binary fixtures ship.
 * When the videodec wasm is built locally, the cooked `.esv` is decoded
 * end-to-end and its frames asserted.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveFfmpeg, transcodeVideoForWasm, videoImportSettings } from '../electron/videoCook';
import { cookAssets } from '../electron/cookAssets';

const execFileAsync = promisify(execFile);

const WASM_DIR = path.resolve(__dirname, '../../build/wasm/web');
const HAS_VIDEODEC = existsSync(path.join(WASM_DIR, 'videodec.wasm'));

const ffmpeg = await resolveFfmpeg();
let tmp = '';

beforeAll(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'estella-videocook-test-'));
});

/** Generate a source clip: solid lime video, optional 440Hz tone, ODD width. */
async function makeSource(name: string, withAudio: boolean): Promise<string> {
    const out = path.join(tmp, name);
    const args = ['-y', '-f', 'lavfi', '-i', 'color=c=lime:s=63x32:r=25:d=1'];
    if (withAudio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-shortest');
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', out);
    await execFileAsync(ffmpeg!, args);
    return out;
}

describe('videoImportSettings', () => {
    it('defaults and clamps', () => {
        expect(videoImportSettings(undefined)).toEqual({ quality: 4, audioBitrateKbps: 128 });
        expect(videoImportSettings({ quality: 8, audioBitrateKbps: 192 })).toEqual({ quality: 8, audioBitrateKbps: 192 });
        expect(videoImportSettings({ quality: 99, audioBitrateKbps: 7 })).toEqual({ quality: 4, audioBitrateKbps: 128 });
    });
});

describe.skipIf(!ffmpeg)('transcodeVideoForWasm', () => {
    it('produces an MPEG-PS .esv and an .m4a audio track', async () => {
        const src = await makeSource('with-audio.mp4', true);
        const res = await transcodeVideoForWasm(src, videoImportSettings(undefined));
        expect(res.warnings).toEqual([]);
        expect(res.esv).not.toBeNull();
        // MPEG-PS pack header: 00 00 01 BA.
        expect(Array.from(res.esv!.subarray(0, 4))).toEqual([0, 0, 1, 0xba]);
        expect(res.audio).not.toBeNull();
        // MP4/M4A container: 'ftyp' at offset 4.
        expect(Buffer.from(res.audio!.subarray(4, 8)).toString('ascii')).toBe('ftyp');
    });

    it('a silent source yields esv with no audio sibling and no warnings', async () => {
        const src = await makeSource('silent.mp4', false);
        const res = await transcodeVideoForWasm(src, videoImportSettings(undefined));
        expect(res.warnings).toEqual([]);
        expect(res.esv).not.toBeNull();
        expect(res.audio).toBeNull();
    });

    it('reports failure for an undecodable source', async () => {
        const bogus = path.join(tmp, 'bogus.mp4');
        const fs = await import('node:fs/promises');
        await fs.writeFile(bogus, Buffer.alloc(256, 0x42));
        const res = await transcodeVideoForWasm(bogus, videoImportSettings(undefined));
        expect(res.esv).toBeNull();
        expect(res.warnings.length).toBeGreaterThan(0);
    });

    it.skipIf(!HAS_VIDEODEC)('cooked .esv decodes in the real videodec module with evened dimensions', async () => {
        const src = await makeSource('roundtrip.mp4', false);
        const res = await transcodeVideoForWasm(src, videoImportSettings(undefined));
        expect(res.esv).not.toBeNull();

        const factory = (await import(path.join(WASM_DIR, 'videodec.js'))).default;
        const mod = await factory({ wasmBinary: readFileSync(path.join(WASM_DIR, 'videodec.wasm')) });
        const ptr = mod._malloc(res.esv!.length);
        mod.HEAPU8.set(res.esv!, ptr);
        const h = mod._es_video_open(ptr, res.esv!.length);
        expect(h).toBeGreaterThan(0);
        // The odd 63px source width is evened for MPEG-1 macroblocks.
        expect(mod._es_video_width(h)).toBe(62);
        expect(mod._es_video_height(h)).toBe(32);

        expect(mod._es_video_advance(h, 0.05)).toBe(1);
        const out = mod._malloc(62 * 32 * 4);
        expect(mod._es_video_frame_rgba(h, out, 62 * 32 * 4)).toBe(1);
        const px = out + ((16 * 62) + 31) * 4;
        const [r, g, b, a] = Array.from(mod.HEAPU8.subarray(px, px + 4)) as number[];
        expect(g).toBeGreaterThan(200);
        expect(r).toBeLessThan(60);
        expect(b).toBeLessThan(60);
        expect(a).toBe(255);
        mod._free(out);
        mod._es_video_close(h);
    });
});

describe.skipIf(!ffmpeg)('cookAssets video wiring', () => {
    const VIDEO_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const SCENE_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

    async function makeProject(): Promise<string> {
        const fs = await import('node:fs');
        const root = await mkdtemp(path.join(tmpdir(), 'estella-videowire-'));
        const write = (rel: string, body: string | Uint8Array, meta: object) => {
            const abs = path.join(root, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, body);
            fs.writeFileSync(`${abs}.meta`, JSON.stringify({ version: '2.0', importer: {}, ...meta }));
        };
        const clip = readFileSync(await makeSource('wire-src.mp4', true));
        write('assets/videos/clip.mp4', clip, { uuid: VIDEO_UUID, type: 'video' });
        write('assets/scenes/main.esscene', JSON.stringify({
            version: '1.0', name: 'v',
            entities: [{ id: 1, name: 'V', parent: null, children: [], components: [
                { type: 'Sprite', data: { texture: 0 } },
                { type: 'Video', data: { source: `@uuid:${VIDEO_UUID}` } },
            ] }],
        }), { uuid: SCENE_UUID, type: 'scene' });
        return root;
    }

    it('transcodeVideo stages .esv plus the .m4a sibling, both in the manifest', async () => {
        const root = await makeProject();
        const res = await cookAssets(root, {
            entryScenes: ['assets/scenes/main.esscene'], outDir: 'build', transcodeVideo: true,
        });
        expect(res.warnings).toEqual([]);
        const manifest = JSON.parse(readFileSync(path.join(root, 'build/assets.manifest.json'), 'utf8'));
        const video = manifest.entries.find((e: { uuid: string }) => e.uuid === VIDEO_UUID);
        expect(video.path).toBe('assets/videos/clip.esv');
        expect(video.sourcePath).toBe('assets/videos/clip.mp4');
        const audio = manifest.entries.find((e: { uuid: string }) => e.uuid === `${VIDEO_UUID}-audio`);
        expect(audio.path).toBe('assets/videos/clip.esv.m4a');
        expect(audio.type).toBe('audio');
        expect(existsSync(path.join(root, 'build/assets/videos/clip.esv'))).toBe(true);
        expect(existsSync(path.join(root, 'build/assets/videos/clip.esv.m4a'))).toBe(true);
    });

    it('without transcodeVideo the mp4 passes through untouched', async () => {
        const root = await makeProject();
        await cookAssets(root, { entryScenes: ['assets/scenes/main.esscene'], outDir: 'build' });
        const manifest = JSON.parse(readFileSync(path.join(root, 'build/assets.manifest.json'), 'utf8'));
        const video = manifest.entries.find((e: { uuid: string }) => e.uuid === VIDEO_UUID);
        expect(video.path).toBe('assets/videos/clip.mp4');
        expect(manifest.entries.find((e: { uuid: string }) => e.uuid === `${VIDEO_UUID}-audio`)).toBeUndefined();
    });

    it('content-addressed staging names the audio sibling by ITS OWN hash', async () => {
        const root = await makeProject();
        await cookAssets(root, {
            entryScenes: ['assets/scenes/main.esscene'], outDir: 'build',
            transcodeVideo: true, contentAddressed: true,
        });
        const manifest = JSON.parse(readFileSync(path.join(root, 'build/assets.manifest.json'), 'utf8'));
        const video = manifest.entries.find((e: { uuid: string }) => e.uuid === VIDEO_UUID);
        const audio = manifest.entries.find((e: { uuid: string }) => e.uuid === `${VIDEO_UUID}-audio`);
        expect(video.path).toMatch(/^assets\/[0-9a-f]{16}\.esv$/);
        expect(audio.path).toMatch(/^assets\/[0-9a-f]{16}\.m4a$/);
        // Named by the AUDIO bytes, not the video's — different soundtracks over
        // identical footage must not dedup to one file.
        expect(audio.path).toBe(`assets/${audio.contentHash}.m4a`);
        expect(audio.contentHash).not.toBe(video.contentHash);
        expect(existsSync(path.join(root, 'build', audio.path))).toBe(true);
    });
});
