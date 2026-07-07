// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../app';
import { Schedule } from '../system';
import { Assets } from '../asset/AssetPlugin';
import { PostProcess, PostProcessApi } from './PostProcessAPI';
import { postProcessVolumeSystem, cleanupVolumeSystem, setVolumeTextureResolver, PostProcessVolumeConfigResource } from './volumeSystem';

export class PostProcessPlugin implements Plugin {
    name = 'postProcess';

    build(app: App): void {
        // Per-App post-process API, injected into the render pipeline as an
        // optional stage (the pipeline has no hard dependency on it).
        const api = new PostProcessApi();
        app.insertResource(PostProcess, api);
        app.pipeline?.setPostProcess(api);

        app.insertResource(PostProcessVolumeConfigResource, { enabled: true });
        // Effect texture params (LUTs, masks) resolve through this App's Assets;
        // PostProcessVolume's discoverAssets preloads the refs, so this is a
        // cache lookup by the time a volume applies.
        setVolumeTextureResolver((ref) =>
            app.hasResource(Assets) ? (app.getResource(Assets).getTexture(ref)?.handle ?? 0) : 0);
        app.addSystemToSchedule(Schedule.PostUpdate, postProcessVolumeSystem);
    }

    cleanup(app?: App): void {
        if (app?.hasResource(PostProcess)) {
            cleanupVolumeSystem(app.getResource(PostProcess));
        }
    }
}

export const postProcessPlugin = new PostProcessPlugin();
