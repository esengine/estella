// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    opendata/index.ts
 * @brief   The built-in leaderboard's ENTRY, as it runs inside the open data
 *          context: find the host global, hand it to a board, subscribe.
 *
 * That is all this file does, because it is the only part that cannot run
 * anywhere else. Everything the board actually is lives in `board.ts`, where
 * the editor's play mode can run the same code against an offscreen canvas —
 * a rehearsal that drew a different board would rehearse nothing.
 *
 * This file is not part of the engine and must never import it. The context is
 * a second JS runtime with no WebGL, no wasm, no DOM and almost none of the
 * host API; `opendata.test.ts` enforces the boundary, because the cost of
 * getting it wrong is a package that builds and then fails on a device.
 *
 * It ships as its own bundle (`dist/open-data.js`) and the exporter uses it
 * when a project supplies no `open-data/index.ts` of its own.
 *
 * Nothing here can be interactive: no pointer or key event reaches this
 * runtime, so there is no scrolling, no paging and no row you can tap.
 */
import { createBoard, type BoardHost } from './board';

const host = (globalThis as unknown as { wx?: BoardHost; tt?: BoardHost }).wx
    ?? (globalThis as unknown as { tt?: BoardHost }).tt;

if (host) {
    const board = createBoard(host);
    (host as BoardHost & { onMessage?(cb: (m: unknown) => void): void })
        .onMessage?.call(host, (m) => { board.handle(m); });
}
