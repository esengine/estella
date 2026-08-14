// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    protocol.ts
 * @brief   What the main domain says to the open data context.
 *
 * The two halves run in different JS runtimes and share nothing else — the
 * context has no engine, no wasm and no WebGL, and there is no channel back
 * from it. All they have is `postMessage`, so all they can agree on is a
 * message shape, and this file is that agreement.
 *
 * Types only, deliberately. It is imported by BOTH halves, and an import that
 * survived into the context's bundle would be the engine arriving in a runtime
 * that cannot run it — see the guard in `opendata.test.ts`.
 */

/** Which board to draw. `friends` is the only one every host has. */
export type LeaderboardScope = 'friends' | 'group';

/** How the built-in renderer should look. Everything optional: a game that
 *  says nothing gets a board that matches the editor's own dark surface. */
export interface LeaderboardStyle {
    /** Page background. Transparent by default, so the board sits on the game. */
    background?: string;
    /** Row text. */
    color?: string;
    /** The row belonging to this player. */
    selfColor?: string;
    /** Row separators; absent draws none. */
    lineColor?: string;
    /** Row height in CSS px (the canvas is sized by the host). */
    rowHeight?: number;
    fontSize?: number;
    fontFamily?: string;
    /** Draw the player's avatar at the start of the row. */
    avatars?: boolean;
}

/**
 * Draw the board.
 *
 * `key` is the cloud-storage key the scores live under — the same one
 * `Leaderboard.submit` writes, which is why the service fills it in rather than
 * the game repeating it.
 */
export interface ShowMessage {
    kind: 'show';
    key: string;
    scope: LeaderboardScope;
    /** Rows to draw at most. The context's canvas is a fixed size and a board
     *  that scrolls is a board that needs input it cannot receive. */
    limit: number;
    /** Sort descending (a high score) or ascending (a best time). */
    order: 'desc' | 'asc';
    style: LeaderboardStyle;
    /** Device pixel ratio, so text is not soft on a phone. The context cannot
     *  ask — `getSystemInfoSync` is not one of the APIs it is given. */
    dpr: number;
}

/** Clear the canvas. The main domain stops sampling after this, so a context
 *  that ignored it would leave the last frame on a texture nobody updates. */
export interface HideMessage {
    kind: 'hide';
}

/** Everything the main domain can send. A context that does not recognise a
 *  message must ignore it: an older game package can be running against a
 *  newer host, and a throw in that runtime is invisible from this one. */
export type OpenDataMessage = ShowMessage | HideMessage;

/** The channel's name in both directions of the codebase, so a search for it
 *  finds the sender and the receiver. */
export const OPEN_DATA_CHANNEL = 'estella.leaderboard' as const;
