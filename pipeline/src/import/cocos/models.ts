// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The models a Cocos project draws, taken in with the engine's own model import.
 *
 * A Cocos mesh, material and skeleton live inside an `.fbx` or `.gltf` as sub-assets, and a scene points at them as `<uuid>@<id>`. The engine reads
 * a model by importing it: a prefab that places the pieces, a mesh per primitive, the materials, the images, a clip per animation. This does that
 * import for each model a converted document uses, and answers the two questions the converter has: which prefab is this model, and which mesh
 * component does this Cocos mesh correspond to.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { importModelFile } from '../../assets/importModelFile';
import { modelStem } from '../../assets/readModelSource';
import { metaTypeFor, mintMeta } from '../../assets/assetMeta';
import type { CocosAssetEntry, CocosAssetIndex } from './assets';

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ModelUse {
    /** Project-relative path of the model's prefab; empty for a file that only holds animation. */
    prefab: string;
    /** The prefab's root entity id, which an override addresses. */
    rootId: string;
    /** Components by the name of the entity that carries them. */
    byEntity: Map<string, Raw[]>;
    /** Project-relative path of each animation clip, by the animation's own name. */
    clips: Map<string, string>;
    /** Where each node of the model stands under the prefab's root, as the path a clip addresses it by, keyed by the node's name. */
    paths: Map<string, string>;
    /** The names of the joints a skinned part is bound to, in the order its vertices index them, keyed by the part's name. */
    skin: Map<string, string[]>;
}

const MODEL_EXT = /\.(fbx|gltf|glb)$/i;
export const isModelEntry = (entry: CocosAssetEntry | undefined): entry is CocosAssetEntry => !!entry && MODEL_EXT.test(entry.rel);

export class CocosModels {
    private readonly uses = new Map<string, ModelUse | null>();
    private readonly scanned = new Map<string, string[]>();
    readonly failures: Array<{ file: string; error: string }> = [];
    readonly warnings: Array<{ file: string; warning: string }> = [];

    constructor(
        private readonly index: CocosAssetIndex,
        private readonly out: string,
        private readonly into: string,
        private readonly dryRun: boolean,
    ) {}

    /** The model files a document refers to, by looking for their uuids in its text. */
    modelsIn(file: string): CocosAssetEntry[] {
        let uuids = this.scanned.get(file);
        if (!uuids) {
            uuids = [];
            try {
                const text = readFileSync(file, 'utf8');
                for (const m of text.matchAll(/"__uuid__"\s*:\s*"([0-9a-f-]{36})(?:@[0-9a-f]+)?"/g)) uuids.push(m[1]!);
            } catch {
                // an unreadable document is reported where it is parsed
            }
            this.scanned.set(file, [...new Set(uuids)]);
            uuids = this.scanned.get(file)!;
        }
        const found: CocosAssetEntry[] = [];
        for (const u of uuids) {
            const entry = this.index.byUuid.get(u);
            if (isModelEntry(entry) && !found.includes(entry)) found.push(entry);
        }
        return found;
    }

    /** Bring in every model a document uses that has not been brought in. */
    async ensureFor(file: string): Promise<void> {
        for (const entry of this.modelsIn(file)) await this.ensure(entry);
    }

    async ensure(entry: CocosAssetEntry): Promise<void> {
        if (this.uses.has(entry.file)) return;
        this.uses.set(entry.file, null);
        if (this.dryRun) return;
        const destDir = `assets/${this.into}/${path.posix.dirname(entry.rel)}`.replace(/\/\.$/, '');
        const stem = modelStem(entry.file);
        const prefabAbs = path.join(this.out, destDir, `${stem}.esprefab`);
        try {
            // A model already imported is the project's now (its prefab may have been edited): it is read, not written over.
            if (!existsSync(prefabAbs)) {
                const result = await importModelFile({ root: this.out, destDir, absSource: entry.file });
                for (const warning of result.warnings) this.warnings.push({ file: entry.rel, warning });
            }
            this.uses.set(entry.file, readUse(prefabAbs, `${destDir}/${stem}.esprefab`, path.join(this.out, destDir), stem, destDir));
        } catch (err) {
            this.failures.push({ file: entry.rel, error: (err as Error).message });
        }
    }

