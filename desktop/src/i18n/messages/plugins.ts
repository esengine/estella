// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  plugins.ts — strings for the Plugins panel (PluginsPanel.tsx) and the
 *        trust prompt. Note these describe the editor's own plugin chrome; a
 *        plugin's OWN strings come from its manifest / contributions, which carry
 *        per-locale text of their own (plugins can't use this catalog).
 */
import { defineMessages } from './types';

export const pluginMessages = defineMessages({
    'plug.panelTitle': { en: 'Plugins', zh: '插件' },
    'plug.emptyTitle': { en: 'No plugins', zh: '没有插件' },
    'plug.emptyHint': {
        en: 'Drop a plugin folder into .esengine/plugins/ in this project, then Refresh.',
        zh: '把插件文件夹放进本项目的 .esengine/plugins/,然后点刷新。',
    },
    'plug.noProjectHint': { en: 'Open a project to see its plugins.', zh: '打开一个项目以查看它的插件。' },
    'plug.refresh': { en: 'Refresh', zh: '刷新' },
    'plug.reload': { en: 'Reload', zh: '重新加载' },
    'plug.reloadTip': { en: 'Recompile from source and re-activate', zh: '从源码重新编译并激活' },
    'plug.reveal': { en: 'Reveal', zh: '打开目录' },
    'plug.enable': { en: 'Enable', zh: '启用' },
    'plug.disable': { en: 'Disable', zh: '停用' },
    'plug.trust': { en: 'Trust and load', zh: '信任并加载' },
    'plug.revokeTrust': { en: 'Withdraw trust', zh: '撤销信任' },

    // Lifecycle phases (the status chip on each row).
    'plug.phase.discovered': { en: 'Found', zh: '已发现' },
    'plug.phase.compiling': { en: 'Compiling', zh: '编译中' },
    'plug.phase.needsTrust': { en: 'Needs trust', zh: '待信任' },
    'plug.phase.activating': { en: 'Activating', zh: '激活中' },
    'plug.phase.active': { en: 'Active', zh: '运行中' },
    'plug.phase.failed': { en: 'Failed', zh: '失败' },
    'plug.phase.disabled': { en: 'Disabled', zh: '已停用' },
    'plug.phase.incompatible': { en: 'Incompatible', zh: '版本不兼容' },
    'plug.phase.shadowed': { en: 'Shadowed', zh: '被遮蔽' },

    'plug.scope.project': { en: 'project', zh: '项目' },
    'plug.scope.user': { en: 'user', zh: '用户' },

    // The trust gate. Deliberately plain about what loading a plugin means: it runs
    // in the editor's own realm, which no wording should soften.
    'plug.trustTitle': { en: 'Trust this plugin?', zh: '信任这个插件?' },
    'plug.trustBody': {
        en: 'A plugin runs with the same access the editor has: your project files and anything the editor can reach. Load it only if you trust where it came from.',
        zh: '插件与编辑器拥有同等权限:你的项目文件,以及编辑器能触及的一切。只在你信任其来源时加载。',
    },
    'plug.trustRechecked': {
        en: 'Approval covers this version from this folder. A new version, or another folder claiming the same id, asks again.',
        zh: '批准仅针对该版本与该目录。新版本、或另一个目录声称同一 id,都会重新询问。',
    },
    'plug.capabilities': { en: 'Declares', zh: '声明能力' },
    'plug.noCapabilities': { en: 'no extra capabilities', zh: '无额外能力' },
    'plug.cap.fsProject': { en: 'read/write project files', zh: '读写项目文件' },
    'plug.cap.net': { en: 'network access', zh: '网络访问' },
    'plug.cap.shell': { en: 'run OS commands', zh: '执行系统命令' },
    'plug.cap.process': { en: 'spawn processes', zh: '启动子进程' },
    'plug.capsAdvisory': {
        en: 'Declared capabilities describe intent — they are not a sandbox.',
        zh: '声明的能力表达意图 —— 它不是沙箱。',
    },
    'plug.errorCount': { en: '{n} error(s) this session', zh: '本次会话 {n} 个错误' },
    'plug.contributes': { en: 'Contributes', zh: '贡献' },
});
