import type { AssetImporter, ImporterField } from '../ImporterRegistry';

interface TimelineImporterSettings {
    fps: number;
}

export class TimelineImporter implements AssetImporter<TimelineImporterSettings> {
    readonly type = 'timeline';
    readonly extensions = ['.estimeline'];

    defaultSettings(): TimelineImporterSettings {
        return { fps: 24 };
    }

    settingsUI(current: TimelineImporterSettings): ImporterField[] {
        return [
            {
                name: 'fps',
                label: 'Frame Rate',
                type: 'select',
                value: current.fps,
                options: [
                    { label: '24 FPS', value: 24 },
                    { label: '30 FPS', value: 30 },
                    { label: '60 FPS', value: 60 },
                ],
            },
        ];
    }
}
