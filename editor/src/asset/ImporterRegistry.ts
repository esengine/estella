/**
 * @file    ImporterRegistry.ts
 * @brief   Registry for asset importers with per-type settings and UI generation
 */

import type { AssetEntry } from './AssetDatabase';
import type { ImporterData } from './ImporterTypes';
import { TextureImporter } from './importers/TextureImporter';
import { AudioImporter } from './importers/AudioImporter';
import { SpineImporter } from './importers/SpineImporter';
import { MaterialImporter } from './importers/MaterialImporter';
import { ShaderImporter } from './importers/ShaderImporter';
import { BitmapFontImporter } from './importers/BitmapFontImporter';
import { SceneImporter } from './importers/SceneImporter';
import { PrefabImporter } from './importers/PrefabImporter';


// =============================================================================
// Types
// =============================================================================

export type ImporterFieldType = 'number' | 'boolean' | 'select' | 'slider' | 'sliceBorder';

export interface ImporterField {
    name: string;
    label: string;
    type: ImporterFieldType;
    value: unknown;
    options?: { label: string; value: unknown }[];
    min?: number;
    max?: number;
    step?: number;
}

export interface AssetImporter<T = ImporterData> {
    type: string;
    extensions: string[];
    defaultSettings(): T;
    settingsUI(current: T): ImporterField[];
    apply?(asset: AssetEntry, settings: T): void;
}

// =============================================================================
// DefaultImporter
// =============================================================================

const defaultImporter: AssetImporter<ImporterData> = {
    type: 'default',
    extensions: [],
    defaultSettings() { return {}; },
    settingsUI() { return []; },
};

// =============================================================================
// ImporterRegistry
// =============================================================================

class ImporterRegistryImpl {
    private importers_ = new Map<string, AssetImporter<any>>();
    private extToType_ = new Map<string, string>();

    register(importer: AssetImporter<any>): void {
        this.importers_.set(importer.type, importer);
        for (const ext of importer.extensions) {
            this.extToType_.set(ext, importer.type);
        }
    }

    get(type: string): AssetImporter<any> | undefined {
        return this.importers_.get(type);
    }

    getOrDefault(type: string): AssetImporter<any> {
        return this.importers_.get(type) ?? defaultImporter;
    }

    getByExtension(ext: string): AssetImporter<any> | undefined {
        const type = this.extToType_.get(ext);
        return type ? this.importers_.get(type) : undefined;
    }

    getByExtensionOrDefault(ext: string): AssetImporter<any> {
        return this.getByExtension(ext) ?? defaultImporter;
    }

    getDefaultSettings(type: string): ImporterData {
        return this.getOrDefault(type).defaultSettings();
    }

    getSettingsUI(type: string, current: ImporterData): ImporterField[] {
        const importer = this.importers_.get(type);
        if (!importer) return [];
        return importer.settingsUI(current);
    }

    getAllTypes(): string[] {
        return [...this.importers_.keys()];
    }
}

// =============================================================================
// Singleton
// =============================================================================

let registry: ImporterRegistryImpl | null = null;

export function getImporterRegistry(): ImporterRegistryImpl {
    if (!registry) {
        registry = new ImporterRegistryImpl();
        registry.register(new TextureImporter());
        registry.register(new AudioImporter());
        registry.register(new SpineImporter());
        registry.register(new MaterialImporter());
        registry.register(new ShaderImporter());
        registry.register(new BitmapFontImporter());
        registry.register(new SceneImporter());
        registry.register(new PrefabImporter());
    }
    return registry;
}
