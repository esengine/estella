import type { App, Plugin } from '../app';
import { Schedule } from '../system';
import { PostProcess } from './PostProcessAPI';
import { cleanupAllPostProcessVolumes } from './sync';
import { postProcessVolumeSystem, cleanupVolumeSystem, PostProcessVolumeConfigResource } from './volumeSystem';

export class PostProcessPlugin implements Plugin {
    name = 'PostProcessPlugin';

    build(app: App): void {
        app.insertResource(PostProcessVolumeConfigResource, { enabled: true });
        app.addSystemToSchedule(Schedule.PostUpdate, postProcessVolumeSystem);
    }

    cleanup(): void {
        cleanupAllPostProcessVolumes();
        cleanupVolumeSystem();
        PostProcess.setScreenStack(null);
    }
}

export const postProcessPlugin = new PostProcessPlugin();
