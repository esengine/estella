// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  history.ts — the History panel: the undo timeline, with an agent run
 *        folded into one row.
 */
import { defineMessages } from './types';

export const historyMessages = defineMessages({
    'hist.panelTitle': { en: 'History', zh: '历史' },
    'hist.open': { en: 'History', zh: '历史' },
    'hist.empty': { en: 'Nothing has happened yet', zh: '还没有任何操作' },
    'hist.empty.hint': {
        en: 'Every edit lands here in order. An agent run folds into one row you can take back whole.',
        zh: '每一次编辑都会按顺序记在这里。Agent 的一轮会折叠成一条,可以整条撤回。',
    },
    'hist.turn': { en: 'Agent · {prompt}', zh: 'Agent · {prompt}' },
    // A run whose steps declared nothing still says how many it took, rather
    // than showing an empty list that reads as "it did nothing".
    'hist.turn.silent': {
        en: '{count} steps, none of which said what they changed',
        zh: '{count} 步,但都没有声明改了什么',
    },
    'hist.revert': { en: 'Revert', zh: '撤回' },
    'hist.revert.why': {
        en: 'Take the whole run back — the scene edits and the files it wrote.',
        zh: '整轮撤回 —— 场景改动和它写的文件一起。',
    },
});
