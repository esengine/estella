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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { importModelFile } from '../../assets/importModelFile';
import { modelStem } from '../../assets/readModelSource';
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
    return { prefab: hasPrefab ? prefab : '', rootId: (doc as { rootEntityId?: string }).rootEntityId ?? 'n1', byEntity, clips };
}
