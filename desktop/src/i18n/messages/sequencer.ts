// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sequencer.ts — the Sequencer (timeline/animation) panel and timeline documents.
 */
import { defineMessages } from './types';

export const sequencerMessages = defineMessages({
    // — empty state —
    'seq.empty.title': { en: 'No animation open', zh: '未打开动画' },
    'seq.empty.hint': {
        en: 'Create a new animation, or double-click an existing .esanim in the Content Browser.',
        zh: '新建一个动画，或在内容浏览器中双击已有的 .esanim 文件。',
    },
    'seq.empty.new': { en: 'New animation', zh: '新建动画' },
    'seq.empty.step1': {
        en: 'Select an object in the scene, then click Bind in the toolbar to attach the preview to it',
        zh: '在场景中选中一个对象，然后点击工具栏中的绑定，将预览附加到它',
    },
    'seq.empty.step2': {
        en: 'Turn on Record, then move/rotate it or edit properties — keyframes are recorded automatically',
        zh: '开启录制，然后移动/旋转它或编辑属性——关键帧会自动录制',
    },
    'seq.empty.step3': {
        en: 'Drag the playhead to preview, then click Save to write back to the file',
        zh: '拖动播放头进行预览，然后点击保存写回文件',
    },

    // — transport bar —
    'seq.unnamed': { en: 'Unnamed', zh: '未命名' },
    'seq.metaSummary': { en: '· {frames} frames · {fps}fps · {wrap}', zh: '· {frames} 帧 · {fps}fps · {wrap}' },
    'seq.bindTitle': { en: 'Bind preview to the selected entity', zh: '将预览绑定到所选实体' },
    'seq.unbound': { en: 'Unbound', zh: '未绑定' },
    'seq.recordTitle': { en: 'Record: property edits auto-key', zh: '录制：编辑属性时自动打关键帧' },
    'seq.jumpStart': { en: 'Jump to start', zh: '跳到开头' },
    'seq.prevKeyframe': { en: 'Previous keyframe', zh: '上一个关键帧' },
    'seq.playPause': { en: 'Play / pause (Space)', zh: '播放 / 暂停（空格）' },
    'seq.nextKeyframe': { en: 'Next keyframe', zh: '下一个关键帧' },
    'seq.jumpEnd': { en: 'Jump to end', zh: '跳到结尾' },
    'seq.frameWord': { en: 'Frame', zh: '帧' },
    'seq.tabSheet': { en: 'Sheet', zh: '摄影表' },
    'seq.tabCurves': { en: 'Curves', zh: '曲线' },
    'seq.snapTitle': { en: 'Snap to frame', zh: '吸附到帧' },
    'seq.settingsTitle': { en: 'Clip settings (duration / fps / loop)', zh: '剪辑设置（时长 / 帧率 / 循环）' },
    'seq.addTrack': { en: 'Add track', zh: '添加轨道' },
    'seq.trackBtn': { en: 'Track', zh: '轨道' },
    'seq.saveTitle': { en: 'Save animation', zh: '保存动画' },
    'seq.save': { en: 'Save', zh: '保存' },

    // — track tree + lanes —
    'seq.tracksHead': { en: 'Tracks', zh: '轨道' },
    'seq.rootEntity': { en: 'Root entity', zh: '根实体' },
    'seq.keyAtPlayhead': { en: 'Key at playhead', zh: '在播放头处打关键帧' },
    'seq.muteTrack': { en: 'Mute track', zh: '禁用轨道' },
    'seq.unmuteTrack': { en: 'Unmute track', zh: '启用轨道' },
    'seq.frameTip': { en: 'Frame {frame}', zh: '第 {frame} 帧' },
    'seq.deleteTrack': { en: 'Delete track', zh: '删除轨道' },

    // — add-track picker —
    'seq.noAnimatable': { en: 'No animatable properties to add', zh: '没有可添加的可动画属性' },

    // — clip settings popover —
    'seq.clipSettings': { en: 'Clip settings', zh: '剪辑设置' },
    'seq.durationS': { en: 'Duration (s)', zh: '时长（秒）' },
    'seq.frameRateFps': { en: 'Frame rate (fps)', zh: '帧率（fps）' },
    'seq.insp.timeline': { en: 'Timeline', zh: '时间轴' },
    'seq.insp.keyframe': { en: 'Keyframe', zh: '关键帧' },
    'seq.field.value': { en: 'Value', zh: '值' },
    'seq.field.interp': { en: 'Interpolation', zh: '插值' },
    'seq.timelineClip': { en: 'Timeline', zh: '时间轴' },
    'seq.field.duration': { en: 'Duration', zh: '持续时间' },
    'seq.field.fps': { en: 'FPS', zh: '帧率' },
    'seq.field.wrap': { en: 'Wrap Mode', zh: '循环模式' },
    'seq.wrap.once': { en: 'Once', zh: '单次' },
    'seq.wrap.loop': { en: 'Loop', zh: '循环' },
    'seq.wrap.pingPong': { en: 'Ping-pong', zh: '往返' },

    // — keyframe interpolation popover —
    'seq.interpTitle': { en: 'Interpolation', zh: '插值' },
    'seq.interp.auto': { en: 'Auto (smooth)', zh: '自动（平滑）' },
    'seq.interp.linear': { en: 'Linear', zh: '线性' },
    'seq.interp.step': { en: 'Step (constant)', zh: '阶梯（恒定）' },
    'seq.interp.easeInOut': { en: 'Ease in-out', zh: '缓入缓出' },
    'seq.deleteKeyframe': { en: 'Delete keyframe', zh: '删除关键帧' },

    // — status strip —
    'seq.footRecording': { en: '● Recording', zh: '● 录制中' },
    'seq.footIdle': { en: 'Animation edit', zh: '动画编辑' },
    'seq.keysUnit': { en: 'keys', zh: '个关键帧' },
    'seq.tracksUnit': { en: 'tracks', zh: '条轨道' },

    // — toasts (openClip.ts / TimelineCommands.ts) —
    'seq.toast.openFailed': { en: 'Failed to open animation: {error}', zh: '打开动画失败：{error}' },
    'seq.toast.createFailed': { en: 'Failed to create animation: {error}', zh: '创建动画失败：{error}' },
    'seq.toast.created': { en: 'Created animation: {name}', zh: '已创建动画：{name}' },
    'seq.toast.noFile': {
        en: 'Animation has no file (sample clips cannot be saved)',
        zh: '动画没有对应的文件（示例剪辑无法保存）',
    },
    'seq.toast.saved': { en: 'Animation saved', zh: '动画已保存' },
    'seq.toast.saveFailed': { en: 'Failed to save: {error}', zh: '保存失败：{error}' },
});
