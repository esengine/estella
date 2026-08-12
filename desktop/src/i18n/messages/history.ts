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
    // Going back past an agent run hands its held copies back, and they cannot
    // be re-applied — so this one stops and says how far it reaches.
    'hist.rewind.title': {
        en: 'Go back past {runs} agent run(s)?',
        zh: '要退到 {runs} 轮 Agent 工作之前吗?',
    },
    'hist.rewind.body': {
        en: 'The scene goes back, and {files} project file(s) go back with it. This one cannot be redone — the copies held for those runs are handed back.',
        zh: '场景会回退,{files} 个项目文件也一起回退。这一步无法重做 —— 为那几轮留的备份会被交还。',
    },
    'hist.rewind.stranded': {
        en: 'These were too large to hold and will stay as they are: {paths}',
        zh: '这些太大没留备份,会保持现状:{paths}',
    },
    'hist.rewind.go': { en: 'Go back', zh: '退回' },
    // Promoting a claim a run proved into one the project makes.
    'hist.keep': { en: 'Keep this check', zh: '保留这条检查' },
    'hist.keep.why': {
        en: 'Every later run is measured against it, and no run can weaken or remove it.',
        zh: '之后每一轮都要过这一条,而且没有哪一轮能弱化或删掉它。',
    },
    'hist.keep.kept': { en: 'The project checks this from now on', zh: '从现在起项目会检查这一条' },
    'hist.keep.failed': { en: 'Could not write it to the project', zh: '没能写进项目' },
    // Shorter than the sentence the MODEL reads: the row already says whose
    // check it is, and repeating "the editor" beside "编辑器的" reads as a stutter.
    'hist.check.diagnostics': { en: 'nothing is flagged in the scene', zh: '场景里没有标出问题' },
    'hist.check.scripts': { en: 'the scripts compile', zh: '脚本能编译' },
    'hist.owner.project': { en: "the project's", zh: '项目的' },
    'hist.owner.editor': { en: 'the editor’s', zh: '编辑器的' },
    'hist.revert.why': {
        en: 'Take the whole run back — the scene edits and the files it wrote.',
        zh: '整轮撤回 —— 场景改动和它写的文件一起。',
    },
});