    /** The model a `<uuid>` or `<uuid>@<id>` names, once it has been brought in. */
    use(uuid: string): { entry: CocosAssetEntry; use: ModelUse } | null {
        const entry = this.index.byUuid.get(uuid.split('@')[0]!);
        if (!isModelEntry(entry)) return null;
        const use = this.uses.get(entry.file);
        return use ? { entry, use } : null;
    }

    /** The name a mesh sub-asset carries, without its `.mesh`. */
    meshName(entry: CocosAssetEntry, uuid: string): string | null {
        const name = entry.subs.get(uuid)?.name;
        return name ? name.replace(/\.mesh$/i, '') : null;
    }
}

/** A clip's name as a file name carries it: what the model import made of it, so a Cocos name and a product name compare. */
const clipKey = (name: string): string => name.replace(/\.(animation|anim)$/i, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

/**
 * A clip of this model by the name Cocos gave it, or its only clip when the names do not meet (a model with one animation has nothing
 * else a node could mean).
 */
export function clipOf(use: ModelUse, cocosName: string | undefined): string | null {
    if (cocosName) {
        const wanted = clipKey(cocosName);
        for (const [name, ref] of use.clips) if (clipKey(name) === wanted) return ref;
    }
    return use.clips.size === 1 ? [...use.clips.values()][0]! : null;
}

function readUse(prefabAbs: string, prefab: string, absDir: string, stem: string, destDir: string): ModelUse {
    // A file with animation and no mesh produces no prefab, only clips.
    const hasPrefab = existsSync(prefabAbs);
    const doc = hasPrefab ? JSON.parse(readFileSync(prefabAbs, 'utf8')) as { rootEntityId?: string; entities?: Raw[] } : {};
    const byEntity = new Map<string, Raw[]>();
    for (const e of (doc as { entities?: Raw[] }).entities ?? []) {
        if (typeof e.name !== 'string' || !Array.isArray(e.components)) continue;
        byEntity.set(e.name, [...(byEntity.get(e.name) ?? []), ...(e.components as Raw[]).filter(isObj)]);
    }
    const clips = new Map<string, string>();
    try {
        for (const file of readdirSync(absDir)) {
            if (file.startsWith(`${stem}_`) && file.endsWith('.estimeline')) clips.set(file.slice(stem.length + 1, -'.estimeline'.length), `${destDir}/${file}`);
        }
    } catch {
        // no clips beside the model
    }
    // where each node stands, by name: a clip addresses a node by its path under the root, the root itself left out
    const entities = (doc as { entities?: Raw[] }).entities ?? [];
    const byId = new Map(entities.map((e) => [String(e.prefabEntityId), e]));
    const paths = new Map<string, string>();
    const pathOf = (e: Raw): string => {
        const parent = typeof e.parent === 'string' ? byId.get(e.parent) : undefined;
        return parent && parent.parent !== null && parent.parent !== undefined ? `${pathOf(parent)}/${String(e.name)}` : String(e.name);
    };
    for (const e of entities) if (e.parent !== null && e.parent !== undefined && !paths.has(String(e.name))) paths.set(String(e.name), pathOf(e));
    const skin = new Map<string, string[]>();
    for (const e of entities) {
        for (const c of Array.isArray(e.components) ? (e.components as Raw[]) : []) {
            if (c.type !== 'MeshSkin' || !isObj(c.data) || !Array.isArray(c.data.joints)) continue;
            skin.set(String(e.name), c.data.joints.map((id) => String(byId.get(String(id))?.name ?? '')));
        }
    }
    return { prefab: hasPrefab ? prefab : '', rootId: (doc as { rootEntityId?: string }).rootEntityId ?? 'n1', byEntity, clips, paths, skin };
}

/** How a Cocos clip plays, from the sub-asset the scene names: the part of the animation it is, and what it does at its end. */
export interface ClipPlay {
    span?: { from: number; to: number };
    wrapMode?: 'once' | 'loop' | 'pingPong';
}

/** Cocos's `AnimationClip.WrapMode` in the timeline's names: Loop (2) and PingPong (36) are themselves; the rest play once. */
export function wrapModeOf(cocos: unknown): ClipPlay['wrapMode'] {
    return cocos === 2 || cocos === 22 ? 'loop' : cocos === 36 ? 'pingPong' : 'once';
}

/** What a clip sub-asset says about how it plays: the span of the take it covers and its wrap mode. */
export function clipPlayOf(userData: Record<string, unknown> | undefined): ClipPlay {
    const span = userData?.span;
    const play: ClipPlay = { wrapMode: wrapModeOf(userData?.wrapMode) };
    if (isObj(span) && typeof span.from === 'number' && typeof span.to === 'number' && span.to > span.from) play.span = { from: span.from, to: span.to };
    return play;
}

interface Key { time: number; [k: string]: unknown }

/**
 * A clip written for one hierarchy, addressed to another: each track follows the node of its last name to where that node stands in @p paths.
 * Cocos plays an animation file's clip on any skeleton whose bones carry the names it animates, and the engine addresses by path, so the clip is
 * copied once for each skeleton it is played on. A track whose node the target does not have is dropped, and counted. Cocos also cuts one take
 * into named clips by time range; the copy keeps the keys inside @p play.span, moved to start at zero.
 *
 * @returns the project-relative path of the copy, or null when no track found its node.
 */
export function retargetClip(out: string, clipRef: string, paths: Map<string, string>, key: string, play: ClipPlay = {}): { ref: string; dropped: number } | null {
    const abs = path.join(out, clipRef);
    const doc = JSON.parse(readFileSync(abs, 'utf8')) as { tracks?: Raw[]; duration?: number; wrapMode?: string };
    const span = play.span;
    const tracks: Raw[] = [];
    let dropped = 0;
    // A clip of a single object animates the object itself, which the file calls by its own name and a scene calls whatever it likes: when exactly
    // every track is on one top-level name and it finds no node, it is the node the clip plays on.
    const loose = new Set<string>();
    for (const track of doc.tracks ?? []) {
        const cp = typeof track.childPath === 'string' ? track.childPath : '';
        if (cp !== '' && !cp.includes('/') && !paths.has(cp)) loose.add(cp);
    }
    const host = loose.size === 1 && (doc.tracks ?? []).every((t) => t.childPath === [...loose][0]) ? [...loose][0]! : null;
    for (const track of doc.tracks ?? []) {
        const childPath = typeof track.childPath === 'string' ? track.childPath : '';
        const name = childPath.split('/').pop() ?? '';
        const target = childPath === '' || (host !== null && childPath === host) ? '' : paths.get(name);
        if (target === undefined) {
            dropped++;
            continue;
        }
        const channels = (Array.isArray(track.channels) ? (track.channels as Raw[]) : []).map((channel) => {
            const keys = (Array.isArray(channel.keyframes) ? (channel.keyframes as Key[]) : []);
            if (!span) return channel;
            const inside = keys.filter((k) => k.time >= span.from - 1e-6 && k.time <= span.to + 1e-6).map((k) => ({ ...k, time: Math.max(0, k.time - span.from) }));
            return { ...channel, keyframes: inside };
        }).filter((channel) => (channel.keyframes as unknown[]).length > 0);
        if (channels.length === 0) continue;
        tracks.push({ ...track, childPath: target, name: target.split('/').pop() || track.name, channels });
    }
    if (tracks.length === 0) return null;
    const tag = [key, span ? `${span.from}-${span.to}` : '', play.wrapMode ?? ''].filter(Boolean).join('_').replace(/[^A-Za-z0-9]+/g, '_');
    const ref = clipRef.replace(/\.estimeline$/, `__${tag}.estimeline`);
    const file = path.join(out, ref);
    mkdirSync(path.dirname(file), { recursive: true });
    const copy = { ...doc, tracks, duration: span ? span.to - span.from : doc.duration, ...(play.wrapMode ? { wrapMode: play.wrapMode } : {}) };
    writeFileSync(file, `${JSON.stringify(copy, null, 2)}\n`);
    const type = metaTypeFor(file);
    if (type && !existsSync(`${file}.meta`)) writeFileSync(`${file}.meta`, `${JSON.stringify(mintMeta(type), null, 2)}\n`);
    return { ref, dropped };
}
