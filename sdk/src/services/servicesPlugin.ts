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
import { Achievements, AchievementsAPI } from './achievements';
import { Identity, IdentityAPI } from './identity';
import { Payment, PaymentAPI } from './payment';
import { createTakeover } from './takeover';
import { getPlatform } from '../platform';

export class ServicesPlugin implements Plugin {
    name = 'Services';

    build(app: App): void {
        // ONE ceremony for everything that covers the game. An ad and a store
        // overlay are the same event to a player, and they can overlap — the
        // overlay closing must not resume a game an ad is still covering.
        const takeover = createTakeover({
            setPaused: (p) => app.setPaused(p),
            isPaused: () => app.isPaused(),
            // Resolved per call: the audio plugin builds in the same pass and
            // insertion order must not matter. A host with no audio device has
            // a Null backend behind the same API — suspending silence is free.
            suspendAudio: () => app.getResource(Audio)?.suspend(),
            resumeAudio: () => app.getResource(Audio)?.resume(),
        });
        app.insertResource(Ads, new AdsAPI(takeover));
        // A takeover the game never asked for: the player pressed Shift+Tab. The
        // platform seam is absent everywhere but a store's own shell, and where
        // it is absent there is nothing that can cover the game.
        getPlatform().onStoreOverlay?.((covered) => {
            if (covered) takeover.begin(); else takeover.end();
        });
        app.insertResource(Share, new ShareAPI());
        app.insertResource(Achievements, new AchievementsAPI());
        app.insertResource(Identity, new IdentityAPI());
        app.insertResource(Payment, new PaymentAPI());
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
