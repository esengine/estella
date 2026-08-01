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
    'agent.stopped': { en: 'stopped', zh: '已中止' },
    'agent.declined': { en: 'skipped', zh: '已跳过' },
    'agent.turn.aborted': { en: 'Stopped part-way.', zh: '中途停止。' },
    'agent.turn.refusal': { en: 'The model declined this one.', zh: '模型拒绝了这个请求。' },
    'agent.turn.queuedMessage': { en: 'Queued: {text}', zh: '已排队:{text}' },
    'agent.copy': { en: 'Copy', zh: '复制' },
    'agent.changes': { en: 'What changed', zh: '改动集' },
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
    'agent.confirm.allow': { en: 'Run it', zh: '执行' },
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
