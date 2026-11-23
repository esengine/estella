// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import { disposeAll } from '../util/disposeAll';
import { log } from '../util/logger';

/** Resources a game host owns while bringing up one game. @experimental */
export interface GameStartup {
    /** Release a resource if startup fails. Call the returned function when ownership transfers.
     *  Outstanding callbacks run in reverse acquisition order. */
    onFailure(release: () => void): () => void;
    /** Quit the App this factory returned if a later startup step fails. */
    createApp(build: () => App): App;
}

/** Bring up a game and return the host's result. Failed startup releases only the resources
 *  this invocation acquired, preserving the reason startup failed. @experimental */
export async function runGameStartup<T>(start: (startup: GameStartup) => Promise<T>): Promise<T> {
    let releases: Array<() => void> | undefined = [];
    let failure: { reason: unknown } | undefined;
    const onFailure = (release: () => void): (() => void) => {
        let owned = true;
        if (releases) releases.push(() => { if (owned) release(); });
        else if (failure) {
            // A sibling acquired this resource after the rest of startup had already failed.
            try { release(); }
            catch (error) { log.warn('runtime', 'Failed to release a late startup resource', error); }
        }
        return () => { owned = false; };
    };
    try {
        return await start({
            onFailure,
            createApp(build) {
                if (!releases) throw failure ? failure.reason : new Error('Game startup has finished');
                const app = build();
                const life = app.signal;
                onFailure(() => { if (app.signal === life) app.quit(); });
                return app;
            },
        });
    } catch (error) {
        failure = { reason: error };
        const acquired = releases;
        releases = undefined;
        try { disposeAll(acquired, release => release(), true); }
        catch (releaseError) { log.warn('runtime', 'Failed to release game startup resources', releaseError); }
        throw error;
    } finally {
        releases = undefined;
    }
}
