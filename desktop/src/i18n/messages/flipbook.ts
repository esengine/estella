// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  flipbook.ts — Flipbook editor: sheet slicing grid, frame strip, preview.
 */
import { defineMessages } from './types';

export const flipbookMessages = defineMessages({
    'fb.panelTitle': { en: 'Sprite Animation', zh: '精灵动画' },
    'fb.noOpen': { en: 'No sprite animation open.', zh: '未打开精灵动画。' },
    'fb.noOpenHint': {
        en: 'Right-click a texture in the Content Browser and choose "Create Sprite Animation", or double-click a .esanim asset.',
        zh: '在内容浏览器中右键纹理并选择「创建精灵动画」，或双击 .esanim 资产。',
    },
    'fb.noSheet': {
        en: 'This clip uses per-frame textures (no sheet to slice).',
        zh: '此剪辑使用逐帧纹理（没有可切片的精灵表）。',
    },

    // — Toolbar —
    'fb.field.cellW': { en: 'Cell W', zh: '格宽' },
    'fb.field.cellH': { en: 'Cell H', zh: '格高' },
    'fb.field.margin': { en: 'Margin', zh: '边距' },
    'fb.field.spacing': { en: 'Spacing', zh: '间距' },
    'fb.field.fps': { en: 'FPS', zh: '帧率' },
    'fb.loop': { en: 'Loop', zh: '循环' },
    'fb.fps': { en: 'FPS', zh: '帧率' },
    'fb.frameCount': { en: '{count} frames', zh: '{count} 帧' },
    'fb.animClip': { en: 'Animation Clip', zh: '动画剪辑' },
    'fb.insp.animation': { en: 'Animation', zh: '动画' },
    'fb.insp.sheet': { en: 'Sprite Sheet', zh: '精灵表' },
    'fb.field.loopMode': { en: 'Loop Mode', zh: '循环模式' },
    'fb.loopMode.once': { en: "Don't loop", zh: '不循环' },
    'fb.loopMode.loop': { en: 'Loop', zh: '循环' },
    'fb.events': { en: 'Events', zh: '动画事件' },
    'fb.addEvent': { en: 'Add event', zh: '添加事件' },
    'fb.event.default': { en: 'event', zh: '事件' },
    'fb.event.onFrame': { en: 'Fires on this frame', zh: '在此帧触发' },
    'fb.event.remove': { en: 'Remove event', zh: '移除事件' },
    'fb.events.empty': { en: 'No events — add one at the current frame', zh: '暂无事件——在当前帧添加一个' },
    'fb.anchor': { en: 'Anchor', zh: '锚点' },
    'fb.anchor.tip': {
        en: "Per-frame anchor: drive the sprite's pivot from the clip so the artwork can shift inside the cell without the character sliding. Off = playback leaves the entity's own pivot alone.",
        zh: '逐帧锚点：由剪辑驱动精灵的中心点，画面在格子里位移时角色也不会跟着滑动。关闭 = 播放不触碰实体自身的中心点。',
    },
    'fb.anchor.x': { en: 'Anchor X', zh: '锚点 X' },
    'fb.anchor.y': { en: 'Anchor Y', zh: '锚点 Y' },
    'fb.anchor.frameTip': {
        en: 'Anchor of the current frame (0–1 of the frame, 0,0 = bottom-left). Editing it overrides the clip anchor for this frame only.',
        zh: '当前帧的锚点（0–1，相对该帧，0,0 = 左下角）。修改后仅覆盖此帧，其余帧仍用剪辑锚点。',
    },
    'fb.anchor.dragTip': { en: 'Drag to anchor this frame', zh: '拖动以设置此帧锚点' },
    'fb.anchor.clearFrame': { en: 'Clear this frame’s anchor override', zh: '清除此帧的锚点覆盖' },
    'fb.anchor.overridden': { en: 'Anchored separately from the clip', zh: '锚点已单独覆盖' },
    'fb.field.pivot': { en: 'Default Anchor', zh: '默认锚点' },
    'fb.field.pivotTip': {
        en: 'Clip-wide anchor (0–1 of the frame, 0,0 = bottom-left) — frames without their own anchor inherit it. Written onto Sprite.pivot during playback.',
        zh: '整段剪辑的锚点（0–1，相对帧，0,0 = 左下角）——没有自己锚点的帧继承它。播放时写入 Sprite.pivot。',
    },
    'fb.onion': { en: 'Onion skin', zh: '洋葱皮' },
    'fb.onionFrames': { en: 'Frames', zh: '帧数' },
    'fb.onionTip': { en: 'Ghost the nearest frames behind the current one (while paused)', zh: '暂停时在当前帧后叠印相邻帧,便于对位' },
    'fb.save': { en: 'Save', zh: '保存' },

    // — Sheet canvas —
    'fb.cell.appendTip': { en: 'Click or drag to append frame #{cell}', zh: '点击或拖动以追加帧 #{cell}' },
    'fb.texNotFound': { en: 'Sheet texture not found: {ref}', zh: '未找到精灵表纹理：{ref}' },
    'fb.refEmpty': { en: '(empty)', zh: '（空）' },

    // — Playback + frame strip —
    'fb.preview': { en: 'Looping preview', zh: '循环预览' },
    'fb.prevFrame': { en: 'Previous frame', zh: '上一帧' },
    'fb.nextFrame': { en: 'Next frame', zh: '下一帧' },
    'fb.frame.scrubTip': { en: 'Go to this frame', zh: '跳到此帧' },
    'fb.addFrames': { en: 'Click sheet cells to add frames', zh: '点击精灵表格子以添加帧' },
    'fb.appendFrames': { en: 'Click cells to append · drag frames to reorder', zh: '点击格子追加 · 拖动帧以重排' },
    'fb.frame.durTip': { en: 'Frame duration in ms (empty = 1000 / FPS)', zh: '帧时长（毫秒，留空 = 1000 / 帧率）' },
    'fb.frame.remove': { en: 'Remove frame', zh: '移除帧' },
    'fb.frame.invalidTip': {
        en: 'Cell #{cell} is outside the current grid — re-slice or remove the frame',
        zh: '格子 #{cell} 超出当前网格——请重新切片或移除该帧',
    },
    'fb.clearFrames': { en: 'Clear all frames', zh: '清空所有帧' },

    // — Toasts —
    'fb.toast.saved': { en: 'Sprite animation saved', zh: '精灵动画已保存' },
    'fb.toast.saveFailed': { en: 'Save failed: {error}', zh: '保存失败：{error}' },
    'fb.toast.openFailed': { en: 'Failed to open sprite animation: {error}', zh: '打开精灵动画失败：{error}' },
    'fb.toast.createFailed': { en: 'Failed to create sprite animation: {error}', zh: '创建精灵动画失败：{error}' },
    'fb.toast.created': { en: 'Created {name}', zh: '已创建 {name}' },
    'fb.toast.clipUntracked': {
        en: 'This animation is not in the asset database yet (missing .meta)',
        zh: '该动画尚未进入资产数据库（缺少 .meta）',
    },
    'fb.toast.texUntracked': {
        en: 'This texture is not in the asset database yet (missing .meta)',
        zh: '该纹理尚未进入资产数据库（缺少 .meta）',
    },
});
