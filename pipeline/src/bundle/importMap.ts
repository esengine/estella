// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  How `esengine` resolves inside a staged realm — the editor's play page
 *        and every shipped game share this one map, so a game runs against the
 *        layout it was previewed on.
 *
 *        Subpath exports are listed file by file: an import map does not append
 *        `/index.js` for a directory. The list is esengineResolve's, so the two
 *        strategies cannot name different subpaths.
 */
import { createHash } from 'node:crypto';
import { ESENGINE_SUBPATHS } from './esengineResolve';

/** Where the exporter stages the SDK, relative to the page. */
const STAGED = './sdk/';

export const IMPORT_MAP = {
  imports: {
    esengine: `${STAGED}index.js`,
    ...Object.fromEntries(
      Object.entries(ESENGINE_SUBPATHS).map(([specifier, rel]) => [specifier, STAGED + rel]),
    ),
  } as Record<string, string>,
};

export const IMPORT_MAP_JSON = JSON.stringify(IMPORT_MAP);

/** The inline `<script type=importmap>` is an inline script, so a page's CSP has
 *  to allow it by hash rather than by `unsafe-inline`. */
export const IMPORT_MAP_CSP_HASH = `sha256-${createHash('sha256').update(IMPORT_MAP_JSON).digest('base64')}`;
