// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  How `esengine` resolves inside a staged realm — the editor's play page
 *        and every shipped game share this one map, so a game runs against the
 *        layout it was previewed on.
 *
 *        Subpath exports are listed file by file: an import map does not append
 *        `/index.js` for a directory. Mirrors the SDK's `exports`.
 */
import { createHash } from 'node:crypto';

export const IMPORT_MAP = {
  imports: {
    esengine: './sdk/index.js',
    'esengine/spine': './sdk/spine/index.js',
    'esengine/dragonbones': './sdk/dragonbones/index.js',
    'esengine/physics': './sdk/physics/index.js',
    'esengine/wasm': './sdk/wasm.js',
    'esengine/factory': './sdk/webAppFactory.js',
  },
};

export const IMPORT_MAP_JSON = JSON.stringify(IMPORT_MAP);

/** The inline `<script type=importmap>` is an inline script, so a page's CSP has
 *  to allow it by hash rather than by `unsafe-inline`. */
export const IMPORT_MAP_CSP_HASH = `sha256-${createHash('sha256').update(IMPORT_MAP_JSON).digest('base64')}`;
