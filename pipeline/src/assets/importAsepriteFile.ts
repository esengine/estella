// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { AnimClipAssetData } from 'esengine';
import { extractUuid } from '../../../sdk/src/asset/AssetRegistry';
import { findDocumentAsset } from '../../../sdk/src/asset/documentRef';
import { realPathOf, resolveInside } from '../fs/pathSandbox';
import { projectAssetPathProbe } from './assetDb';
import { metaTypeFor, mintMeta } from './assetMeta';
import { importAseprite } from './asepriteImport';
import { asepriteClipName, availableName, filenameKey, matchAsepriteClips, type PreviousClip } from './asepriteTagIdentity';
import { META_EXT } from './contentPolicy';
import { readImportJson, setImportMeta, writeImportFile } from './importMeta';
import { sourceProductWriter, type SourceFileLocation } from './sourceProducts';

type Meta = Record<string, unknown>;
type Writer = Awaited<ReturnType<typeof sourceProductWriter>>;
type Sheet = { file: string; meta: Meta };
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const inside = (dir: string, file: string) => resolveInside(dir, file, 'product directory');

/** An unreadable sidecar reserves its filename. It cannot establish ownership of that file. */
async function readCandidate(dir: string, file: string) {
    try { return await readImportJson(inside(dir, file + META_EXT)); }
    catch (e) { if (e instanceof SyntaxError) return null; throw e; }
}

function owned(meta: Meta | null, writer: Writer, origin: string): meta is Meta {
    return !!meta && (writer.sourceUuid ? String(meta.source).toLowerCase() === writer.sourceUuid
        : !meta.source && meta.asepriteOrigin === origin);
}

async function inventory(writer: Writer, origin: string) {
    const occupied = new Set<string>(), clips: PreviousClip[] = [];
    let sheet: Sheet | undefined;
    const files = await readdir(writer.absDir, { withFileTypes: true });
    for (const entry of files) {
        const file = entry.name.replace(/\.meta$/i, '');
        occupied.add(filenameKey(file));
        if (!entry.isFile() || !/\.(png|esanim)\.meta$/i.test(entry.name)) continue;
        const meta = await readCandidate(writer.absDir, file);
        if (!owned(meta, writer, origin)) continue;
        if (file.toLowerCase().endsWith('.png')) {
            if (sheet) throw new Error('Multiple sprite sheets belong to this Aseprite file: ' + sheet.file + ', ' + file);
            sheet = { file, meta };
        } else {
            const tag = meta.asepriteTag as PreviousClip['tag'];
            if (tag !== null && tag !== undefined && typeof tag.name !== 'string') throw new Error('Invalid Aseprite tag in ' + entry.name);
            const clip: PreviousClip = { file, tag, uuid: meta.uuid };
            if (tag === undefined) clip.data = await readClip(writer.absDir, file);
            clips.push(clip);
        }
    }
    return { occupied, sheet, clips };
}

async function readClip(dir: string, file: string): Promise<AnimClipAssetData | null> {
    return await readImportJson(inside(dir, file)) as unknown as AnimClipAssetData | null;
}

/** Reserve a new UUID and its ownership together. A retry can recognize a sidecar even if content never landed. */
async function reserve(abs: string, settings: Meta, fields: Meta) {
    if (existsSync(abs)) throw new Error('Asset already exists: ' + abs);
    const meta = { ...mintMeta(metaTypeFor(abs)!, settings), ...fields };
    await writeFile(abs + META_EXT, json(meta), { flag: 'wx' });
}

async function retainSheet(writer: Writer, sheet: Sheet, occupied: Set<string>): Promise<string> {
    const bytes = await readFile(inside(writer.absDir, sheet.file));
    const settings = (sheet.meta.importer ?? {}) as Meta;
    const digest = createHash('sha256').update(bytes).update(json(settings)).digest('hex');
    const base = path.parse(sheet.file).name + '-retained-' + digest.slice(0, 12);
    for (let n = 1; ; n++) {
        const file = base + (n === 1 ? '' : '-' + n) + '.png';
        if (!occupied.has(filenameKey(file))) {
            await writer.edit(file, async abs => {
                await reserve(abs, settings, { asepriteSnapshot: digest, importer: settings });
                await writeImportFile(abs, bytes);
            });
            occupied.add(filenameKey(file));
            return file;
        }
        const meta = await readCandidate(writer.absDir, file);
        if (meta?.asepriteSnapshot !== digest || meta.source || !isDeepStrictEqual(meta.importer, settings)) continue;
        const abs = inside(writer.absDir, file);
        if (!existsSync(abs)) await writer.edit(file, target => writeImportFile(target, bytes));
        else if (!(await readFile(abs)).equals(bytes)) continue;
        return file;
    }
}

