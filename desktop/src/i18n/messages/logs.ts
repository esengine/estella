// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  logs.ts — Output Log + Profiler panels: filters, toolbar, empty states, group names.
 */
import { defineMessages } from './types';

export const logsMessages = defineMessages({
    // — Output Log: level chips + toolbar —
    'log.all': { en: 'All', zh: '全部' },
    'log.info': { en: 'Info', zh: '信息' },
    'log.warnings': { en: 'Warnings', zh: '警告' },
    'log.errors': { en: 'Errors', zh: '错误' },
    'log.filterPlaceholder': { en: 'Filter', zh: '过滤' },
    'log.categories': { en: 'Categories', zh: '类别' },
    'log.showTimestamps': { en: 'Show timestamps', zh: '显示时间戳' },
    'log.scrollToBottom': { en: 'Scroll to bottom', zh: '滚动到底部' },
    'log.clearLog': { en: 'Clear log', zh: '清空日志' },

    // — Output Log: category filter popover —
    'log.showAll': { en: 'Show All', zh: '全部显示' },
    'log.hideAll': { en: 'Hide All', zh: '全部隐藏' },
    'log.noCategoriesYet': { en: 'No categories yet', zh: '暂无类别' },
    'log.noCategory': { en: '(no category)', zh: '（无类别）' },

    // — Output Log: context menu + save toast —
    'log.copy': { en: 'Copy', zh: '复制' },
    'log.copyAll': { en: 'Copy All', zh: '全部复制' },
    'log.saveLog': { en: 'Save Log…', zh: '保存日志…' },
    'log.clear': { en: 'Clear', zh: '清空' },
    'log.savedLines': { en: 'Saved {count} lines', zh: '已保存 {count} 行' },

    // — Output Log: empty states —
    'log.emptyNoOutput': {
        en: 'No log output yet — engine and script logs appear here.',
        zh: '暂无日志输出——引擎与脚本日志将显示在这里。',
    },
    'log.emptyNoMatch': { en: 'No entries match the filter.', zh: '没有符合过滤条件的条目。' },

    // — Profiler: capture controls —
    'prof.live': { en: 'Live', zh: '实时' },
    'prof.pause': { en: 'Pause', zh: '暂停' },
    'prof.resumeLiveTitle': { en: 'Resume live capture', zh: '恢复实时捕获' },
    'prof.freezeTitle': { en: 'Freeze capture to inspect frames', zh: '冻结捕获以检查帧' },
    'prof.pauseOnHitch': { en: 'Pause on hitch', zh: '卡顿时暂停' },
    'prof.rec': { en: 'Rec', zh: '录制' },
    'prof.stopRecTitle': { en: 'Stop recording', zh: '停止录制' },
    'prof.recordTitle': { en: 'Record a session for export', zh: '录制会话以便导出' },
    'prof.export': { en: 'Export', zh: '导出' },
    'prof.exportTitle': {
        en: 'Export the recorded session (or the live window) as JSON',
        zh: '将录制的会话（或实时窗口）导出为 JSON',
    },
    'prof.pinnedFrame': { en: 'frame #{id} · {ms}ms', zh: '帧 #{id} · {ms}ms' },
    'prof.liveBadge': { en: 'live', zh: '实时' },

    // — Profiler: group chips (the section headers reuse these) —
    'prof.groupFrame': { en: 'Frame', zh: '帧' },
    'prof.groupUnit': { en: 'CPU/GPU', zh: 'CPU/GPU' },
    'prof.groupRender': { en: 'Render', zh: '渲染' },
    'prof.groupCounters': { en: 'Counters', zh: '计数器' },
    'prof.groupMemory': { en: 'Memory', zh: '内存' },
    'prof.groupSystems': { en: 'Systems', zh: '系统' },

    // — Profiler: Frame section —
    'prof.clickToInspect': { en: 'Click a frame to inspect it', zh: '点击某一帧以查看详情' },
    'prof.inspectingFrame': { en: 'inspecting frame #{id} · {ms}ms', zh: '正在查看帧 #{id} · {ms}ms' },
    'prof.hitch': { en: 'hitch', zh: '卡顿' },
    'prof.backToLive': { en: 'back to live', zh: '返回实时' },
    'prof.budget': { en: 'budget {ms}ms', zh: '预算 {ms}ms' },
    'prof.longFrameOne': { en: '{count} long frame', zh: '{count} 个长帧' },
    'prof.longFrames': { en: '{count} long frames', zh: '{count} 个长帧' },
    'prof.worst': { en: 'worst {ms}ms', zh: '最差 {ms}ms' },
    'prof.other': { en: 'other', zh: '其他' },
    'prof.longTaskStat': { en: 'long task {ms}ms (GC/JS)', zh: '长任务 {ms}ms（GC/JS）' },

    // — Profiler: Unit section —
    'prof.unitHeader': { en: 'Unit', zh: '单元' },
    'prof.engine': { en: 'engine', zh: '引擎' },
    'prof.editor': { en: 'editor', zh: '编辑器' },
    'prof.present': { en: 'present', zh: '呈现' },
    'prof.idle': { en: 'idle', zh: '空闲' },
    'prof.na': { en: 'n/a', zh: '不可用' },

    // — Profiler: Render / Memory sections —
    'prof.drawCalls': { en: 'draw calls', zh: '绘制调用' },
    'prof.triangles': { en: 'triangles', zh: '三角形' },
    'prof.entities': { en: 'entities', zh: '实体' },
    'prof.jsHeap': { en: 'js heap', zh: 'JS 堆' },
    'prof.jsHeapLimit': { en: 'js heap limit {mb}MB', zh: 'JS 堆上限 {mb}MB' },

    // — Profiler: pinned-frame breakdown —
    'prof.breakdownHeader': { en: 'Breakdown · frame #{id}', zh: '细分 · 帧 #{id}' },
    'prof.longTaskLabel': { en: '⚠ long task', zh: '⚠ 长任务' },
    'prof.gcUninstrumented': { en: '· GC / uninstrumented JS', zh: '· GC / 未插桩的 JS' },
    'prof.measured': { en: 'measured {measured}ms of {total}ms', zh: '已测量 {measured}ms（共 {total}ms）' },
    'prof.unattributed': { en: '{ms}ms unattributed', zh: '{ms}ms 未归因' },
    'prof.browserPaintGc': { en: 'browser paint / GC', zh: '浏览器绘制 / GC' },

    // — Profiler: Systems section —
    'prof.thisFrame': { en: 'this frame', zh: '当前帧' },
    'prof.noSystemTimings': { en: 'No system timings yet.', zh: '暂无系统耗时数据。' },
});
