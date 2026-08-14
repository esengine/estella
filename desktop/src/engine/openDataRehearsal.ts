// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The open data context, rehearsed in the play realm.
 *
 * On a mini-game host the context is a second JS runtime holding the player's
 * friends: the game posts a message in, it draws on a shared canvas, and there
 * is no channel back. The editor is not that host — so it stands in for one,
 * running the project's OWN context file against invented friends.
 *
 * What that buys is that nothing here knows what a leaderboard is. Whatever the
 * project points `open-data/index.ts` at — this engine's package, a third
 * party's, its own — is what plays here, through the capability seam a device
 * would use.
 */

/** One invented friend, in the shape every vendor reports. */
interface RehearsalPlayer {
  nickname: string;
  openid: string;
  KVDataList: Array<{ key: string; value: string }>;
}

/** Names that cannot be mistaken for a real friends list. The player's own row
 *  is not here — it is built from what the game actually submitted. */
const INVENTED: ReadonlyArray<{ nickname: string; openid: string; score: number }> = [
  { nickname: 'Sample Friend', openid: 'rehearsal-2', score: 15250 },
  { nickname: 'Another Tester', openid: 'rehearsal-3', score: 9870 },
  { nickname: 'Someone Else', openid: 'rehearsal-4', score: 6120 },
  { nickname: 'Never Played', openid: 'rehearsal-5', score: Number.NaN },
];

const SELF_ID = 'rehearsal-self';
/** The host's word for "whoever is playing" in an openIdList. */
const SELF = 'selfOpenId';

/** What a rehearsed context answers with, and what the platform then reports. */
export interface OpenDataRehearsal {
  /** The shared canvas, for `openDataCanvas()`. */
  canvas: HTMLCanvasElement;
  /** Deliver one message, as `openDataPostMessage()` does. */
  post(message: Record<string, unknown>): void;
  /** Record this player's own cloud rows, as `setCloudKeyValues()` does — the
   *  context reads them back, so a submitted score reaches the board. */
  write(entries: Readonly<Record<string, string>>): void;
}

/**
 * Run `source` (a bundled context) against a stand-in host.
 *
 * The host arrives as `globalThis.wx` for the length of the evaluation, because
 * that is how a context written for a device reads it — and is removed straight
 * after, since a `wx` left behind is a platform everything else would sniff.
 */
export function rehearseOpenData(source: string, width = 360, height = 260): OpenDataRehearsal {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  let handler: ((message: unknown) => void) | null = null;
  const selfKV: Record<string, string> = {};

  const host = {
    getSharedCanvas: () => canvas,
    getFriendCloudStorage: (opts: {
      keyList: string[];
      success?: (res: { data: RehearsalPlayer[] }) => void;
    }) => {
      const key = opts.keyList[0] ?? '';
      // The invented rows are re-keyed to whatever the game asked for: a game
      // with its own key would otherwise rehearse against an empty board and
      // reasonably read that as "this is broken".
      const friends: RehearsalPlayer[] = INVENTED.map((f) => ({
        nickname: f.nickname,
        openid: f.openid,
        KVDataList: Number.isNaN(f.score) ? [] : [{ key, value: String(f.score) }],
      }));
      const own = Object.entries(selfKV).map(([k, value]) => ({ key: k, value }));
      opts.success?.({ data: [{ nickname: 'You', openid: SELF_ID, KVDataList: own }, ...friends] });
    },
    getUserInfo: (opts: { openIdList: string[]; success?: (res: { data: Array<{ openid?: string }> }) => void }) => {
      opts.success?.({ data: opts.openIdList.map((id) => ({ openid: id === SELF ? SELF_ID : id })) });
    },
    createImage: () => new Image(),
    onMessage: (cb: (message: unknown) => void) => { handler = cb; },
    selfOpenId: SELF_ID,
  };

  const scope = globalThis as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(scope, 'wx');
  const previous = scope.wx;
  scope.wx = host;
  try {
    new Function(source)();
  } finally {
    if (had) scope.wx = previous;
    else delete scope.wx;
  }

  return {
    canvas,
    post: (message) => { handler?.(message); },
    write: (entries) => { Object.assign(selfKV, entries); },
  };
}
