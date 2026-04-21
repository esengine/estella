export type AssetFieldType = 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'tilemap' | 'timeline';

export interface AssetFieldDescriptor {
    field: string;
    type: AssetFieldType;
}

export interface CompoundFieldDescriptor {
    type: string;
    fields: Record<string, string>;
}

interface RegistryEntry {
    fields: AssetFieldDescriptor[];
    compounds: CompoundFieldDescriptor[];
}

const registry_ = new Map<string, RegistryEntry>();

function ensureEntry(componentType: string): RegistryEntry {
    let entry = registry_.get(componentType);
    if (!entry) {
        entry = { fields: [], compounds: [] };
        registry_.set(componentType, entry);
    }
    return entry;
}

export function registerAssetFields(componentType: string, fields: AssetFieldDescriptor[]): void {
    const entry = ensureEntry(componentType);
    entry.fields = fields;
}

export function registerCompoundAssetFields(componentType: string, compound: CompoundFieldDescriptor): void {
    const entry = ensureEntry(componentType);
    entry.compounds.push(compound);
}

export function getAssetFields(componentType: string): AssetFieldDescriptor[] {
    return registry_.get(componentType)?.fields ?? [];
}

export function getCompoundAssetFields(componentType: string): CompoundFieldDescriptor[] {
    return registry_.get(componentType)?.compounds ?? [];
}

export function getAllRegisteredComponents(): string[] {
    return Array.from(registry_.keys());
}

export function clearAssetFieldRegistry(): void {
    registry_.clear();
}

export function initBuiltinAssetFields(): void {
    registerAssetFields('Sprite', [
        { field: 'texture', type: 'texture' },
        { field: 'material', type: 'material' },
    ]);

    registerCompoundAssetFields('SpineAnimation', {
        type: 'spine',
        fields: { skeleton: 'skeletonPath', atlas: 'atlasPath' },
    });
    registerAssetFields('SpineAnimation', [
        { field: 'material', type: 'material' },
    ]);

    registerAssetFields('BitmapText', [
        { field: 'font', type: 'font' },
    ]);

    registerAssetFields('Image', [
        { field: 'texture', type: 'texture' },
        { field: 'material', type: 'material' },
    ]);

    registerAssetFields('UIRenderer', [
        { field: 'texture', type: 'texture' },
        { field: 'material', type: 'material' },
    ]);

    registerAssetFields('SpriteAnimator', [
        { field: 'clip', type: 'anim-clip' },
    ]);

    registerAssetFields('AudioSource', [
        { field: 'clip', type: 'audio' },
    ]);

    registerAssetFields('ParticleEmitter', [
        { field: 'texture', type: 'texture' },
        { field: 'material', type: 'material' },
    ]);

    registerAssetFields('Tilemap', [
        { field: 'source', type: 'tilemap' },
    ]);

    registerAssetFields('TilemapLayer', [
        { field: 'tileset', type: 'texture' },
    ]);

    registerAssetFields('TimelinePlayer', [
        { field: 'timeline', type: 'timeline' },
    ]);
}
