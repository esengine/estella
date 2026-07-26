// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  paths.ts — where a project keeps its plugins, spelled ONCE.
 *
 * Both processes need it and neither can own it: main resolves it against the OS
 * separator to read the folder, while the renderer matches watcher paths (always
 * posix) against it. Two literals would drift the day one of them changed.
 */

/** Project-relative plugin folder, posix — the form watcher paths come in. */
export const PROJECT_PLUGIN_REL = '.esengine/plugins';

/** Folder (under the plugin dir) the editor writes plugin API typings into. */
export const PLUGIN_TYPES_DIR = '.types';

/** The generated typings file plugin tsconfigs point at. */
export const PLUGIN_TYPES_FILE = `${PROJECT_PLUGIN_REL}/${PLUGIN_TYPES_DIR}/editor-api.d.ts`;
