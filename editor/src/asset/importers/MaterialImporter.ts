/**
 * @file    MaterialImporter.ts
 * @brief   Importer for material assets (.esmaterial)
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { ImporterData } from '../ImporterTypes';

export class MaterialImporter implements AssetImporter<ImporterData> {
    readonly type = 'material';
    readonly extensions = ['.esmaterial'];

    defaultSettings(): ImporterData {
        return {};
    }

    settingsUI(): ImporterField[] {
        return [];
    }
}
