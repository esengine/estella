// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  outliner.ts — the Outliner panel: entity tree, folders, columns, context menu.
 */
import { defineMessages } from './types';

export const outlinerMessages = defineMessages({
    // — The tree while the game runs —
    'out.liveWorld': { en: 'Live — edits end at Stop', zh: '运行中 · 改动在停止时结束' },
    'out.waitingGame': { en: 'Waiting for the running game…', zh: '正在等待运行中的游戏…' },
    'out.spawnedTip': { en: 'Spawned by the running game', zh: '由运行中的游戏创建' },

    // — Header strip (search / sort / create buttons) —
    // `type:` / `comp:` are literal query tokens (parseQuery grammar) — never translated.
    'out.searchPlaceholder': { en: 'Search · type: comp:', zh: '搜索 · type: comp:' },
    'out.sortLabel': { en: 'Sort: {mode}', zh: '排序：{mode}' },
    'out.sortManual': { en: 'Manual', zh: '手动' },
    'out.sortName': { en: 'Name', zh: '名称' },
    'out.sortType': { en: 'Type', zh: '类型' },
    'out.newFolderTip': { en: 'New folder', zh: '新建文件夹' },
    'out.addEntityTip': { en: 'Create entity…', zh: '创建实体…' },

    // — Column header strip + show/hide-columns menu —
    'out.columnsTip': { en: 'Right-click to show/hide columns', zh: '右键点击以显示/隐藏列' },
    'out.colName': { en: 'Name', zh: '名称' },
    'out.colType': { en: 'Type', zh: '类型' },
    // Menu labels for the icon-only (headerless) columns; en mirrors the raw ids shown today.
    'out.colLock': { en: 'lock', zh: '锁定' },
    'out.colVis': { en: 'vis', zh: '可见性' },

    'out.tree': { en: 'Scene hierarchy', zh: '场景层级' },
    'out.treeGame': { en: 'Running world hierarchy', zh: '运行中世界的层级' },
    // — Empty states —
    'out.emptyScene': { en: 'No entities in scene.', zh: '场景中没有实体。' },
    'out.waitingEngine': { en: 'Waiting for engine…', zh: '正在等待引擎…' },
    'out.emptyHint': { en: 'Right-click here or use the + button to add one.', zh: '在此右键点击，或使用 + 按钮添加实体。' },
    'out.noMatch': { en: 'No entities match “{query}”.', zh: '没有与“{query}”匹配的实体。' },

    // — Context menus (empty space / folder / entity) —
    'out.addEntity': { en: 'Add Entity', zh: '添加实体' },
    'out.createTemplate': { en: 'Create…', zh: '创建…' },
    'out.addChild': { en: 'Add Child', zh: '添加子实体' },
    'out.createChild': { en: 'Create Child…', zh: '创建子实体…' },
    'out.newFolder': { en: 'New Folder', zh: '新建文件夹' },
    'out.expandAll': { en: 'Expand All', zh: '全部展开' },
    'out.collapseAll': { en: 'Collapse All', zh: '全部折叠' },
    'out.newSubfolder': { en: 'New Subfolder', zh: '新建子文件夹' },
    'out.moveSelectionHere': { en: 'Move Selection Here', zh: '将所选移动到此处' },
    'out.deleteFolder': { en: 'Delete Folder', zh: '删除文件夹' },
    'out.duplicate': { en: 'Duplicate', zh: '创建副本' },
    'out.createPrefab': { en: 'Create Prefab', zh: '创建预制体' },
    'out.prefabEdit': { en: 'Edit Prefab', zh: '编辑预制体' },
    'out.prefabSelectSource': { en: 'Select Prefab Source', zh: '选中预制体源' },
    'out.prefabApply': { en: 'Apply to Prefab', zh: '应用到预制体' },
    'out.prefabRevert': { en: 'Revert to Prefab', zh: '还原为预制体' },
    'out.prefabCreateVariant': { en: 'Create Variant', zh: '创建变体' },
    'out.prefabUnpack': { en: 'Unpack Prefab', zh: '解包预制体' },
    'out.hide': { en: 'Hide', zh: '隐藏' },
    'out.show': { en: 'Show', zh: '显示' },
    'out.lock': { en: 'Lock', zh: '锁定' },
    'out.unlock': { en: 'Unlock', zh: '解锁' },
    'out.newFolderFromSelection': { en: 'New Folder from Selection', zh: '从所选新建文件夹' },
    'out.moveToRoot': { en: 'Move to Root', zh: '移动到根级' },
    'out.unparent': { en: 'Unparent', zh: '解除父级' },

    // — Type column labels (entity kind → display) —
    'out.prefab': { en: 'Prefab', zh: '预制体' },
    'out.kindCamera': { en: 'Camera', zh: '相机' },
    'out.kindSprite': { en: 'Sprite', zh: '精灵' },
    'out.kindSkeletal': { en: 'Skeletal', zh: '骨骼' },
    'out.kindPhysics': { en: 'Physics', zh: '物理' },
    'out.kindUi': { en: 'UI', zh: 'UI' },
    'out.kindAudio': { en: 'Audio', zh: '音频' },
    'out.kindGroup': { en: 'Group', zh: '分组' },
    'out.kindLight': { en: 'Light', zh: '灯光' },
    'out.kindEntity': { en: 'Entity', zh: '实体' },

    // — Lock / visibility cell tooltips —
    'out.toggleVisibility': { en: 'Toggle visibility', zh: '切换可见性' },
});
