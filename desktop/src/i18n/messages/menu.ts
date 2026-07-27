// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  menu.ts — the menu bar: top-level titles and the few items that are
 *        not command-registry entries (layout, launcher, about/updates). Items
 *        built from commands take their label from `cmd.*` automatically.
 */
import { defineMessages } from './types';

export const menuMessages = defineMessages({
    'menu.file': { en: 'File', zh: '文件' },
    'menu.edit': { en: 'Edit', zh: '编辑' },
    'menu.entity': { en: 'Entity', zh: '实体' },
    'menu.view': { en: 'View', zh: '视图' },
    'menu.build': { en: 'Build', zh: '构建' },
    // Where contributed commands land; the strip hides it while it holds nothing.
    'menu.tools': { en: 'Tools', zh: '工具' },
    'menu.window': { en: 'Window', zh: '窗口' },
    'menu.help': { en: 'Help', zh: '帮助' },

    'menu.extractSchemas': { en: 'Extract Component Schemas', zh: '提取组件 Schema' },
    'menu.resetLayout': { en: 'Reset Layout', zh: '重置布局' },
    'menu.backToLauncher': { en: 'Back to Launcher', zh: '返回启动器' },
    'menu.about': { en: 'About Estella', zh: '关于 Estella' },
    'menu.aboutTagline': {
        en: 'A modern editor for the Estella 2D engine.',
        zh: 'Estella 2D 引擎的现代化编辑器。',
    },
    'menu.checkUpdates': { en: 'Check for Updates…', zh: '检查更新…' },
    'menu.openLogs': { en: 'Open Log Folder', zh: '打开日志文件夹' },
    'menu.keyboardShortcuts': { en: 'Keyboard Shortcuts', zh: '键盘快捷键' },

    'toast.extractedSchemas': { en: 'Extracted component schemas', zh: '组件 Schema 已提取' },
    'toast.extractFailed': { en: 'Extract failed', zh: '提取失败' },
    'toast.updateAvailable': { en: 'Estella {version} is available', zh: '新版本 Estella {version} 可用' },
    'toast.updateDownloading': {
      en: 'Downloading Estella {version}… {percent}%',
      zh: '正在下载 Estella {version}… {percent}%',
    },
    'toast.updateReady': {
      en: 'Estella {version} is ready — restart to install',
      zh: 'Estella {version} 已下载完成，重启即可安装',
    },
    'toast.updateFailed': { en: 'Update download failed', zh: '更新下载失败' },
    'toast.upToDate': { en: 'Estella is up to date', zh: 'Estella 已是最新版本' },
});
