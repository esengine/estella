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
    'fb.field.zoom': { en: 'Zoom', zh: '缩放' },
    'fb.loop': { en: 'Loop', zh: '循环' },
    'fb.frameCount': { en: '{count} frames', zh: '{count} 帧' },
    'fb.animClip': { en: 'Animation Clip', zh: '动画剪辑' },
    'fb.insp.animation': { en: 'Animation', zh: '动画' },
    'fb.insp.sheet': { en: 'Sprite Sheet', zh: '精灵表' },
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
