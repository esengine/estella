/**
 * @file    SceneImporter.ts
 * @brief   Importer for scene assets (.esscene)
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { SceneImporterSettings } from '../ImporterTypes';
import { createDefaultSceneImporter } from '../ImporterTypes';

export class SceneImporter implements AssetImporter<SceneImporterSettings> {
    readonly type = 'scene';
    readonly extensions = ['.esscene'];

    defaultSettings(): SceneImporterSettings {
        return createDefaultSceneImporter();
    }

    settingsUI(current: SceneImporterSettings): ImporterField[] {
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
