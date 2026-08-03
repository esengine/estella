// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    servicesPlugin.ts
 * @brief   Installs the platform-services resources (Ads, Share).
 *
 * Resources only — no systems, no per-frame cost. The ads service is handed
 * the app's clock and the audio device as two narrow hooks, so a fullscreen
 * takeover can pause the game it covers without the service knowing the App.
 */
import type { App, Plugin } from '../app/app';
import { Audio } from '../audio';
import { Ads, AdsAPI } from './ads';
import { Share, ShareAPI } from './share';

export class ServicesPlugin implements Plugin {
    name = 'Services';

    build(app: App): void {
        app.insertResource(Ads, new AdsAPI({
            setPaused: (p) => app.setPaused(p),
            isPaused: () => app.isPaused(),
            // Resolved per call: the audio plugin builds in the same pass and
            // insertion order must not matter. A host with no audio device has
            // a Null backend behind the same API — suspending silence is free.
            suspendAudio: () => app.getResource(Audio)?.suspend(),
            resumeAudio: () => app.getResource(Audio)?.resume(),
        }));
        app.insertResource(Share, new ShareAPI());
    }
}

export const servicesPlugin = new ServicesPlugin();
