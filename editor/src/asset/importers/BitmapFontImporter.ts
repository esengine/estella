/**
 * @file    BitmapFontImporter.ts
 * @brief   Importer for bitmap font assets (.fnt, .bmfont)
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { BitmapFontImporterSettings } from '../ImporterTypes';
import { createDefaultBitmapFontImporter } from '../ImporterTypes';

export class BitmapFontImporter implements AssetImporter<BitmapFontImporterSettings> {
    readonly type = 'bitmap-font';
    readonly extensions = ['.fnt', '.bmfont'];

    defaultSettings(): BitmapFontImporterSettings {
        return createDefaultBitmapFontImporter();
    }

    settingsUI(current: BitmapFontImporterSettings): ImporterField[] {
        return [
            {
                name: 'fontSize',
                label: 'Font Size',
                type: 'number',
                value: current.fontSize,
                min: 1,
                max: 256,
                step: 1,
            },
        ];
    }
}
