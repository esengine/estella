// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WeChatSocket.ts
 * @brief   WeChat's binding of the mini-game family socket.
 *
 * @deprecated Use {@link MiniGameSocket}, which takes the host global explicitly
 * and serves every vendor of the family. This subclass only reads `wx` off the
 * global scope for callers that constructed it by name.
 */
import { MiniGameSocket } from './MiniGameSocket';
import type { MiniGameGlobal } from '../platform/minigame/api';
import type { GameSocketOptions } from './GameSocket';

export class WeChatSocket extends MiniGameSocket {
    constructor(options: GameSocketOptions) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        super(options, (globalThis as any).wx as MiniGameGlobal);
    }
}
