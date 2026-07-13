// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  commands.ts — labels + categories for the command registry
 *        (commands/editorCommands.ts) and the editor-mode table. Menus, the
 *        shortcuts settings page, and the command palette all render from the
 *        registry, so translating here covers every surface a command shows on.
 *        Key convention: `cmd.<command id>`, `cat.<category>`, `mode.<mode id>`.
 */
import { defineMessages } from './types';

export const commandMessages = defineMessages({
    // — File / project —
    'cmd.scene.new': { en: 'New Scene', zh: '新建场景' },
    'cmd.project.open': { en: 'Open Project…', zh: '打开项目…' },
    'cmd.project.save': { en: 'Save Scene', zh: '保存场景' },
    'cmd.project.saveAs': { en: 'Save Scene As…', zh: '场景另存为…' },
    'cmd.project.export': { en: 'Build…', zh: '构建…' },
    'cmd.project.close': { en: 'Close Project', zh: '关闭项目' },

    // — Edit / history —
    'cmd.edit.undo': { en: 'Undo', zh: '撤销' },
    'cmd.edit.redo': { en: 'Redo', zh: '重做' },
    'cmd.edit.selectAll': { en: 'Select All', zh: '全选' },

    // — Entity —
    'cmd.entity.add': { en: 'Add Entity', zh: '添加实体' },
    'cmd.tilemap.new': { en: 'New Tilemap', zh: '新建瓦片地图' },
    'cmd.entity.duplicate': { en: 'Duplicate', zh: '创建副本' },
    'cmd.entity.delete': { en: 'Delete', zh: '删除' },
    'cmd.entity.copy': { en: 'Copy', zh: '复制' },
    'cmd.entity.cut': { en: 'Cut', zh: '剪切' },
    'cmd.entity.paste': { en: 'Paste', zh: '粘贴' },
    'cmd.entity.deselect': { en: 'Deselect', zh: '取消选择' },
    'cmd.entity.nudge': { en: 'Nudge Selection', zh: '微移所选' },

    // — Tools / modes —
    'cmd.tool.select': { en: 'Select Tool', zh: '选择工具' },
    'cmd.tool.move': { en: 'Move Tool', zh: '移动工具' },
    'cmd.tool.rotate': { en: 'Rotate Tool', zh: '旋转工具' },
    'cmd.tool.scale': { en: 'Scale Tool', zh: '缩放工具' },
    'cmd.mode.scene': { en: 'Scene Mode', zh: '场景模式' },
    'cmd.mode.ui': { en: 'UI Mode', zh: 'UI 模式' },
    'cmd.mode.tilemap': { en: 'Tilemap Mode', zh: '瓦片地图模式' },

    // — View —
    'cmd.view.frameSelected': { en: 'Frame Selected', zh: '聚焦所选' },
    'cmd.view.toggleGrid': { en: 'Show Grid', zh: '显示网格' },
    'cmd.view.toggleGizmos': { en: 'Show Gizmos', zh: '显示 Gizmo' },
    'cmd.view.togglePreviewFx': { en: 'Preview FX', zh: '预览特效' },
    'cmd.view.toggleColliders': { en: 'Show Colliders', zh: '显示碰撞体' },
    'cmd.view.toggleCoordSpace': { en: 'Local Axes', zh: '局部坐标轴' },
    'cmd.view.togglePivotMode': { en: 'Pivot (vs Center)', zh: '轴心（而非中心）' },
    'cmd.view.toggleSnapping': { en: 'Snapping', zh: '吸附' },

    // — Editor / play / build —
    'cmd.settings.open': { en: 'Settings…', zh: '设置…' },
    'cmd.play.toggle': { en: 'Play', zh: '运行' },
    'cmd.play.stop': { en: 'Stop', zh: '停止' },
    'cmd.build.scripts': { en: 'Build Project Scripts', zh: '构建项目脚本' },

    // — Command categories (menus, shortcuts page grouping) —
    'cat.file': { en: 'File', zh: '文件' },
    'cat.edit': { en: 'Edit', zh: '编辑' },
    'cat.entity': { en: 'Entity', zh: '实体' },
    'cat.tools': { en: 'Tools', zh: '工具' },
    'cat.view': { en: 'View', zh: '视图' },
    'cat.editor': { en: 'Editor', zh: '编辑器' },
    'cat.play': { en: 'Play', zh: '运行' },
    'cat.build': { en: 'Build', zh: '构建' },
    'cat.general': { en: 'General', zh: '通用' },

    // — Editor modes (viewport toolbar) + their companion panels —
    'mode.scene': { en: 'Scene', zh: '场景' },
    'mode.ui': { en: 'UI', zh: 'UI' },
    'mode.tilemap': { en: 'Tilemap', zh: '瓦片地图' },
    'panel.tilemap': { en: 'Tilemap', zh: '瓦片地图' },
    'panel.uiWidgets': { en: 'UI Widgets', zh: 'UI 控件' },

    // — Command-fired feedback —
    'toast.builtScripts': { en: 'Built project scripts', zh: '项目脚本构建完成' },
    'toast.buildFailed': { en: 'Build failed', zh: '构建失败' },
    'toast.noTileset': {
        en: 'No tileset in the project yet — right-click a texture in the Content Browser → Create Tileset',
        zh: '项目中还没有瓦片集——在内容浏览器中右键一张纹理 → 创建瓦片集',
    },
});
