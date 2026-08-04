// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    servicesPlugin.ts
 * @brief   Installs the platform-services resources (Ads, Share, Leaderboard).
 *
 * Resources, and one system that does nothing until it has to. Ads and Share
 * cost nothing per frame; the leaderboard has to re-take the open data
 * context's canvas while it is on screen, because that canvas is drawn by
 * another runtime and the engine has no way to be told it changed. So it is
 * sampled — but only between `show` and `hide`, which on every other frame is
 * one boolean.
 *
 * The ads service is handed the app's clock and the audio device as two narrow
 * hooks, so a fullscreen takeover can pause the game it covers without the
 * service knowing the App.
 */
import type { App, Plugin } from '../app/app';
import { Audio } from '../audio';
import { Schedule, defineSystem } from '../ecs/system';
import { Ads, AdsAPI } from './ads';
import { Share, ShareAPI } from './share';
import { Leaderboard, LeaderboardAPI } from './leaderboard';

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
        // Resolved per call rather than captured: the module is attached by
        // connectCpp, which can run after the plugins have built.
        app.insertResource(Leaderboard, new LeaderboardAPI(() => app.wasmModule));

        // Last in the frame: the other runtime draws on its own schedule, so
        // the freshest canvas is the one that exists after everything else has
        // run. Costs one boolean on a frame with no board up.
        app.addSystemToSchedule(Schedule.Last, defineSystem(
            [],
            () => { app.getResource(Leaderboard)?.sample(); },
            { name: 'LeaderboardSample' },
        ));
    }
}

export const servicesPlugin = new ServicesPlugin();
