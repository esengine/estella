/**
 * @file    AudioImporter.ts
 * @brief   Importer for audio assets (mp3, wav, ogg)
 */

import type { AssetImporter, ImporterField } from '../ImporterRegistry';
import type { AudioImporterSettings } from '../ImporterTypes';
import { createDefaultAudioImporter } from '../ImporterTypes';

export class AudioImporter implements AssetImporter<AudioImporterSettings> {
    readonly type = 'audio';
    readonly extensions = ['.mp3', '.wav', '.ogg'];

    defaultSettings(): AudioImporterSettings {
        return createDefaultAudioImporter();
    }

    settingsUI(current: AudioImporterSettings): ImporterField[] {
        return [
            {
                name: 'sampleRate',
                label: 'Sample Rate',
                type: 'select',
                value: current.sampleRate,
                options: [
                    { label: '22050 Hz', value: 22050 },
                    { label: '44100 Hz', value: 44100 },
                    { label: '48000 Hz', value: 48000 },
                ],
            },
            {
                name: 'channels',
                label: 'Channels',
                type: 'select',
                value: current.channels,
                options: [
                    { label: 'Mono', value: 1 },
                    { label: 'Stereo', value: 2 },
                ],
            },
            {
                name: 'quality',
                label: 'Quality',
                type: 'slider',
                value: current.quality,
                min: 0.1,
                max: 1.0,
                step: 0.1,
            },
        ];
    }
}
