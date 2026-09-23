// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  index.ts — the share sheet, the purchase, the friends board and the recorder.
 *
 * Share, payment and the recorder are façades over host capabilities and cost nothing per
 * frame. The leaderboard costs one boolean: the canvas it shows is drawn by
 * another runtime on its own schedule, so while a board is up it has to be
 * re-taken, and nothing can tell us when it changed.
 */
import { Schedule, defineSystem, type App, type Plugin } from 'esengine';
import { Share, ShareAPI } from './share';
import { Payment, PaymentAPI } from './payment';
import { Leaderboard, LeaderboardAPI } from './leaderboard';
import { Recorder, RecorderAPI } from './recorder';

export { Share, ShareAPI, type ShareCard } from './share';
export { Payment, PaymentAPI, type PaymentRequest, type PaymentFailure } from './payment';
export {
  Leaderboard, LeaderboardAPI,
  type LeaderboardOptions, type LeaderboardScope, type LeaderboardStyle,
} from './leaderboard';
export {
  Recorder, RecorderAPI,
  type Recording, type RecordingShareCard, type RecorderState, type RecordOptions,
} from './recorder';

export class MiniGameServicesPlugin implements Plugin {
  name = 'MiniGameServices';

  build(app: App): void {
    app.insertResource(Share, new ShareAPI());
    app.insertResource(Payment, new PaymentAPI());
    app.insertResource(Recorder, new RecorderAPI());
    // The App is resolved per call, not captured: the wasm module is attached
    // after the plugins have built.
    const board = new LeaderboardAPI(() => app);
    app.insertResource(Leaderboard, board);

    // Last in the frame: the other runtime draws on its own schedule, so the
    // freshest canvas is the one that exists after everything else has run.
    app.addSystemToSchedule(Schedule.Last, defineSystem(
      [],
      () => { board.sample(); },
      { name: 'LeaderboardSample' },
    ));
  }
}

export const miniGameServicesPlugin = new MiniGameServicesPlugin();
