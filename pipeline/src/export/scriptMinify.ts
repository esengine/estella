// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export function minifiesScripts(opts: { minify?: boolean; minifyScripts?: boolean }): boolean {
  return opts.minify !== false && (opts.minifyScripts ?? true);
}
