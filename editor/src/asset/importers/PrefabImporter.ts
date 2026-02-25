/**
 * @file    PrefabImporter.ts
 * @brief   Importer for prefab assets (.esprefab)
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { PrefabImporterSettings } from '../ImporterTypes';
import { createDefaultPrefabImporter } from '../ImporterTypes';

export class PrefabImporter implements AssetImporter<PrefabImporterSettings> {
    readonly type = 'prefab';
    readonly extensions = ['.esprefab'];

    defaultSettings(): PrefabImporterSettings {
        return createDefaultPrefabImporter();
    }

    settingsUI(current: PrefabImporterSettings): ImporterField[] {
        return [
            {
                name: 'autoMigrate',
                label: 'Auto Migrate',
                type: 'boolean',
                value: current.autoMigrate,
            },
        ];
    }
}
