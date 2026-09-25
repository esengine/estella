// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  debugChannelProtocol.ts — what a development build and the editor say to
 *        each other. Its own module so the core can name the protocol without
 *        carrying the channel.
 */
import type { ConsoleLevel } from './consoleForward';

export const DEBUG_CHANNEL_PROTOCOL = 1;

/** The editor's address as a development export writes it into the config. */
export interface DebugChannelConfig {
    /** `ws://<editor host>:<port>/?token=<token>` */
    url: string;
    /** The project the build was made from, so the editor can tell a build of
     *  another project from one of the project it has open. */
    project?: string;
}

/** What `control` changes; each field absent leaves that setting alone. */
export interface DebugControl {
    paused?: boolean;
    /** Advance this many frames — a paused game included. */
    step?: number;
    /** A cap on the frame rate; 0 lifts it. */
    fps?: number;
}

export type DebugChannelQuery =
    | { t: 'query'; reqId: number; kind: 'frameCapture' }
    | { t: 'query'; reqId: number; kind: 'frameReplay'; drawIndex: number; maxSide?: number }
    | { t: 'query'; reqId: number; kind: 'stats' }
    | { t: 'query'; reqId: number; kind: 'snapshot'; selectedId: number | null; withTree: boolean }
    | ({ t: 'query'; reqId: number; kind: 'control' } & DebugControl);

/**
 * What a device sends. A replay's pixels follow their `reply` as binary frames,
 * `pixels` of them: text would add a third to every byte, and a mini-game host's
 * socket drops a frame the size of a whole screen. Lines go in batches, since a
 * host that traces its own every call prints thousands a second.
 */
export type DebugChannelMessage =
    | { t: 'hello'; v: number; platform: string; title: string; project: string | null; revision: string | null }
    | { t: 'reply'; reqId: number; data: unknown; pixels?: number }
    | { t: 'reply'; reqId: number; error: string }
    | { t: 'logs'; entries: Array<{ level: ConsoleLevel; line: string }> };
