/**
 * @file    ImporterRegistry.ts
 * @brief   Registry for asset importers with per-type settings and UI generation
 */

import type { AssetEntry } from './AssetDatabase';
import { TextureImporter } from './importers/TextureImporter';
import { AudioImporter } from './importers/AudioImporter';

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

export interface AssetImporter<T = Record<string, unknown>> {
    type: string;
    extensions: string[];
    defaultSettings(): T;
    settingsUI(current: T): ImporterField[];
    apply?(asset: AssetEntry, settings: T): void;
}

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

    getByExtension(ext: string): AssetImporter<any> | undefined {
        const type = this.extToType_.get(ext);
        return type ? this.importers_.get(type) : undefined;
    }

    getDefaultSettings(type: string): Record<string, unknown> {
        const importer = this.importers_.get(type);
        if (!importer) return {};
        return importer.defaultSettings() as Record<string, unknown>;
    }

    getSettingsUI(type: string, current: Record<string, unknown>): ImporterField[] {
        const importer = this.importers_.get(type);
        if (!importer) return [];
        return importer.settingsUI(current as any);
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
    }
    return registry;
}