/** Redirect only references to the page about to change. Keep edited events, timing and unknown fields verbatim. */
async function liveTextures(
    clip: AnimClipAssetData | null, clipPath: string, livePath: string, uuid: string | null,
    hasAsset: (candidate: string) => Promise<boolean>,
) {
    const slots = [clip?.sheet, ...(Array.isArray(clip?.frames) ? clip.frames : [])]
        .filter((slot): slot is { texture: string } => typeof slot?.texture === 'string');
    const matches = await Promise.all(slots.map(async ({ texture }) => {
        const id = extractUuid(texture);
        if (id) return id === uuid;
        const earlier: string[] = [];
        const live = findDocumentAsset(clipPath, texture, candidate => {
            if (candidate === livePath) return candidate;
            earlier.push(candidate);
            return undefined;
        });
        if (!live) return false;
        for (const candidate of earlier) if (await hasAsset(candidate)) return false;
        return true;
    }));
    return slots.filter((_, i) => matches[i]);
}

export async function importAsepriteFile(location: SourceFileLocation) {
    const stem = path.parse(location.absSource).name, prefix = location.destDir ? location.destDir + '/' : '';
    const art = importAseprite(await readFile(location.absSource), stem, prefix);
    const writer = await sourceProductWriter(location, writeImportFile);
    // Standalone CLI output has no source asset in its registry. Distinguish same-named input files there, too.
    const origin = writer.sourceUuid ?? createHash('sha256').update(realPathOf(location.absSource)).digest('hex');
    const owner = writer.sourceUuid ? { source: writer.sourceUuid } : { asepriteOrigin: origin };
    function checkOwner(meta: Meta | null, uuid: unknown, file: string) {
        if (!owned(meta, writer, origin) || meta.uuid !== uuid) throw new Error('Asset identity changed during import: ' + file);
    }
    const { occupied, sheet, clips } = await inventory(writer, origin);
    const { matched, retired } = matchAsepriteClips(sheet ? path.parse(sheet.file).name : stem, art.clips, clips);
    const page = sheet?.file ?? availableName(art.sheet.file, occupied);
    const hasAsset = projectAssetPathProbe(location.root);
    let snapshot: string | undefined;
    // Freeze every retiring clip before publishing the new pixels. If interrupted, already detached clips
    // still play and the next import can finish the others against the same original page.
    for (const old of retired) {
        const clip = old.data ?? await readClip(writer.absDir, old.file);
        const slots = await liveTextures(clip, prefix + old.file, prefix + page, extractUuid(sheet?.meta.uuid), hasAsset);
        if (slots.length) {
            if (sheet && existsSync(inside(writer.absDir, page))) {
                snapshot ??= await retainSheet(writer, sheet, occupied);
                for (const slot of slots) slot.texture = prefix + snapshot;
            } else {
                art.warnings.push('Cannot retain the previous pixels for ' + old.file + ' because ' + page + ' is missing.');
            }
        }
        await writer.edit(old.file, async abs => {
            if (slots.length && snapshot) {
                checkOwner(await readCandidate(writer.absDir, old.file), old.uuid, old.file);
                await writeImportFile(abs, json(clip));
            }
            await setImportMeta(abs, meta => {
                checkOwner(meta, old.uuid, old.file);
                const { source, asepriteOrigin, asepriteTag, ...independent } = meta;
                return independent;
            });
        });
        art.warnings.push(old.file + ' is now an independent animation because its Aseprite tag was removed or changed.');
    }

    await writer.write(page, art.sheet.bytes, undefined, async abs => {
        if (!sheet) return reserve(abs, { ...art.settings }, owner);
        await setImportMeta(abs, meta => {
            checkOwner(meta, sheet.meta.uuid, page);
            return { ...meta, importer: { ...(meta.importer as Meta), sheet: art.settings.sheet } };
        });
    });
    for (const clip of art.clips) {
        const old = matched.get(clip);
        const file = old?.file ?? availableName(asepriteClipName(stem, clip.tag), occupied);
        const data = { ...clip.data, sheet: { ...clip.data.sheet, texture: prefix + page } };
        await writer.write(file, json(data), undefined, async abs => {
            if (!old) return reserve(abs, {}, { ...owner, asepriteTag: clip.tag });
            await setImportMeta(abs, meta => {
                checkOwner(meta, old.uuid, file);
                return { ...meta, asepriteTag: clip.tag };
            });
        });
    }
    return { products: writer.products, warnings: art.warnings };
}
