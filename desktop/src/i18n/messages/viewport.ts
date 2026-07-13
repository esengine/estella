// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  viewport.ts — the scene viewport + Game panel: toolbar, overlays, play chrome, perf HUD.
 */
import { defineMessages } from './types';

export const viewportMessages = defineMessages({
    // — Transform tool buttons (top-right cluster) —
    'vp.tool.select': { en: 'Select', zh: '选择' },
    'vp.tool.move': { en: 'Move', zh: '移动' },
    'vp.tool.rotate': { en: 'Rotate', zh: '旋转' },
    'vp.tool.scale': { en: 'Scale', zh: '缩放' },

    // — HUD hint line (active transform tool) —
    'vp.hint.select': {
        en: 'Click to select · Shift adds · drag empty to box-select',
        zh: '点击选择 · Shift 加选 · 拖动空白处框选',
    },
    'vp.hint.move': {
        en: 'Drag a gizmo axis or the body · Alt-drag duplicates · arrows nudge',
        zh: '拖动 Gizmo 轴或其主体 · Alt 拖动创建副本 · 方向键微移',
    },
    'vp.hint.rotate': { en: 'Drag the ring to rotate the selection', zh: '拖动圆环旋转所选' },
    'vp.hint.scale': {
        en: 'Drag a handle for per-axis scale · center for uniform',
        zh: '拖动手柄按轴缩放 · 拖动中心等比缩放',
    },

    // — HUD hint line (tilemap paint tools) —
    'vp.tileHint.brush': {
        en: 'Drag to paint · H/V flips · R rotates the brush · I eyedropper · Q/Esc exits',
        zh: '拖动绘制 · H/V 翻转 · R 旋转笔刷 · I 取色 · Q/Esc 退出',
    },
    'vp.tileHint.erase': { en: 'Drag to erase (brush-sized) · Q/Esc exits', zh: '拖动擦除（笔刷大小）· Q/Esc 退出' },
    'vp.tileHint.rect': { en: 'Drag a rectangle to fill · Q/Esc exits', zh: '拖出矩形以填充 · Q/Esc 退出' },
    'vp.tileHint.line': { en: 'Drag a straight line · Q/Esc exits', zh: '拖出直线 · Q/Esc 退出' },
    'vp.tileHint.bucket': { en: 'Click to fill the connected region · Q/Esc exits', zh: '点击填充连通区域 · Q/Esc 退出' },
    'vp.tileHint.select': {
        en: 'Box-select · {mod}C/X copies/cuts · Del clears · {mod}V pastes as brush · Q/Esc exits',
        zh: '框选 · {mod}C/X 复制/剪切 · Del 清除 · {mod}V 粘贴为笔刷 · Q/Esc 退出',
    },
    'vp.tileHint.eyedropper': { en: 'Click to pick a tile into the brush · Q/Esc exits', zh: '点击拾取瓦片作为笔刷 · Q/Esc 退出' },
    'vp.tileHint.terrain': {
        en: 'Drag to paint terrain (auto-transitions) · Q/Esc exits',
        zh: '拖动绘制地形（自动过渡）· Q/Esc 退出',
    },

    // — Mode badge: the paint tool's short name —
    'vp.tileTool.brush': { en: 'Brush', zh: '笔刷' },
    'vp.tileTool.erase': { en: 'Erase', zh: '擦除' },
    'vp.tileTool.rect': { en: 'Rect', zh: '矩形' },
    'vp.tileTool.line': { en: 'Line', zh: '直线' },
    'vp.tileTool.bucket': { en: 'Bucket', zh: '油漆桶' },
    'vp.tileTool.select': { en: 'Select', zh: '选择' },
    'vp.tileTool.eyedropper': { en: 'Eyedropper', zh: '取色器' },
    'vp.tileTool.terrain': { en: 'Terrain', zh: '地形' },

    // — Corner perf HUD + coord readout —
    'vp.hud.frame': { en: 'Frame', zh: '帧耗时' },
    'vp.hud.entities': { en: 'Entities', zh: '实体' },
    'vp.hud.sel': { en: 'Sel', zh: '选中' },

    // — Show Flags dropdown —
    'vp.show': { en: 'Show', zh: '显示' },
    'vp.showFlags': { en: 'Show Flags', zh: '显示标记' },
    'vp.flag.grid': { en: 'Grid', zh: '网格' },
    'vp.flag.gizmos': { en: 'Gizmos', zh: 'Gizmo' },
    'vp.flag.colliders': { en: 'Colliders', zh: '碰撞体' },
    'vp.flag.previewFx': { en: 'Preview FX', zh: '预览特效' },
    'vp.flag.perf': { en: 'Perf', zh: '性能' },

    // — View controls —
    'vp.frameSelected': { en: 'Frame Selected', zh: '聚焦所选' },
    'vp.coordSpaceTitle': {
        en: "Gizmo axes: World / Local (the active object's own axes)",
        zh: 'Gizmo 坐标轴：世界 / 局部（活动对象自身的坐标轴）',
    },
    'vp.coord.local': { en: 'Local', zh: '局部' },
    'vp.coord.world': { en: 'World', zh: '世界' },
    'vp.pivotTitle': {
        en: "Gizmo pivot: Center of selection / the active object's Pivot",
        zh: 'Gizmo 轴心：所选内容的中心 / 活动对象的轴心',
    },
    'vp.pivot.pivot': { en: 'Pivot', zh: '轴心' },
    'vp.pivot.center': { en: 'Center', zh: '中心' },

    // — Design-resolution + device-preview dropdowns (UI mode) —
    'vp.designResTitle': {
        en: 'Design resolution — the canvas you author against. Picking a preset writes Canvas.designResolution (undoable).',
        zh: '设计分辨率——创作时所依据的画布。选择预设会写入 Canvas.designResolution（可撤销）。',
    },
    'vp.designRes': { en: 'Design Resolution', zh: '设计分辨率' },
    'vp.designResExact': { en: 'Exact values: select the Canvas → Inspector', zh: '精确数值：选中 Canvas → 细节面板' },
    'vp.deviceTitle': {
        en: 'Preview device — simulates a target screen (does NOT change the design resolution)',
        zh: '预览设备——模拟目标屏幕（不会更改设计分辨率）',
    },
    'vp.device': { en: 'Device', zh: '设备' },
    'vp.devDesign': { en: 'Design', zh: '设计' },
    'vp.orientation': { en: 'Orientation', zh: '方向' },
    'vp.landscape': { en: 'Landscape', zh: '横屏' },
    'vp.portrait': { en: 'Portrait', zh: '竖屏' },
    'vp.overlay': { en: 'Overlay', zh: '叠加层' },
    'vp.safeArea': { en: 'Safe area', zh: '安全区域' },

    // — Snap dropdown —
    'vp.gridSnap': { en: 'Grid Snap', zh: '网格吸附' },
    'vp.snapOff': { en: 'Off', zh: '关' },
    'vp.snapMove': { en: 'Move (units)', zh: '移动（单位）' },
    'vp.snapRotate': { en: 'Rotate (°)', zh: '旋转（°）' },
    'vp.snapScale': { en: 'Scale (×)', zh: '缩放（×）' },

    // — Play chrome (Play-in-viewport + Game panel) —
    'vp.playFailed': { en: 'Play failed: {error}', zh: '运行失败：{error}' },
    'vp.startingGame': { en: 'Starting game…', zh: '正在启动游戏…' },
    'vp.stopTitle': { en: 'Stop (Esc)', zh: '停止（Esc）' },
    'vp.playingStop': { en: '● Playing · Stop', zh: '● 运行中 · 停止' },
    'vp.playFlag': { en: '● PLAY', zh: '● 运行中' },
    'vp.pressPlay': { en: 'Press Play to run the game.', zh: '点击“运行”启动游戏。' },
    'vp.starting': { en: 'Starting…', zh: '正在启动…' },
    'vp.noMpSession': { en: 'No multiplayer session.', zh: '没有多人会话。' },

    // — Engine boot status —
    'vp.engineFailed': { en: 'Engine failed to start', zh: '引擎启动失败' },
    'vp.booting': { en: 'Booting esengine…', zh: '正在启动 esengine…' },

    // — Perf overlay (fps/p50/p95/p99/ms stay as acronyms) —
    'vp.perfLongFrames': { en: 'long frames', zh: '长帧' },
    'vp.perfTask': { en: 'task', zh: '任务' },

    // — Transform-tool drag hints (tools/transformTools.ts); the quoted UI names
    //   mirror det.placeUnderCanvas / det.position / det.absolute verbatim —
    'vp.orphanUiHint': {
        en: 'This UI element has no Canvas, so it can’t be positioned — add one via Details ▸ “Place under a Canvas”.',
        zh: '此 UI 元素没有 Canvas，无法定位——请通过 细节 ▸ “放置到 Canvas 下” 添加一个。',
    },
    'vp.flowUiHint': {
        en: 'This UI node is Relative (flow-positioned) — set Position to Absolute to move it freely.',
        zh: '此 UI 节点为相对定位（随布局流动）——将“位置”设为“绝对定位”后才能自由移动。',
    },
});
