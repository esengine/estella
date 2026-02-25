/**
 * @file    ImporterTypes.ts
 * @brief   Type definitions for asset importer settings per asset type
 */

// =============================================================================
// Per-Type Importer Settings
// =============================================================================

export interface TextureImporterSettings {
    maxSize: number;
    filterMode: 'linear' | 'nearest';
    wrapMode: 'repeat' | 'clamp' | 'mirror';
    premultiplyAlpha: boolean;
    sliceBorder: { left: number; right: number; top: number; bottom: number };
}

export interface AudioImporterSettings {
    sampleRate: number;
    channels: 1 | 2;
    quality: number;
}

export interface SpineImporterSettings {
    defaultSkin: string;
    premultiplyAlpha: boolean;
    scale: number;
}

export interface MaterialImporterSettings {
    // reserved
}

export interface ShaderImporterSettings {
    // reserved
}

export interface BitmapFontImporterSettings {
    fontSize: number;
}

export interface SceneImporterSettings {
    autoMigrate: boolean;
}

export interface PrefabImporterSettings {
    autoMigrate: boolean;
}

export type ImporterSettings =
    | TextureImporterSettings
    | AudioImporterSettings
    | SpineImporterSettings
    | BitmapFontImporterSettings
    | SceneImporterSettings
    | PrefabImporterSettings
    | Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ImporterData = Record<string, any>;

// =============================================================================
// Platform Override
// =============================================================================

export type ImporterPlatform = 'playable' | 'wechat';

export const IMPORTER_PLATFORMS: { id: ImporterPlatform; label: string }[] = [
    { id: 'playable', label: 'Playable' },
    { id: 'wechat', label: 'WeChat' },
];

export function getEffectiveImporter(
    base: ImporterData,
    platformOverrides: Record<string, ImporterData>,
    platform: string,
): ImporterData {
    const override = platformOverrides[platform];
    if (!override || Object.keys(override).length === 0) return base;
    return { ...base, ...override };
}

// =============================================================================
// Default Settings Factories
// =============================================================================

export function createDefaultTextureImporter(): TextureImporterSettings {
    return {
        maxSize: 2048,
        filterMode: 'linear',
        wrapMode: 'repeat',
        premultiplyAlpha: false,
        sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 },
    };
}

export function createDefaultAudioImporter(): AudioImporterSettings {
    return {
        sampleRate: 44100,
        channels: 2,
        quality: 0.8,
    };
}

export function createDefaultSpineImporter(): SpineImporterSettings {
    return {
        defaultSkin: 'default',
        premultiplyAlpha: false,
        scale: 1,
    };
}

export function createDefaultBitmapFontImporter(): BitmapFontImporterSettings {
    return {
        fontSize: 32,
    };
}

export function createDefaultSceneImporter(): SceneImporterSettings {
    return {
        autoMigrate: true,
    };
}

export function createDefaultPrefabImporter(): PrefabImporterSettings {
    return {
        autoMigrate: true,
    };
}

export function getDefaultImporterForType(type: string): ImporterData {
    switch (type) {
        case 'texture':
            return createDefaultTextureImporter();
        case 'audio':
            return createDefaultAudioImporter();
        case 'spine-skeleton':
        case 'spine-atlas':
            return createDefaultSpineImporter();
        case 'bitmap-font':
            return createDefaultBitmapFontImporter();
        case 'scene':
            return createDefaultSceneImporter();
        case 'prefab':
            return createDefaultPrefabImporter();
        default:
            return {};
    }
}

// =============================================================================
// Asset Meta (v2.0)
// =============================================================================

export interface AssetMeta {
    uuid: string;
    version: string;
    type: string;
    labels: string[];
    address: string | null;
    importer: ImporterData;
    platformOverrides: Record<string, ImporterData>;
    sliceBorder?: { left: number; right: number; top: number; bottom: number };
}

export function createDefaultMeta(uuid: string, type: string): AssetMeta {
    return {
        uuid,
        version: '2.0',
        type,
        labels: [],
        address: null,
        importer: getDefaultImporterForType(type),
        platformOverrides: {},
    };
}

/**
 * Upgrade a v1.0 meta object to v2.0 format.
 * Preserves existing sliceBorder by migrating it into importer.
 */
export function upgradeMeta(raw: Record<string, unknown>): AssetMeta {
    const uuid = raw.uuid as string;
    const type = (raw.type as string) || 'unknown';
    const meta = createDefaultMeta(uuid, type);

    if (raw.labels && Array.isArray(raw.labels)) {
        meta.labels = raw.labels as string[];
    }
    if (typeof raw.address === 'string') {
        meta.address = raw.address;
    }
    if (raw.importer && typeof raw.importer === 'object') {
        meta.importer = { ...meta.importer, ...(raw.importer as ImporterData) };
    }
    if (raw.platformOverrides && typeof raw.platformOverrides === 'object') {
        meta.platformOverrides = raw.platformOverrides as Record<string, ImporterData>;
    }

    if (type === 'texture' && raw.sliceBorder && typeof raw.sliceBorder === 'object') {
        (meta.importer as TextureImporterSettings).sliceBorder =
            raw.sliceBorder as TextureImporterSettings['sliceBorder'];
    }

    return meta;
}

/**
 * Serialize meta to JSON for writing to .meta file.
 * Omits empty/default fields to keep files compact.
 */
export function serializeMeta(meta: AssetMeta): string {
    const obj: Record<string, unknown> = {
        uuid: meta.uuid,
        version: meta.version,
        type: meta.type,
    };

    if (meta.labels.length > 0) {
        obj.labels = meta.labels;
    }
    if (meta.address !== null) {
        obj.address = meta.address;
    }
    if (Object.keys(meta.importer).length > 0) {
        obj.importer = meta.importer;
    }
    if (Object.keys(meta.platformOverrides).length > 0) {
        obj.platformOverrides = meta.platformOverrides;
    }

    return JSON.stringify(obj, null, 2);
}
