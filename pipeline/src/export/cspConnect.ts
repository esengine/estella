// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  cspConnect.ts — the addresses a web build may open connections to.
 *
 * The exported page's Content-Security-Policy lets a game talk only to the page it came from, which is
 * right for a game with no server and wrong for one that has. A project lists the origins its game connects
 * to (`packaging.platforms.web.connect`), and each becomes a `connect-src` source. The list is checked
 * rather than pasted in: an entry with a space, a semicolon or a quote could end the directive and start
 * another, so a policy is only ever made of what this accepts.
 */

const SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

/**
 * One entry as a CSP source: a bare scheme (`wss:`, any secure WebSocket) or an origin
 * (`wss://play.example.com`, with an optional port, or `:*` for any). Anything else — a path, a query, a wildcard host, a
 * different scheme — throws, naming the entry.
 */
export function cspConnectSource(entry: string): string {
  let text = entry.trim();
  if (SCHEMES.has(text)) return text;
  // Any port on a host (a server whose port is not fixed, such as a test one): the one wildcard accepted.
  const anyPort = text.endsWith(':*');
  if (anyPort) text = text.slice(0, -2);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`web.connect: "${entry}" is not an origin such as wss://play.example.com`);
  }
  if (!SCHEMES.has(url.protocol)) throw new Error(`web.connect: "${entry}" must start with http://, https://, ws:// or wss://`);
  if (url.hostname === '' || url.username !== '' || url.password !== '') throw new Error(`web.connect: "${entry}" must be a host, with no sign-in in it`);
  // An origin has nothing after the host and port. The URL parser adds a "/" to an empty path.
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '' || /[\s;,'"*]/.test(text)) {
    throw new Error(`web.connect: "${entry}" must be only an origin (scheme, host and optional port), with no path, wildcard or extra characters`);
  }
  if (anyPort && /:\d+$/.test(text)) throw new Error(`web.connect: "${entry}" names a port and also asks for any port`);
  return anyPort ? `${url.origin}:*` : url.origin;
}

/** The list as it goes into the policy: each entry checked, duplicates dropped, order kept. */
export function cspConnectSources(entries: readonly string[] | undefined): string[] {
  return [...new Set((entries ?? []).map(cspConnectSource))];
}
