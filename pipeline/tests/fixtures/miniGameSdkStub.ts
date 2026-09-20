// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A stub SDK exporting what a generated mini-game entry imports.
 *
 * The entry's import list comes from the vendor profile, so this derives from
 * the same profile: eight tests had each written the stub by hand, and adding
 * `platformInit` to the profile broke every one of them at once — which is the
 * fixture telling the truth, but eight times.
 */
import type { MiniGameExportProfile } from '../../src/export/miniGameExportProfile';

/**
 * Source for `<sdkDir>/<entry>.js`. `extra` names anything a particular test's
 * project imports beyond the entry's own list (`defineComponent`, say).
 */
export function miniGameSdkStub(profile: MiniGameExportProfile, extra: readonly string[] = []): string {
  const named = [profile.runtimeInit, profile.platformInit, ...extra].filter((n): n is string => !!n);
  return `${named.map((n) => `export function ${n}(){return Promise.resolve();}`).join('\n')}\n`;
}
