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
        en: 'Create one, or import an .esplugin you were sent. A folder dropped into .esengine/plugins/ shows up on Refresh.',
        zh: '新建一个,或导入别人给你的 .esplugin。手动放进 .esengine/plugins/ 的文件夹,点刷新也会出现。',
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
    'plug.scope.package': { en: 'package', zh: '依赖包' },
    'plug.scope.builtin': { en: 'built in', zh: '内置' },
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
    'plug.contributesNone': {
        en: 'Nothing registered — this plugin is running but added no commands, panels or tools.',
        zh: '什么都没注册 —— 插件在运行,但没有添加任何命令、面板或工具。',
    },
    'plug.kind.command': { en: 'Command', zh: '命令' },
    'plug.kind.panel': { en: 'Panel', zh: '面板' },
    'plug.kind.setting': { en: 'Setting', zh: '设置项' },
    'plug.kind.tool': { en: 'Tool', zh: '工具' },
    'plug.kind.overlay': { en: 'Gizmo', zh: 'Gizmo' },
    'plug.kind.inspector': { en: 'Inspector', zh: '检视器' },
    'plug.kind.assetType': { en: 'Asset type', zh: '资产类型' },
    'plug.kind.importer': { en: 'Importer', zh: '导入器' },
    'plug.kind.entityTemplate': { en: 'Entity', zh: '实体' },
    'plug.kind.contextMenu': { en: 'Menu item', zh: '菜单项' },
    'plug.kind.activityBar': { en: 'Rail button', zh: '侧栏按钮' },
    'plug.kind.agentTool': { en: 'Agent tool', zh: 'Agent 工具' },

    // — New plugin. The editor writes the folder because the SHAPE of a plugin is
    //   the part that is hard to know before you have seen one. —
    'plug.new': { en: 'New plugin', zh: '新建插件' },
    'plug.newTitle': { en: 'New plugin', zh: '新建插件' },
    'plug.newBlurb': {
        en: 'Writes the manifest, an entry file, and a tsconfig that already resolves the editor API.',
        zh: '写好清单、入口文件,以及一份已经能解析编辑器 API 的 tsconfig。',
    },
    'plug.field.id': { en: 'Id', zh: '标识' },
    'plug.field.idTip': {
        en: 'Dotted and lowercase, e.g. acme.level-tools — also the folder name.',
        zh: '点分小写,如 acme.level-tools —— 同时也是文件夹名。',
    },
    'plug.field.name': { en: 'Name', zh: '名称' },
    'plug.field.scope': { en: 'Install to', zh: '安装到' },
    'plug.scope.projectHint': {
        en: 'In this project, versioned with it and shared by the team.',
        zh: '放在本项目里,随项目版本管理,团队共享。',
    },
    'plug.scope.userHint': {
        en: 'Personal, available across every project you open.',
        zh: '个人插件,在你打开的每个项目里都可用。',
    },
    'plug.needProject': { en: 'Open a project to install into it.', zh: '打开一个项目才能装进项目里。' },
    'plug.samples': { en: 'Start from', zh: '起始样例' },
    'plug.samplesHint': {
        en: 'Each one is a working example you can edit or delete.',
        zh: '每一项都是可运行的例子,可以随意修改或删掉。',
    },
    'plug.contrib.command': { en: 'Command', zh: '命令' },
    'plug.contrib.panel': { en: 'Panel', zh: '面板' },
    'plug.contrib.inspector': { en: 'Inspector section', zh: '检视器分区' },
    'plug.contrib.overlay': { en: 'Viewport gizmo', zh: '视口 gizmo' },
    'plug.contrib.tool': { en: 'Viewport tool', zh: '视口工具' },
    'plug.create': { en: 'Create', zh: '创建' },
    'plug.created': { en: 'Created {name} — it is running now.', zh: '已创建 {name} —— 现在已在运行。' },

    // — Packaging. One `.esplugin` file (a ZIP) you can hand to someone. —
    'plug.export': { en: 'Export', zh: '导出' },
    'plug.exportTip': { en: 'Pack this plugin into one .esplugin file', zh: '把这个插件打包成一个 .esplugin 文件' },
    'plug.exported': { en: 'Exported to {file}', zh: '已导出到 {file}' },
    'plug.import': { en: 'Import', zh: '导入' },
    'plug.importTitle': { en: 'Install plugin', zh: '安装插件' },
    'plug.install': { en: 'Install', zh: '安装' },
    'plug.installed': { en: 'Installed {name}. Trust it to load it.', zh: '已安装 {name}。信任后才会加载。' },
    'plug.packageContents': { en: 'Contents ({n} files)', zh: '包内文件({n} 个)' },
    'plug.installUntrusted': {
        en: 'Installing does not run it — it will wait for your approval.',
        zh: '安装不等于运行 —— 它会等待你的批准。',
    },
});
