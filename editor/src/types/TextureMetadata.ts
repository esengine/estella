/**
 * @file    TextureMetadata.ts
 * @brief   Texture metadata types for nine-slice and other settings
 */

// =============================================================================
// SliceBorder
// =============================================================================

export interface SliceBorder {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export function createDefaultSliceBorder(): SliceBorder {
    return { left: 0, right: 0, top: 0, bottom: 0 };
}

export function hasSlicing(border: SliceBorder): boolean {
    return border.left > 0 || border.right > 0 || border.top > 0 || border.bottom > 0;
}

// =============================================================================
// TextureMetadata
// =============================================================================

export interface TextureMetadata {
    uuid?: string;
    version: string;
    type: 'texture';
    sliceBorder: SliceBorder;
}

export function createDefaultTextureMetadata(): TextureMetadata {
    return {
        version: '1.0',
        type: 'texture',
        sliceBorder: createDefaultSliceBorder()
    };
}

// =============================================================================
// Meta File Operations
// =============================================================================

export function getMetaFilePath(texturePath: string): string {
    return `${texturePath}.meta`;
}

export function parseTextureMetadata(json: string): TextureMetadata | null {
    try {
        const data = JSON.parse(json);
        if (data.type !== 'texture') return null;
        const result: TextureMetadata = {
            version: data.version ?? '1.0',
            type: 'texture',
            sliceBorder: {
                left: data.sliceBorder?.left ?? 0,
                right: data.sliceBorder?.right ?? 0,
                top: data.sliceBorder?.top ?? 0,
                bottom: data.sliceBorder?.bottom ?? 0
            }
        };
        if (data.uuid) {
            result.uuid = data.uuid;
        }
        return result;
    } catch {
        return null;
    }
}

export function serializeTextureMetadata(metadata: TextureMetadata): string {
    return JSON.stringify(metadata, null, 2);
}
