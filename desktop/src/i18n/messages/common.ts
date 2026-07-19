// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  common.ts — strings shared across panels and dialogs: generic verbs,
 *        confirm/cancel pairs, empty-state fragments. Prefer one of these over
 *        minting a per-panel duplicate.
 */
import { defineMessages } from './types';

export const commonMessages = defineMessages({
    'ui.ok': { en: 'OK', zh: '确定' },
    'ui.cancel': { en: 'Cancel', zh: '取消' },
    'ui.close': { en: 'Close', zh: '关闭' },
    'ui.delete': { en: 'Delete', zh: '删除' },
    'ui.rename': { en: 'Rename', zh: '重命名' },
    'ui.search': { en: 'Search', zh: '搜索' },
    'ui.reset': { en: 'Reset', zh: '重置' },
    'ui.untitled': { en: 'untitled', zh: '未命名' },
    'ui.download': { en: 'Download', zh: '下载' },
    'ui.reloadNow': { en: 'Reload now', zh: '立即重新加载' },
    'ui.dismiss': { en: 'Dismiss', zh: '关闭' },

    // — Panel crash fallback (components/ErrorBoundary.tsx) —
    'ui.crashTitle': { en: '{label} hit an error', zh: '{label} 出错了' },
    'ui.crashTitleGeneric': { en: 'This panel hit an error', zh: '此面板出错了' },
    'ui.reloadPanel': { en: 'Reload panel', zh: '重新加载面板' },

    // — The unsaved-changes gate (project/discardGuard.ts) —
    // `discard.body` wraps a consequence sentence; the `discard.*` fragments
    // below are the consequences callers pass in (no trailing period — the
    // body template owns the punctuation in each language).
    'discard.title': { en: 'Unsaved changes', zh: '未保存的更改' },
    'discard.body': { en: 'You have unsaved changes. {what}.', zh: '有未保存的更改。{what}。' },
    'discard.confirm': { en: 'Discard changes', zh: '丢弃更改' },
    'discard.default': { en: 'They will be lost', zh: '它们将会丢失' },
    'discard.newScene': { en: 'Creating a new scene will discard them', zh: '新建场景将丢弃这些更改' },
    'discard.closeProject': { en: 'Closing the project will discard them', zh: '关闭项目将丢弃这些更改' },
    'discard.openProject': { en: 'Opening another project will discard them', zh: '打开其他项目将丢弃这些更改' },
    'discard.openScene': { en: 'Opening {name} will discard them', zh: '打开 {name} 将丢弃这些更改' },
    'discard.openAsset': { en: 'Opening {name} will discard them', zh: '打开 {name} 将丢弃这些更改' },
    'discard.closeTab': { en: 'Closing {title} will discard them', zh: '关闭 {title} 将丢弃这些更改' },
    'discard.reloadChanged': {
        en: '“{name}” changed on disk. Reloading discards your unsaved edits',
        zh: '“{name}”在磁盘上已被修改。重新加载将丢弃未保存的编辑',
    },
    'toast.reloadedFromDisk': { en: 'Reloaded {name} from disk', zh: '已从磁盘重新加载 {name}' },
});
