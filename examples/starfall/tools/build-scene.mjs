import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const save = async (name, value) => { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n'); };
function uuid(name) { const h = createHash('sha256').update('starfall/' + name).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }
const meta = async (file, type, importer = {}) => save(file + '.meta', { uuid: uuid(file), version: '2.0', type, importer });
await meta('assets/textures/temple.png', 'texture', { maxSize: 1536, filterMode: 'linear', wrapMode: 'clamp', premultiplyAlpha: false, compress: 'on', compressFormat: 'etc1s', mipmaps: false });
// This cutout has non-block-aligned dimensions: keep its alpha as a resized PNG.
await meta('assets/textures/knight.png', 'texture', { maxSize: 512, filterMode: 'linear', wrapMode: 'clamp', premultiplyAlpha: false, compress: 'off', mipmaps: false });
await meta('assets/textures/sentinel.png', 'texture', { maxSize: 256, filterMode: 'linear', wrapMode: 'clamp', premultiplyAlpha: false, compress: 'off', mipmaps: false });
const entities = [];
function entity(name, data) { const id = entities.length; entities.push({ id, name, parent: null, children: [], visible: true, components: Object.entries(data).map(([type, data]) => ({ type, data })) }); return id; }
entity('Camera', { Transform: { position: { x: 0, y: 0, z: 10 } }, Camera: { projectionType: 1, orthoSize: 360, isActive: true, priority: 0 } });
entity('Temple', { Transform: { position: { x: 0, y: 0, z: 0 } }, Sprite: { texture: 'assets/textures/temple.png', size: { x: 1280, y: 720 }, layer: 0 } });
entity('Hero', { Transform: { position: { x: 46, y: 64, z: 0 } }, Sprite: { texture: 'assets/textures/knight.png', size: { x: 390, y: 420 }, layer: 2 } });
for (let i = 0; i < 6; i++) entity('Sentinel-' + i, { Transform: {}, Sprite: { texture: 'assets/textures/sentinel.png', size: { x: 105, y: 105 }, color: { r: 1, g: 1, b: 1, a: 0 }, layer: 3 } });
entity('Canvas', { Transform: {}, Canvas: { designResolution: { x: 1280, y: 720 }, scaleMode: 2 }, UINode: {} });

// Small original synthesised PCM cues, no network audio or runtime synthesizer.
for (const [name, seconds, frequency] of [['slash', .16, 980], ['dash', .22, 520], ['nova', .75, 130], ['gate', 1.3, 220]]) {
    const rate = 22050, n = Math.floor(seconds * rate), pcm = Buffer.alloc(44 + n * 2);
    pcm.write('RIFF'); pcm.writeUInt32LE(36 + n * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16);
    pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(rate, 24); pcm.writeUInt32LE(rate * 2, 28);
    pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(n * 2, 40);
    let seed = 193, phase = 0;
    for (let i = 0; i < n; i++) {
        const u = i / n, t = i / rate, env = Math.min(1, t * 70) * Math.pow(1 - u, name === 'gate' ? 1 : 2);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        phase += Math.PI * 2 * frequency * (name === 'gate' ? 1 + u : 1.4 - u) / rate;
        const tone = Math.sin(phase) * .45 + Math.sin(phase * 1.5) * .16 + (seed / 4294967296 - .5) * (name === 'slash' ? .5 : .12);
        pcm.writeInt16LE(Math.round(tone * env * 24000), 44 + i * 2);
    }
    const file = `assets/audio/${name}.wav`; await save(file, pcm); await meta(file, 'audio');
    entity('Audio-' + name, { Transform: {}, AudioSource: { clip: file, playing: false, volume: .5, loop: false, playOnAwake: false } });
}
await save('assets/scenes/main.esscene', { version: 4, name: 'Starfall', entities });
await meta('assets/scenes/main.esscene', 'scene');
console.log('Starfall scene and bounded audio cues prepared.');
