/**
 * @file    SpineImporter.ts
 * @brief   Importer for Spine skeleton and atlas assets
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { SpineImporterSettings } from '../ImporterTypes';
import { createDefaultSpineImporter } from '../ImporterTypes';

export class SpineImporter implements AssetImporter<SpineImporterSettings> {
    readonly type = 'spine';
    readonly extensions = ['.skel', '.atlas'];

    defaultSettings(): SpineImporterSettings {
        return createDefaultSpineImporter();
    }

    settingsUI(current: SpineImporterSettings): ImporterField[] {
        return [
            {
                name: 'defaultSkin',
                label: 'Default Skin',
                type: 'select',
                value: current.defaultSkin,
                options: [
                    { label: 'default', value: 'default' },
                ],
            },
            {
                name: 'premultiplyAlpha',
                label: 'Premultiply Alpha',
                type: 'boolean',
                value: current.premultiplyAlpha,
            },
            {
                name: 'scale',
                label: 'Scale',
                type: 'number',
                value: current.scale,
                min: 0.01,
                max: 10,
                step: 0.01,
            },
        ];
    }
}
