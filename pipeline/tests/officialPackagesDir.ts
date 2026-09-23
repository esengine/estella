// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The repo's `plugins/`, which is what a packaged editor ships as its
 *        official packages.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OFFICIAL_PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins');
