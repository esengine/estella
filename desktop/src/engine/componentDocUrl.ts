// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { COMPONENT_DOC_PATHS } from './componentDocs.generated';
import type { EditorLocale } from '@/i18n';

/** Where the published manual lives. The docs are not shipped inside the app. */
const DOCS_ROOT = 'https://estellaengine.com/docs';

/**
 * The manual page for a component, in the editor's own language — or null when
 * the engine has no such component (a project's own script-defined one, which
 * the manual cannot document).
 *
 * The path half is generated from the docs' curated table by
 * `tools/component-reference.mjs`, so the header link and the reference page can
 * never disagree about where a component is written up; `--check` fails when a
 * component gains or loses an entry.
 */
export function componentDocUrl(component: string, locale: EditorLocale): string | null {
  const path = COMPONENT_DOC_PATHS[component];
  if (!path) return null;
  return `${DOCS_ROOT}/${locale === 'zh-CN' ? 'zh-cn/' : ''}${path}`;
}
