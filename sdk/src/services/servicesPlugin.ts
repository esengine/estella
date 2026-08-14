// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    servicesPlugin.ts
 * @brief   Installs the platform-services resources (Ads, Achievements, Identity).
 *
 * What is here is what the ENGINE owes a game on every platform. A service that
 * only some hosts have — a share sheet, a purchase, a friends board — is a
 * package (`estella-plugin-minigame-services`), built on the same platform
 * capabilities this file uses.
 *
 * The ads service is handed the app's clock and the audio device as two narrow
 * hooks, so a fullscreen takeover can pause the game it covers without the
 * service knowing the App.
 */
import type { App, Plugin } from '../app/app';
import { Audio } from '../audio';
import { Ads, AdsAPI } from './ads';
import { Achievements, AchievementsAPI } from './achievements';
import { Identity, IdentityAPI } from './identity';
import { createTakeover } from './takeover';
import { getPlatform } from '../platform';

export class ServicesPlugin implements Plugin {
    name = 'Services';
    readonly profileDomain = 'services';

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
        app.insertResource(Achievements, new AchievementsAPI());
        app.insertResource(Identity, new IdentityAPI());
    }
}

export const servicesPlugin = new ServicesPlugin();
