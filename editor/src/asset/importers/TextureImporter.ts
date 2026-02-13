/**
 * @file    TextureImporter.ts
 * @brief   Importer for texture assets (png, jpg, gif, webp, svg)
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { TextureImporterSettings } from '../ImporterTypes';
import { createDefaultTextureImporter } from '../ImporterTypes';

export class TextureImporter implements AssetImporter<TextureImporterSettings> {
    readonly type = 'texture';
    readonly extensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

    defaultSettings(): TextureImporterSettings {
        return createDefaultTextureImporter();
    }

    settingsUI(current: TextureImporterSettings): ImporterField[] {
        return [
            {
                name: 'maxSize',
                label: 'Max Size',
                type: 'select',
                value: current.maxSize,
                options: [
                    { label: '256', value: 256 },
                    { label: '512', value: 512 },
                    { label: '1024', value: 1024 },
                    { label: '2048', value: 2048 },
                    { label: '4096', value: 4096 },
                ],
            },
            {
                name: 'filterMode',
                label: 'Filter Mode',
                type: 'select',
                value: current.filterMode,
                options: [
                    { label: 'Linear', value: 'linear' },
                    { label: 'Nearest', value: 'nearest' },
                ],
            },
            {
                name: 'wrapMode',
                label: 'Wrap Mode',
                type: 'select',
                value: current.wrapMode,
                options: [
                    { label: 'Repeat', value: 'repeat' },
                    { label: 'Clamp', value: 'clamp' },
                    { label: 'Mirror', value: 'mirror' },
                ],
            },
            {
                name: 'premultiplyAlpha',
                label: 'Premultiply Alpha',
                type: 'boolean',
                value: current.premultiplyAlpha,
            },
            {
                name: 'sliceBorder',
                label: 'Slice Border',
                type: 'sliceBorder',
                value: current.sliceBorder,
            },
        ];
    }
}
