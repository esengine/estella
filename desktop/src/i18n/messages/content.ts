// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  content.ts — the Content Browser: asset grid, folder ops, create menu, import feedback.
 */
import { defineMessages } from './types';

export const contentMessages = defineMessages({
    // — Panel chrome: headers, nav, search, view controls —
    'cb.sources': { en: 'Sources', zh: '源' },
    'cb.folders': { en: 'Folders', zh: '文件夹' },
    'cb.project': { en: 'Project', zh: '项目' },
    'cb.back': { en: 'Back', zh: '后退' },
    'cb.forward': { en: 'Forward', zh: '前进' },
    'cb.upOneLevel': { en: 'Up one level', zh: '上一级' },
    'cb.searchPlaceholder': { en: 'Search  (type:texture …)', zh: '搜索（type:texture …）' },
    'cb.sortTitle': { en: 'Sort by {current} — click to sort by {next}', zh: '按{current}排序，点击改为按{next}排序' },
    'cb.sortName': { en: 'name', zh: '名称' },
    'cb.sortType': { en: 'type', zh: '类型' },
    'cb.view': { en: 'View', zh: '视图' },
    'cb.gridView': { en: 'Grid view', zh: '网格视图' },
    'cb.listView': { en: 'List view', zh: '列表视图' },
    'cb.importAssets': { en: 'Import assets', zh: '导入资产' },
    'cb.import': { en: 'Import', zh: '导入' },
    'cb.thumbSize': { en: 'Thumbnail size', zh: '缩略图大小' },

    // — Type filter chips —
    'cb.chipAll': { en: 'All', zh: '全部' },
    'cb.chipImage': { en: 'Image', zh: '图像' },
    'cb.chipPrefab': { en: 'Prefab', zh: '预制体' },
    'cb.chipScene': { en: 'Scene', zh: '场景' },
    'cb.chipAnimation': { en: 'Animation', zh: '动画' },
    'cb.chipScript': { en: 'Script', zh: '脚本' },
    'cb.chipAudio': { en: 'Audio', zh: '音频' },
    'cb.chipMaterial': { en: 'Material', zh: '材质' },

    // — Grid / list body —
    'cb.name': { en: 'Name', zh: '名称' },
    'cb.type': { en: 'Type', zh: '类型' },
    'cb.noMatch': { en: 'No assets match.', zh: '没有匹配的资产。' },
    'cb.emptyFolder': {
        en: 'Empty folder — drag files here or use Import.',
        zh: '空文件夹——将文件拖到此处，或使用导入。',
    },
    'cb.openProjectPrompt': { en: 'Open a project to browse its assets.', zh: '打开一个项目以浏览其资产。' },
    'cb.startupScene': { en: 'Startup scene', zh: '启动场景' },
    'cb.excludedFromExport': { en: 'Excluded from export', zh: '已从导出中排除' },
    'cb.footItems': { en: '{count} items', zh: '{count} 项' },
    'cb.footItemsSelected': { en: '{count} items · 1 selected', zh: '{count} 项 · 已选中 1 个' },

    // — Hover-card rows (labels; `cb.type` above is reused as a row label) —
    'cb.tipFolder': { en: 'Folder', zh: '文件夹' },
    'cb.tipDimensions': { en: 'Dimensions', zh: '尺寸' },
    'cb.tipSize': { en: 'Size', zh: '大小' },
    'cb.tipModified': { en: 'Modified', zh: '修改时间' },
    'cb.tipPath': { en: 'Path', zh: '路径' },
    'cb.tipReference': { en: 'Reference', zh: '引用' },

    // — Context menus (empty space + per-asset) —
    'cb.menuImport': { en: 'Import…', zh: '导入…' },
    'cb.menuNewFolder': { en: 'New Folder', zh: '新建文件夹' },
    'cb.menuNewScene': { en: 'New Scene', zh: '新建场景' },
    'cb.menuNewAnimation': { en: 'New Animation', zh: '新建动画' },
    'cb.menuNewInputMap': { en: 'New Input Map', zh: '新建输入映射' },
    'cb.menuNewLocaleTable': { en: 'New Locale Table', zh: '新建本地化表' },
    'cb.menuNewMaterial': { en: 'New Material', zh: '新建材质' },
    'cb.menuNewMaterialGraph': { en: 'New Material Graph', zh: '新建材质图' },
    'cb.menuNewStateMachine': { en: 'New State Machine', zh: '新建状态机' },
    'cb.menuNewBehaviorTree': { en: 'New Behavior Tree', zh: '新建行为树' },
    'cb.menuShowInExplorer': { en: 'Show in Explorer', zh: '在资源管理器中显示' },
    'cb.menuOpen': { en: 'Open', zh: '打开' },
    'cb.menuSetStartupScene': { en: 'Set as Startup Scene', zh: '设为启动场景' },
    'cb.menuIncludeInExport': { en: 'Include in Export', zh: '包含在导出中' },
    'cb.menuExcludeFromExport': { en: 'Exclude from Export', zh: '从导出中排除' },
    'cb.menuCreateTileset': { en: 'Create Tileset', zh: '创建瓦片集' },
    'cb.menuCreateTilemap': { en: 'Create Tilemap', zh: '创建瓦片地图' },
    'cb.menuCreateMaterialInstance': { en: 'Create Material Instance', zh: '创建材质实例' },
    'cb.menuDuplicate': { en: 'Duplicate', zh: '创建副本' },
    'cb.menuCopyPath': { en: 'Copy Path', zh: '复制路径' },
    'cb.menuCopyReference': { en: 'Copy Reference', zh: '复制引用' },

    // — File ops: undo toasts, failures, delete confirm —
    'cb.undo': { en: 'Undo', zh: '撤销' },
    'cb.undoFailed': { en: 'Undo failed: {error}', zh: '撤销失败：{error}' },
    'cb.nameNoSlashes': { en: 'Name can’t contain slashes', zh: '名称不能包含斜杠' },
    'cb.renamedTo': { en: 'Renamed to “{name}”', zh: '已重命名为“{name}”' },
    'cb.renameFailed': { en: 'Rename failed: {error}', zh: '重命名失败：{error}' },
    'cb.duplicatedAs': { en: 'Duplicated as “{name}”', zh: '已创建副本“{name}”' },
    'cb.duplicateFailed': { en: 'Duplicate failed: {error}', zh: '创建副本失败：{error}' },
    'cb.deleteFailed': { en: 'Delete failed: {error}', zh: '删除失败：{error}' },
    'cb.deleteTitle': { en: 'Delete asset', zh: '删除资产' },
    'cb.deleteBody': {
        en: 'Delete “{name}”? It will be moved to the trash.',
        zh: '确定删除“{name}”？它将被移入回收站。',
    },
    'cb.deleteRefWarnOne': {
        en: 'It is referenced by {count} asset ({names}); those references will break.',
        zh: '它被 {count} 个资产引用（{names}）；这些引用将会失效。',
    },
    'cb.deleteRefWarnMany': {
        en: 'It is referenced by {count} assets ({names}); those references will break.',
        zh: '它被 {count} 个资产引用（{names}）；这些引用将会失效。',
    },
    'cb.movedTo': { en: 'Moved “{name}” to {dest}', zh: '已将“{name}”移动到 {dest}' },
    'cb.projectRoot': { en: 'the project root', zh: '项目根目录' },
    'cb.moveFailed': { en: 'Move failed: {error}', zh: '移动失败：{error}' },
    'cb.newFolderFailed': { en: 'New folder failed: {error}', zh: '新建文件夹失败：{error}' },
    'cb.newSceneFailed': { en: 'New scene failed: {error}', zh: '新建场景失败：{error}' },
    'cb.newInputMapFailed': { en: 'New input map failed: {error}', zh: '新建输入映射失败：{error}' },
    'cb.newLocaleTableFailed': { en: 'New locale table failed: {error}', zh: '新建本地化表失败：{error}' },
    'cb.revealFailed': { en: 'Couldn’t reveal: {error}', zh: '无法在资源管理器中显示：{error}' },
    'cb.copiedPath': { en: 'Copied path', zh: '已复制路径' },
    'cb.copiedReference': { en: 'Copied reference', zh: '已复制引用' },
    'cb.importedOne': { en: 'Imported {count} asset', zh: '已导入 {count} 个资产' },
    'cb.importedMany': { en: 'Imported {count} assets', zh: '已导入 {count} 个资产' },
    'cb.skippedOne': { en: 'Skipped {count} unsupported file', zh: '已跳过 {count} 个不支持的文件' },
    'cb.skippedMany': { en: 'Skipped {count} unsupported files', zh: '已跳过 {count} 个不支持的文件' },
    'cb.importFailed': { en: 'Import failed: {error}', zh: '导入失败：{error}' },

    // — Create-entity picker (CreatePopover) —
    'cb.createEntity': { en: 'Create entity', zh: '创建实体' },
    'cb.createEntityPlaceholder': { en: 'Create entity…', zh: '创建实体…' },
    'cb.noMatchingTemplates': { en: 'No matching templates', zh: '没有匹配的模板' },
});
