// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  entry.ts — the `esengine/ai` entry: the barrel, and the call that installs it.
 *
 * The call is here and not at the end of `./index` because other modules import that barrel, and a barrel other modules
 * import is merged into a shared chunk — where a bundler that treats chunks as side-effect free drops a top-level call.
 * An entry module's own statements are kept. See timeline/entry.ts.
 */
export * from './index';

import { registerAiSupport } from './aiSupport';

registerAiSupport();
