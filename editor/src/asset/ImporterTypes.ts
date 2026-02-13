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

export type ImporterSettings =
    | TextureImporterSettings
    | AudioImporterSettings
    | Record<string, unknown>;

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

export function getDefaultImporterForType(type: string): Record<string, unknown> {
    switch (type) {
        case 'texture':
            return createDefaultTextureImporter() as unknown as Record<string, unknown>;
        case 'audio':
            return createDefaultAudioImporter() as unknown as Record<string, unknown>;
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
    importer: Record<string, unknown>;
    platformOverrides: Record<string, Record<string, unknown>>;
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
        meta.importer = { ...meta.importer, ...(raw.importer as Record<string, unknown>) };
    }
    if (raw.platformOverrides && typeof raw.platformOverrides === 'object') {
        meta.platformOverrides = raw.platformOverrides as Record<string, Record<string, unknown>>;
    }

    if (type === 'texture' && raw.sliceBorder && typeof raw.sliceBorder === 'object') {
        (meta.importer as unknown as TextureImporterSettings).sliceBorder =
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
