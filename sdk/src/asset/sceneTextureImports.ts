// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { atlasTextureSettingsKey, textureImportSettingsFrom, type ParsedTextureImportSettings } from './textureImportSettings';

/** A scene can carry the importer block itself in loose and native projects. */
export type SceneTextureImporterSettings = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** Immutable defaults for the reads issued by one preparation. */
export class SceneTextureInputs {
    readonly signature: string;

    /** Reacquire a material or font from the immutable inputs baked into its held binding. */
    static fromSignature(signature: string): SceneTextureInputs {
        const values = JSON.parse(signature) as [string, string][];
        return new SceneTextureInputs(new Map(values.map(([ref, settings]) => [ref, JSON.parse(settings)])));
    }

    constructor(readonly settings: ReadonlyMap<string, ParsedTextureImportSettings>, signature?: string) {
        this.signature = signature ?? JSON.stringify([...settings].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([ref, value]) => [ref, atlasTextureSettingsKey(value)]));
    }

    /** Reuse the immutable content and cache keys without granting permission to publish names. */
    forPreparation(): SceneTextureInputs {
        return this.settings.size ? new SceneTextureInputs(this.settings, this.signature) : this;
    }
}

/** Only a scene that hands off its content contributes fallback settings to later requests. */
export class SceneTextureImports {
    private readonly empty = new SceneTextureInputs(new Map());
    current = this.empty;

    clear(): void { this.current = this.empty; }

    prepare(data: SceneTextureImporterSettings | undefined, identity: (ref: string) => string | undefined,
        inherited = this.current) {
        if (!data) return;
        const declared = new Map<string, ParsedTextureImportSettings>();
        for (const [ref, raw] of Object.entries(data)) {
            if (!raw || typeof raw !== 'object') continue;
            // Older cooked scenes spell the importer’s sRGB flag as srgb.
            const settings = textureImportSettingsFrom({ ...raw, sRGB: raw.sRGB ?? raw.srgb });
            const key = identity(ref);
            if (settings && key !== undefined) declared.set(key, settings);
        }
        if (!declared.size) return;
        const merge = (previous: SceneTextureInputs) => new SceneTextureInputs(new Map([...previous.settings, ...declared]));
        const inputs = merge(inherited);
        return { inputs, publish: () => { this.current = this.current === inherited ? inputs : merge(this.current); } };
    }
}
