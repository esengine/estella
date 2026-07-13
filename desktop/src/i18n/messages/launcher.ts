// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  launcher.ts — the project launcher: project list, templates, new-project flow.
 */
import { defineMessages } from './types';

export const launcherMessages = defineMessages({
    // — Relative timestamps on project cards —
    'launcher.justNow': { en: 'just now', zh: '刚刚' },
    'launcher.minutesAgo': { en: '{m}m ago', zh: '{m} 分钟前' },
    'launcher.hoursAgo': { en: '{h}h ago', zh: '{h} 小时前' },
    'launcher.daysAgo': { en: '{d}d ago', zh: '{d} 天前' },
    'launcher.weeksAgo': { en: '{w}w ago', zh: '{w} 周前' },

    // — Recent view —
    'launcher.recent': { en: 'Recent', zh: '最近' },
    'launcher.searchProjects': { en: 'Search projects', zh: '搜索项目' },
    'launcher.viewLabel': { en: 'View', zh: '视图' },
    'launcher.viewGrid': { en: 'Grid', zh: '网格' },
    'launcher.viewList': { en: 'List', zh: '列表' },
    'launcher.noRecent': { en: 'No recent projects yet.', zh: '还没有最近打开的项目。' },
    'launcher.openProjectFolder': { en: 'Open a project folder', zh: '打开项目文件夹' },
    'launcher.noMatch': { en: 'No projects match “{query}”.', zh: '没有匹配“{query}”的项目。' },
    'launcher.removeFromRecents': { en: 'Remove from recents', zh: '从最近列表移除' },
    'launcher.colProject': { en: 'Project', zh: '项目' },
    'launcher.colLastOpened': { en: 'Last opened', zh: '最近打开' },
    'launcher.colBuild': { en: 'Build', zh: '构建' },

    // — New-project view —
    'launcher.newProject': { en: 'New project', zh: '新建项目' },
    'launcher.newProjectSub': {
        en: 'Start from a template — you can change anything later.',
        zh: '从模板开始——之后一切都可以修改。',
    },
    'launcher.templatesMissing': { en: 'The bundled templates are missing.', zh: '内置模板缺失。' },
    'launcher.templatesMissingHint': {
        en: 'Reinstalling the editor should restore them.',
        zh: '重新安装编辑器应可恢复。',
    },
    'launcher.groupStarters': { en: 'Starters', zh: '起步模板' },
    'launcher.groupExamples': { en: 'Examples', zh: '示例' },
    'launcher.projectName': { en: 'Project name', zh: '项目名称' },
    'launcher.location': { en: 'Location', zh: '位置' },
    'launcher.chooseFolderPlaceholder': { en: 'Choose a folder…', zh: '选择文件夹…' },
    'launcher.chooseFolder': { en: 'Choose folder', zh: '选择文件夹' },
    'launcher.creating': { en: 'Creating…', zh: '创建中…' },
    'launcher.createProject': { en: 'Create project', zh: '创建项目' },
    'launcher.pickTemplate': { en: 'Pick a template to begin.', zh: '选择一个模板开始。' },

    // — Chrome (top bar, rail) —
    'launcher.brandEditor': { en: 'editor', zh: '编辑器' },
    'launcher.openFolder': { en: 'Open folder…', zh: '打开文件夹…' },
});
