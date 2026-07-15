// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  mimeTypes.ts — one content-type table for every place the editor SERVES
 *        bytes over an http-like response: the `estella://` project scheme, the
 *        `app://` renderer scheme, and the loopback preview server ({@link
 *        ./exportPreview}). It is a superset of documents/scripts/wasm/images/
 *        audio/fonts so a build's index.html, its wasm glue, and its assets all
 *        get the right type from a single source (they used to drift across three
 *        hand-kept maps). Not the same concern as exportPlayable's data-URL MIME
 *        (which inlines assets) — that stays local to that path.
 */
import path from 'node:path';

const HTTP_MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  css: 'text/css', json: 'application/json', map: 'application/json',
  wasm: 'application/wasm', txt: 'text/plain', fnt: 'text/plain',
  esscene: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ktx2: 'image/ktx2', ico: 'image/x-icon',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime',
  ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2',
};

/** Content-type for a file path (or bare extension); octet-stream when unknown. */
export function httpContentType(pathOrExt: string): string {
  const ext = (path.extname(pathOrExt).slice(1) || pathOrExt).toLowerCase();
  return HTTP_MIME[ext] ?? 'application/octet-stream';
}
