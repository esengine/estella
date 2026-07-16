// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  layout.ts — dock/window chrome: panel titles, toolbar, status bar,
 *        activity bar, content drawer, window controls, subsystem indicator.
 */
import { defineMessages } from './types';

export const layoutMessages = defineMessages({
    // — Dock panel titles —
    'layout.panel.viewport': { en: 'Viewport', zh: '视口' },
    'layout.panel.worldOutliner': { en: 'World Outliner', zh: '世界大纲' },
    'layout.panel.details': { en: 'Details', zh: '细节' },
    'layout.panel.contentBrowser': { en: 'Content Browser', zh: '内容浏览器' },
    'layout.panel.outputLog': { en: 'Output Log', zh: '输出日志' },
    'layout.panel.sequencer': { en: 'Sequencer', zh: '序列器' },
    'layout.panel.profiler': { en: 'Profiler', zh: '性能分析器' },
    'layout.panel.game': { en: 'Game', zh: '游戏' },
    'layout.panel.gamePlayer': { en: 'Game P{n}', zh: '游戏 P{n}' },

    // — Dock chrome (tabs, collapse chevron) —
    'layout.closeTab': { en: 'Close {title}', zh: '关闭 {title}' },
    'layout.popOut': { en: 'Move to new window', zh: '移动到新窗口' },
    'layout.collapsePanel': { en: 'Collapse panel', zh: '折叠面板' },
    'layout.expandPanel': { en: 'Expand panel', zh: '展开面板' },

    // — Activity bar —
    'layout.toggleOutliner': { en: 'Toggle Outliner', zh: '切换大纲' },
    'layout.toggleDetails': { en: 'Toggle Details', zh: '切换细节' },
    'layout.contentDrawerTooltip': { en: 'Content Drawer  (Ctrl+Space)', zh: '内容抽屉  (Ctrl+Space)' },
    'layout.settingsTooltip': { en: 'Settings  (Ctrl+,)', zh: '设置  (Ctrl+,)' },

    // — Content drawer —
    'layout.closeEsc': { en: 'Close (Esc)', zh: '关闭 (Esc)' },

    // — Toolbar —
    'layout.undoWithLabel': { en: 'Undo {label}', zh: '撤销 {label}' },
    'layout.redoWithLabel': { en: 'Redo {label}', zh: '重做 {label}' },
    'layout.transformTool': { en: 'Transform tool', zh: '变换工具' },
    'layout.tool.select': { en: 'Select', zh: '选择' },
    'layout.tool.move': { en: 'Move', zh: '移动' },
    'layout.tool.rotate': { en: 'Rotate', zh: '旋转' },
    'layout.tool.scale': { en: 'Scale', zh: '缩放' },
    'layout.restart': { en: 'Restart', zh: '重新运行' },
    'layout.pause': { en: 'Pause', zh: '暂停' },
    'layout.playInViewportTooltip': { en: 'Play in Viewport', zh: '在视口中运行' },
    'layout.playInWindowTooltip': { en: 'Play in New Window', zh: '在新窗口中运行' },
    'layout.playInViewport': { en: 'Play In Viewport', zh: '在视口中运行' },
    'layout.playInWindow': { en: 'Play In New Window', zh: '在新窗口中运行' },
    'layout.singlePlayer': { en: 'Single Player', zh: '单人' },
    'layout.playersListenServer': { en: '{n} Players (Listen Server)', zh: '{n} 名玩家（监听服务器）' },
    'layout.build': { en: 'Build', zh: '构建' },
    'layout.buildScriptsTooltip': { en: 'Build project scripts', zh: '构建项目脚本' },

    // — Status bar —
    'layout.contentDrawer': { en: 'Content Drawer', zh: '内容抽屉' },
    'layout.status.running': { en: 'Running', zh: '运行中' },
    'layout.status.editMode': { en: 'Edit Mode', zh: '编辑模式' },
    'layout.status.selected': { en: '{count} selected', zh: '已选中 {count} 个' },
    'layout.status.noSelection': { en: 'No selection', zh: '未选中' },
    'layout.status.selectionTooltip': { en: 'Selected transform (X, Y · rotation)', zh: '所选对象的变换（X、Y · 旋转）' },
    'layout.status.entities': { en: '{count} entities', zh: '{count} 个实体' },
    'layout.status.vramTooltip': {
        en: 'Resident texture memory / budget · {count} cached (evictable) texture(s)',
        zh: '驻留纹理内存 / 预算 · {count} 个已缓存（可逐出）纹理',
    },
    'layout.status.backendTooltip': {
        en: 'Active GPU backend — the device actually rendering (reflects any WebGL2 fallback). Change it in Settings → Renderer.',
        zh: '当前使用的 GPU 后端——实际执行渲染的设备（反映 WebGL2 回退情况）。可在设置 → 渲染器中更改。',
    },

    // — Subsystem (engine modules) indicator —
    'layout.mods.tooltip': { en: 'Engine modules', zh: '引擎模块' },
    'layout.mods.label': { en: 'Modules', zh: '模块' },
    'layout.mods.heading': { en: 'Engine Modules', zh: '引擎模块' },
    'layout.mods.playSuffix': { en: ' · Play', zh: ' · 运行' },
    'layout.mods.notBooted': { en: 'Engine not booted', zh: '引擎尚未启动' },
    'layout.mods.error': { en: 'error', zh: '错误' },
    'layout.mods.loading': { en: 'loading…', zh: '加载中…' },
    'layout.mods.registered': { en: 'registered', zh: '已注册' },
    'layout.mods.running': { en: 'running', zh: '运行中' },
    'layout.mods.idle': { en: 'idle', zh: '空闲' },
    'layout.mods.ready': { en: 'ready', zh: '就绪' },
    'load.engine': { en: 'Loading engine…', zh: '加载引擎…' },
    'load.playRealm': { en: 'Preparing play realm…', zh: '预热运行环境…' },

    // — Window controls —
    'layout.minimize': { en: 'Minimize', zh: '最小化' },
    'layout.maximize': { en: 'Maximize', zh: '最大化' },
    'layout.restore': { en: 'Restore', zh: '还原' },

    // — App shell toasts —
    'layout.toast.openSceneFirst': { en: 'Open a scene before playing', zh: '请先打开场景再运行' },
});
