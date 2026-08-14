// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a packaging target is CALLED, in the reader's language.
 *
 *        Separate from platforms.ts, which is deliberately free of i18n so the
 *        electron main process and the tests can read it — and separate from the
 *        build dialog, which is no longer the only surface that has to name a
 *        target: settings search reports which target a row belongs to, and it
 *        should say "Desktop", not `desktop`.
 *
 *        A project's own platform is not here (only the project knows its name);
 *        callers pass the label the profile declared, and the id is the floor.
 */
import { BUILTIN_PLATFORMS, type ExportPlatform } from '../../../pipeline/src/project/platforms';
import { t } from '@/i18n';

const BUILTIN_LABEL: Record<string, string> = {
  web: t('build.plat.web'),
  desktop: t('build.plat.desktop'),
  wechat: t('build.plat.wechat'),
  playable: t('build.plat.playable'),
  android: t('build.plat.android'),
  ios: t('build.plat.ios'),
};

/** The display name for a target. Falls back to the id, which is what a project
 *  platform without a declared label is known by anyway. */
export function platformLabel(id: ExportPlatform): string {
  return BUILTIN_LABEL[id] ?? id;
}

/** The built-ins that have no label — empty, and asserted so by the tests. A
 *  target added to {@link BUILTIN_PLATFORMS} without one would otherwise appear
 *  under its raw id in a dialog nobody reopens after adding it. */
export function unlabeledBuiltins(): string[] {
  return BUILTIN_PLATFORMS.filter((id) => !BUILTIN_LABEL[id]);
}
