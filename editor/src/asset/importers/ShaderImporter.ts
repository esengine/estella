/**
 * @file    ShaderImporter.ts
 * @brief   Importer for shader assets (.esshader)
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { ImporterData } from '../ImporterTypes';

export class ShaderImporter implements AssetImporter<ImporterData> {
    readonly type = 'shader';
    readonly extensions = ['.esshader'];

    defaultSettings(): ImporterData {
        return {};
    }

    settingsUI(): ImporterField[] {
        return [];
    }
}
