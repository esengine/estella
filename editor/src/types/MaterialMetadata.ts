/**
 * @file    MaterialMetadata.ts
 * @brief   Material file types and utilities
 */

// =============================================================================
// Types
// =============================================================================

export interface MaterialMetadata {
    version: string;
    type: 'material';
    shader: string;
    blendMode: number;
    depthTest: boolean;
    properties: Record<string, unknown>;
}

export interface MaterialPropertyValue {
    x?: number;
    y?: number;
    z?: number;
    w?: number;
}

// =============================================================================
// BlendMode
// =============================================================================

export const BLEND_MODE_OPTIONS = [
    { label: 'Normal', value: 0 },
    { label: 'Additive', value: 1 },
    { label: 'Multiply', value: 2 },
    { label: 'Screen', value: 3 },
    { label: 'Premultiplied Alpha', value: 4 },
];

export function getBlendModeName(value: number): string {
    const option = BLEND_MODE_OPTIONS.find(o => o.value === value);
    return option?.label ?? 'Unknown';
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createDefaultMaterialMetadata(): MaterialMetadata {
    return {
        version: '1.0',
        type: 'material',
        shader: '',
        blendMode: 0,
        depthTest: false,
        properties: {},
    };
}

// =============================================================================
// Meta File Operations
// =============================================================================

export function getMaterialFilePath(path: string): boolean {
    return path.endsWith('.esmaterial');
}

export function parseMaterialMetadata(json: string): MaterialMetadata | null {
    try {
        const data = JSON.parse(json);
        if (data.type !== 'material') return null;
        return {
            version: data.version ?? '1.0',
            type: 'material',
            shader: data.shader ?? '',
            blendMode: data.blendMode ?? 0,
            depthTest: data.depthTest ?? false,
            properties: data.properties ?? {},
        };
    } catch {
        return null;
    }
}

export function serializeMaterialMetadata(metadata: MaterialMetadata): string {
    return JSON.stringify(metadata, null, 2);
}

// =============================================================================
// Property Value Helpers
// =============================================================================

export function isVec2Value(value: unknown): value is MaterialPropertyValue {
    return typeof value === 'object' && value !== null && 'x' in value && 'y' in value && !('z' in value);
}

export function isVec3Value(value: unknown): value is MaterialPropertyValue {
    return typeof value === 'object' && value !== null && 'x' in value && 'y' in value && 'z' in value && !('w' in value);
}

export function isVec4Value(value: unknown): value is MaterialPropertyValue {
    return typeof value === 'object' && value !== null && 'x' in value && 'y' in value && 'z' in value && 'w' in value;
}
