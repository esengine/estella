// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    aiSuggest.ts
 * @brief   Suggestion items for the FSM/BT editors' action & condition fields:
 *          the aiRegistry names, decorated with editor-side i18n descriptions
 *          for the engine builtins. Descriptions live HERE (not in the sdk
 *          registry) so they are bilingual via the editor's own i18n — the
 *          same display-side-label precedent as the asset importer.
 */
import { aiRegistry } from 'esengine';
import { t } from '@/i18n';
import type { SuggestItem } from './SuggestInput';

// What each engine builtin does — keyed by registered name. A name the table
// doesn't know (game-registered) simply shows without a description.
const BUILTIN_DESC: Record<string, () => string> = {
  'timeline.play': () => t('ai.desc.timelinePlay'),
  'timeline.pause': () => t('ai.desc.timelinePause'),
  'timeline.finished': () => t('ai.desc.timelineFinished'),
};

const decorate = (names: string[]): SuggestItem[] =>
  names.map((value) => ({ value, desc: BUILTIN_DESC[value]?.() }));

/** Action-name suggestions (FSM state hooks, BT action nodes). */
export function aiActionItems(): SuggestItem[] {
  return decorate(aiRegistry.actionNames());
}

/** Condition-name suggestions (FSM transitions, BT condition nodes). */
export function aiConditionItems(): SuggestItem[] {
  return decorate(aiRegistry.conditionNames());
}
