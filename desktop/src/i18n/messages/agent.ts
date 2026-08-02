// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  agent.ts — the built-in agent's surface: the drawer, the transcript,
 *        the decisions it asks you to make, and the checkpoint bar.
 */
import { defineMessages } from './types';

export const agentMessages = defineMessages({
    'agent.title': { en: 'Agent', zh: 'Agent' },
    'agent.open': { en: 'Agent: Open', zh: 'Agent：打开' },
    'agent.handOff': { en: 'Hand to Agent', zh: '交给 Agent' },
    'agent.handOff.sub': {
        en: 'reads the scene, may change it',
        zh: '会读场景、可能改动',
    },

    // — Drawer chrome —
    'agent.newConversation': { en: 'New conversation', zh: '新对话' },
    'agent.dock': { en: 'Move it into the layout', zh: '放进布局里' },
    'agent.close': { en: 'Close (Esc)', zh: '关闭 (Esc)' },
    'agent.compose': { en: 'Say something…  @ to reference an entity', zh: '说点什么…  用 @ 引用实体' },
    'agent.compose.busy': { en: 'It is working — this will be the next message…', zh: '正在干活,这条会排到下一轮…' },
    'agent.send': { en: 'Send', zh: '发送' },
    'agent.stop': { en: 'Stop', zh: '停止' },
    'agent.hint.send': { en: 'send', zh: '发送' },
    'agent.hint.newline': { en: 'new line', zh: '换行' },
    'agent.hint.close': { en: 'close', zh: '关闭' },
    'agent.hint.mention': { en: 'reference', zh: '引用' },
    'agent.mention': { en: 'Reference', zh: '引用' },

    // — Images the person attaches —
    'agent.attach.remove': { en: 'Remove', zh: '移除' },
    'agent.attach.hint': { en: 'drop or paste an image', zh: '拖入或粘贴图片' },

    // — Conversations this project has had —
    'agent.history.open': { en: 'Earlier conversations', zh: '历史对话' },
    'agent.history.title': { en: 'Earlier conversations', zh: '历史对话' },
    'agent.history.close': { en: 'Back (Esc)', zh: '返回 (Esc)' },
    'agent.history.none': {
        en: 'Nothing kept yet. A conversation is saved with the project once a run finishes.',
        zh: '还没有保存的对话。一轮跑完后,对话会随项目一起保存。',
    },
    'agent.history.untitled': { en: '(no question yet)', zh: '(还没有提问)' },
    'agent.history.turns': { en: '{count} runs', zh: '{count} 轮' },
    'agent.history.today': { en: 'today', zh: '今天' },
    'agent.history.yesterday': { en: 'yesterday', zh: '昨天' },
    'agent.history.forget': { en: 'Forget this conversation', zh: '删除这段对话' },
    'agent.history.currentNote': {
        en: 'The conversation on screen joins this list when its next run ends.',
        zh: '当前这段会在下一轮结束时进入列表。',
    },

    // — Ending a conversation, on purpose or as the price of a switch —
    'agent.new.title': { en: 'Start a new conversation?', zh: '开始新对话?' },
    'agent.new.body': {
        en: 'This one is dropped and the agent forgets what was said. What it changed in the scene stays.',
        zh: '当前这段会被丢弃,Agent 会忘掉说过的话。它对场景做过的改动仍然保留。',
    },
    'agent.new.confirm': { en: 'Start new', zh: '新建' },
    'agent.switch.title': { en: 'Switch to {model}?', zh: '切换到 {model}?' },
    'agent.switch.body': {
        en: 'A conversation belongs to the model that answered it, so this one ends here. What it changed in the scene stays.',
        zh: '一段对话属于回答它的那个模型,所以当前对话会在此结束。它对场景做过的改动仍然保留。',
    },
    'agent.switch.confirm': { en: 'Switch and start over', zh: '切换并重新开始' },

    // — Which model the next message runs on —
    'agent.picker.none': { en: 'Pick a model', zh: '选择模型' },
    'agent.picker.noKey': { en: 'no key', zh: '未配置密钥' },
    'agent.picker.configure': { en: 'Set it up in Settings…', zh: '去设置里配置…' },
    'agent.picker.custom': { en: 'Custom', zh: '自定义' },

    // — Empty states —
    'agent.empty.title': { en: 'Ask the agent to do something', zh: '让 Agent 帮你做点什么' },
    'agent.empty.body': {
        en: 'It can read the scene, change entities, and look at what it rendered. Its edits are bracketed by a checkpoint, so one Undo takes the whole turn back.',
        zh: '它能读场景、改实体、看渲染结果。改动会记一个检查点,一次撤销全退。',
    },
    'agent.empty.sug1': { en: 'Add a pause menu for the player', zh: '给玩家加一个暂停菜单' },
    'agent.empty.sug1.h': { en: 'creates UI entities', zh: '会新建 UI 实体' },
    'agent.empty.sug2': { en: 'Why is nothing showing in this scene?', zh: '这个场景为什么不显示?' },
    'agent.empty.sug2.h': { en: 'read-only, changes nothing', zh: '只读,不会改东西' },
    'agent.empty.sug3': { en: 'Give every button a nine-slice texture', zh: '把所有按钮换成九宫格贴图' },
    'agent.empty.sug3.h': { en: 'edits fields in bulk', zh: '会批量改字段' },
    'agent.nokey.title': { en: 'No model configured yet', zh: '还没有配置模型' },
    'agent.nokey.body': {
        en: 'The key lives in the system keychain — not in the project, not in the settings file, and never handed to this window.',
        zh: '密钥存在系统钥匙串里,不进项目、不进设置文件,也不会交给这个窗口。',
    },
    'agent.nokey.action': { en: 'Configure it in Settings', zh: '去设置里配置' },

    // — Transcript —
    'agent.waiting': { en: 'Waiting for the model', zh: '等待模型响应' },
    'agent.thinking': { en: 'Thinking', zh: '正在思考' },
    'agent.queued': { en: 'queued', zh: '排队中' },
    'agent.queued.msg': { en: 'Queued: {text}', zh: '已排队:{text}' },
    'agent.earlier': {
        en: '{count} earlier runs are no longer shown here',
        zh: '更早的 {count} 轮已不在此窗口',
    },
    // Once a conversation is past the threshold every further run folds exactly
    // one, so the singular is the COMMON case rather than the edge one.
    'agent.folded.one': {
        en: 'The earliest run was folded out of the model’s memory',
        zh: '最早的一轮已折叠出模型的记忆',
    },
    'agent.folded': {
        en: 'The earliest {count} runs were folded out of the model’s memory',
        zh: '最早的 {count} 轮已折叠出模型的记忆',
    },
    'agent.folded.why': {
        en: 'The conversation outgrew the context window. What you asked is kept word for word; the tool calls and their results are gone — have it re-read the scene rather than trusting what it said about them.',
        zh: '对话超出了上下文窗口。你问过的话原样保留,工具调用和结果已丢弃 —— 让它重新读一遍场景,别信它对那些内容的转述。',
    },
    'agent.context': { en: '{pct}% context', zh: '上下文 {pct}%' },
    'agent.context.why': {
        en: 'This conversation fills {used} of the model’s {window} token window. Past {at}% the earliest runs are folded out of its memory — what you asked is kept, the tool calls and their results are not.',
        zh: '这段对话占了模型 {window} token 上下文窗口中的 {used}。超过 {at}% 后,最早的几轮会被折叠出它的记忆 —— 你问过的话保留,工具调用和结果不保留。',
    },
    'agent.stopped': { en: 'stopped', zh: '已中止' },
    'agent.declined': { en: 'skipped', zh: '已跳过' },
    'agent.turn.aborted': { en: 'Stopped part-way.', zh: '中途停止。' },
    'agent.turn.aborted.note': {
        en: 'You stopped this run — whatever it had already done is still there.',
        zh: '你停止了这一轮——做到一半的改动都留着。',
    },
    'agent.turn.refusal': { en: 'The model declined this one.', zh: '模型拒绝了这个请求。' },
    'agent.turn.maxRounds': { en: 'Ran out of steps.', zh: '步数用尽。' },
    'agent.turn.maxRounds.note': {
        en: 'It reached the limit on tool calls for one run before it was finished. What it already did is there.',
        zh: '它在干完之前用光了单轮的工具调用次数。已经做完的部分都留着。',
    },
    'agent.continue': { en: 'Carry on', zh: '接着干' },
    'agent.continue.message': {
        en: 'Carry on from where you stopped.',
        zh: '从你停下的地方接着干。',
    },
    'agent.turn.refusal.note': {
        en: 'Nothing was changed by this run, so there is nothing to undo.',
        zh: '这一轮什么都没有改动,不需要撤销。',
    },
    'agent.turn.queuedMessage': { en: 'Queued: {text}', zh: '已排队:{text}' },
    'agent.copy': { en: 'Copy', zh: '复制' },
    'agent.changes': { en: 'What changed', zh: '改动集' },
    'agent.reask.label': { en: 'Ask this again', zh: '重新提问' },
    'agent.reask.go': { en: 'Ask again', zh: '重新提问' },
    'agent.reask.cancel': { en: 'Cancel', zh: '取消' },
    'agent.reask.note': {
        en: 'this run and everything after it is discarded',
        zh: '这一轮及之后都会被丢弃',
    },
    'agent.rerun': { en: 'Ask this again, discarding what followed', zh: '从这里重跑(丢弃之后的内容)' },

    // — The decision it needs from you —
    'agent.confirm.title': { en: 'Run {tool}?', zh: '要执行 {tool} 吗?' },
    'agent.confirm.why.irreversible': {
        en: 'It writes outside the scene, and Undo cannot take it back.',
        zh: '它会写到场景之外,撤销收不回来。',
    },
    'agent.confirm.why.arbitrary_code': {
        en: 'It runs code the agent wrote, so its effect is whatever that code does.',
        zh: '它会执行 Agent 自己写的代码,效果取决于那段代码。',
    },
    'agent.preview.title': {
        en: '{count} scene changes, before they land',
        zh: '{count} 项场景改动,尚未应用',
    },
    'agent.preview.why': {
        en: 'Click a line to strike it out. Striking a new entity also strikes what refers to it.',
        zh: '点击某一行可划掉它。划掉一个新建实体时,引用它的行会一并划掉。',
    },
    'agent.preview.loading': { en: 'Reading the batch…', zh: '正在读取这批改动…' },
    'agent.preview.unreadable': {
        en: 'This batch comes from {path}, which could not be read',
        zh: '这批改动来自 {path},读取失败',
    },
    'agent.preview.unreadable.why': {
        en: 'Nothing is previewed below. Applying runs the file as the agent wrote it.',
        zh: '下面没有可预览的内容。应用将按 Agent 写好的文件原样执行。',
    },
    'agent.preview.strikeAll': { en: 'Strike all', zh: '全部划掉' },
    'agent.preview.restoreAll': { en: 'Restore all', zh: '全部恢复' },
    'agent.preview.moreFields': { en: '…and {count} more', zh: '…还有 {count} 项' },
    'agent.preview.apply': { en: 'Apply all', zh: '全部应用' },
    'agent.preview.applyKept': { en: 'Apply {count}', zh: '应用 {count} 项' },
    'agent.confirm.allow': { en: 'Run it', zh: '执行' },
    'agent.confirm.allowTurn': { en: 'Allow for this run', zh: '本轮都允许' },
    'agent.confirm.allowTurn.why': {
        en: 'Stop asking for {tool} until this run ends. The next run asks again.',
        zh: '本轮内不再为 {tool} 询问;下一轮会重新询问。',
    },
    'agent.confirm.deny': { en: 'Skip', zh: '跳过' },
    'agent.confirm.denied': {
        en: 'Skipped — the agent was told to work around it.',
        zh: '已跳过 —— 已告诉 Agent 绕开它继续。',
    },
    'agent.jump': { en: 'One waiting on you', zh: '有一条待确认' },

    // — The checkpoint a finished turn leaves behind —
    'agent.checkpoint.undo': { en: 'Undo', zh: '撤销' },
    'agent.checkpoint.keep': { en: 'Keep', zh: '保留' },
    'agent.checkpoint.steps': { en: '{count} steps', zh: '{count} 步' },
    'agent.checkpoint.undone': { en: 'Took back this turn · {count} steps', zh: '已撤销这一轮 · {count} 步' },
    'agent.checkpoint.stale': {
        en: 'You have edited since — Undo would take those back too.',
        zh: '之后你自己编辑过 —— 撤销会连那些一起退回。',
    },

    // — The status-bar segment —
    'agent.status.running': { en: 'Agent is working', zh: 'Agent 正在干活' },
    'agent.status.awaiting': { en: 'Agent is waiting on you', zh: 'Agent 在等你确认' },
});
