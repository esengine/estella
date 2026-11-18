// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    serverAddress.ts
 * @brief   Where a web client finds its game server. A deployed game serves its page and its server
 *          from one origin (`estella export --platform server` writes the proxy that does so), so the
 *          address is the page's own host at the server's path, over `wss:` when the page came over
 *          `https:`. A page served from somewhere else (GitHub Pages, a desktop app) carries its
 *          server's address instead: the project's `server.url`, which the export writes into the page as
 *          `<meta name="estella-server">`. A `?server=` in the page's address overrides both, for a
 *          server run somewhere else while developing.
 */

export interface ServerAddressOptions {
    /** The server's WebSocket path, as the project's `server.path` names it: `/sector`. */
    path: string;
    /** The page's query string. Default: `location.search` where there is a page. */
    search?: string;
    /** The page's location. Default: `globalThis.location`; a mini-game has none. */
    location?: { protocol: string; host: string } | null;
    /** The query parameter that overrides the address. Default `server`. */
    param?: string;
    /** The address the build carries. Default: the page's `<meta name="estella-server">`, where there is a page. */
    built?: string | null;
}

/** What the export wrote into the page, if it wrote anything. */
function builtAddress(): string | null {
    const doc = (globalThis as { document?: { querySelector?(s: string): { getAttribute(n: string): string | null } | null } }).document;
    return doc?.querySelector?.('meta[name="estella-server"]')?.getAttribute('content') ?? null;
}

const WS = /^wss?:\/\/[^\s/?#]+/;

const PATH = /^\/[A-Za-z0-9._~\-/]*$/;

/**
 * The WebSocket address to dial: `?server=`, else the address the build carries, else the page's own host at
 * `path`; or `null` when there is none of these (a mini-game, a file opened from disk), where the game has to
 * name its server itself. A `?server=` that is not a `ws://` or `wss://` address is ignored rather than dialled.
 */
export function serverAddress(options: ServerAddressOptions): string | null {
    if (!PATH.test(options.path)) throw new Error(`serverAddress: path "${options.path}" must start with / and hold no spaces or query`);
    type Where = { protocol: string; host: string; search?: string };
    const here: Where | null = options.location === undefined ? (globalThis as { location?: Where }).location ?? null : options.location;
    const search = options.search ?? here?.search ?? '';
    const given = new URLSearchParams(search).get(options.param ?? 'server');
    if (given && WS.test(given)) return given;
    const built = options.built === undefined ? builtAddress() : options.built;
    if (built && WS.test(built)) return built;
    if (!here || !here.host || (here.protocol !== 'https:' && here.protocol !== 'http:')) return null;
    return `${here.protocol === 'https:' ? 'wss:' : 'ws:'}//${here.host}${options.path}`;
}
