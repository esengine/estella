// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  settings.ts — the settings surface: dialog chrome, nav categories,
 *        sections, group headers, and every registered setting's label +
 *        description. Key convention: `set.<setting id>` for the label and
 *        `set.<setting id>.desc` for the description; `set.section.<id>` /
 *        `set.group.<name>` for the structure around them.
 */
import { defineMessages } from './types';

export const settingsMessages = defineMessages({
    // — Dialog chrome —
    'set.title': { en: 'Settings', zh: '设置' },
    'set.search': { en: 'Search settings…', zh: '搜索设置…' },
    'set.noMatch': { en: 'No settings match “{query}”.', zh: '没有匹配“{query}”的设置。' },
    'set.resetDefault': { en: 'Reset to default', zh: '重置为默认值' },
    'set.closeEsc': { en: 'Close (Esc)', zh: '关闭 (Esc)' },
    'set.pressKeys': { en: 'Press keys…', zh: '请按键…' },
    'set.unbound': { en: 'Unbound', zh: '未绑定' },
    'set.rebindHint': { en: 'Click to rebind', zh: '点击重新绑定' },
    'set.layerN': { en: 'Layer {i}', zh: '层 {i}' },

    // — Nav categories —
    'set.cat.editor': { en: 'Editor', zh: '编辑器' },
    'set.cat.project': { en: 'Project', zh: '项目' },
    'set.cat.plugin': { en: 'Plugins', zh: '插件' },

    // — Sections —
    'set.section.appearance': { en: 'Appearance', zh: '外观' },
    'set.section.viewport': { en: 'Viewport', zh: '视口' },
    'set.section.performance': { en: 'Performance', zh: '性能' },
    'set.section.shortcuts': { en: 'Keyboard Shortcuts', zh: '键盘快捷键' },
    'set.section.console': { en: 'Console', zh: '控制台' },
    'set.section.renderer': { en: 'Renderer', zh: '渲染器' },
    'set.section.display': { en: 'Display', zh: '显示' },
    'set.section.physics': { en: 'Physics', zh: '物理' },
    'set.section.rendering': { en: 'Rendering', zh: '渲染' },
    'set.section.packaging': { en: 'Packaging', zh: '打包' },

    // — Group headers —
    'set.group.appearance': { en: 'Appearance', zh: '外观' },
    'set.group.grid': { en: 'Grid', zh: '网格' },
    'set.group.gizmos': { en: 'Gizmos', zh: 'Gizmo' },
    'set.group.background': { en: 'Background', zh: '后台' },
    'set.group.console': { en: 'Console', zh: '控制台' },
    'set.group.renderer': { en: 'Renderer', zh: '渲染器' },
    'set.group.designResolution': { en: 'Design Resolution', zh: '设计分辨率' },
    'set.group.sortingLayers': { en: 'Sorting Layers', zh: '排序层' },
    'set.group.ySort': { en: 'Y-Sort', zh: 'Y 轴排序' },
    'set.group.colorSpace': { en: 'Color Space', zh: '色彩空间' },
    'set.group.physics': { en: 'Physics', zh: '物理' },
    'set.group.gravity': { en: 'Gravity', zh: '重力' },
    'set.group.collisionLayers': { en: 'Collision Layers', zh: '碰撞层' },
    'set.group.solver': { en: 'Solver', zh: '求解器' },
    'set.group.wechat': { en: 'WeChat', zh: '微信' },
    'set.group.desktop': { en: 'Desktop', zh: '桌面' },

    // — Editor settings —
    'set.appearance.language': { en: 'Language', zh: '语言' },
    'set.appearance.language.desc': {
        en: 'Editor display language. Takes effect after a reload.',
        zh: '编辑器界面语言。重新加载后生效。',
    },
    'set.appearance.accent': { en: 'Accent color', zh: '强调色' },
    'set.appearance.accent.desc': {
        en: 'Used for selection, active controls, and focus.',
        zh: '用于选中、激活控件与焦点高亮。',
    },
    'set.appearance.uiScale': { en: 'UI scale', zh: '界面缩放' },
    'set.appearance.uiScale.desc': {
        en: 'Scales every panel — fonts and controls.',
        zh: '缩放所有面板——字体与控件。',
    },
    'set.renderer.backend': { en: 'Graphics backend', zh: '图形后端' },
    'set.renderer.backend.desc': {
        en: 'Which GPU API the viewport renders through. Applies on engine reload (Ctrl+R). WebGPU falls back to WebGL2 automatically if no adapter is available.',
        zh: '视口使用的 GPU 图形接口。引擎重载（Ctrl+R）后生效。无可用适配器时 WebGPU 自动回退到 WebGL2。',
    },
    'set.viewport.showGrid': { en: 'Show grid', zh: '显示网格' },
    'set.viewport.gridSize': { en: 'Grid size', zh: '网格大小' },
    'set.viewport.gridSize.desc': {
        en: 'World-unit spacing of the scene grid (and Move snap).',
        zh: '场景网格的世界单位间距（同时是移动吸附步长）。',
    },
    'set.viewport.snapping': { en: 'Snap to grid', zh: '吸附到网格' },
    'set.viewport.showGizmos': { en: 'Show gizmos', zh: '显示 Gizmo' },
    'set.performance.useLessCpuInBackground': { en: 'Use less CPU in background', zh: '后台降低 CPU 占用' },
    'set.performance.useLessCpuInBackground.desc': {
        en: 'Caps the engine at 10 fps while the editor window is unfocused.',
        zh: '编辑器窗口失焦时将引擎限制为 10 fps。',
    },
    'set.console.maxLines': { en: 'Max retained lines', zh: '最大保留行数' },
    'set.console.maxLines.desc': {
        en: 'Output Log keeps at most this many entries.',
        zh: '输出日志最多保留的条目数。',
    },

    // — Project settings —
    'set.project.display.width': { en: 'Width', zh: '宽度' },
    'set.project.display.width.desc': {
        en: 'Reference resolution new Canvas entities are created at; each Canvas keeps its own value afterwards.',
        zh: '新建 Canvas 实体使用的参考分辨率；创建后每个 Canvas 保留自己的值。',
    },
    'set.project.display.height': { en: 'Height', zh: '高度' },
    'set.project.display.orientation': { en: 'Orientation', zh: '屏幕方向' },
    'set.project.display.orientation.desc': {
        en: 'Screen orientation for every export target (WeChat, playable, web, desktop). Defaults to the design resolution’s aspect — override to lock a specific orientation.',
        zh: '所有导出目标（微信、Playable、Web、桌面）的屏幕方向。默认取设计分辨率的宽高比 — 可覆盖以锁定特定方向。',
    },
    'set.project.rendering.sortingLayers': { en: 'Layer names', zh: '层名称' },
    'set.project.rendering.sortingLayers.desc': {
        en: 'Name render sorting layers (lowest first); a render `layer` field then picks from them instead of a raw number.',
        zh: '为渲染排序层命名（最低层在前）；渲染组件的 layer 字段将从中选择，而非填原始数字。',
    },
    'set.project.rendering.colorSpace': { en: 'Color space', zh: '色彩空间' },
    'set.project.rendering.colorSpace.desc': {
        en: 'Linear renders in physically-correct linear light: textures decode from sRGB on sample, lights and tints blend linearly, and the final frame encodes back to sRGB. Gamma is the classic pipeline. Applies to the editor, Play, and every export after a reload.',
        zh: '线性模式以物理正确的线性光渲染：纹理采样时从 sRGB 解码、光照与染色在线性空间混合、最终画面编码回 sRGB。伽马为经典管线。重新加载后对编辑器、运行预览和所有导出生效。',
    },
    'set.project.rendering.colorSpace.gamma': { en: 'Gamma', zh: '伽马' },
    'set.project.rendering.colorSpace.linear': { en: 'Linear', zh: '线性' },
    'set.project.rendering.ySortLayers': { en: 'Y-sorted layers', zh: 'Y 轴排序层' },
    'set.project.rendering.ySortLayers.desc': {
        en: 'Entities on a checked layer draw in world-Y order (lower on screen on top) — top-down occlusion. Within a y-sorted layer, paint order wins over material batching.',
        zh: '勾选层上的实体按世界 Y 排序绘制（屏幕位置越低越靠上）——俯视视角遮挡。同一 Y 排序层内，绘制顺序优先于材质合批。',
    },
    'set.project.physics.enabled': { en: 'Enable physics', zh: '启用物理' },
    'set.project.physics.enabled.desc': {
        en: 'Install the Box2D world when this project plays — required for bodies a script spawns at runtime.',
        zh: '项目运行时安装 Box2D 物理世界——脚本在运行时生成刚体也需要它。',
    },
    'set.project.physics.gravityX': { en: 'Gravity X', zh: '重力 X' },
    'set.project.physics.gravityY': { en: 'Gravity Y', zh: '重力 Y' },
    'set.project.physics.gravityY.desc': {
        en: 'Negative pulls down (Box2D default −9.81).',
        zh: '负值向下（Box2D 默认 −9.81）。',
    },
    'set.project.physics.collisionLayers': { en: 'Layer names', zh: '层名称' },
    'set.project.physics.collisionLayers.desc': {
        en: 'Names for the 16 collision-filter layers — shown in collider Category/Mask pickers.',
        zh: '16 个碰撞过滤层的名称——显示在碰撞体的 Category/Mask 选择器中。',
    },
    'set.project.physics.collisionMatrix': { en: 'Collision matrix', zh: '碰撞矩阵' },
    'set.project.physics.collisionMatrix.desc': {
        en: 'Which layers collide. A collider on a single named layer derives its mask from this row (so it overrides the collider’s own Mask). All-on = no restriction.',
        zh: '哪些层之间发生碰撞。位于单个命名层上的碰撞体由该行推导掩码（会覆盖其自身的 Mask）。全开 = 无限制。',
    },
    'set.project.physics.fixedTimestep': { en: 'Fixed timestep', zh: '固定时间步长' },
    'set.project.physics.fixedTimestep.desc': {
        en: 'Simulation step size; smaller is more accurate but costlier. Default 1/60.',
        zh: '模拟步长；越小越精确但开销越大。默认 1/60。',
    },
    'set.project.physics.subStepCount': { en: 'Sub-steps', zh: '子步数' },
    'set.project.physics.subStepCount.desc': {
        en: 'Solver sub-steps per step — higher firms up stacks/joints at more cost. Default 4.',
        zh: '每步的求解器子步数——更高让堆叠/关节更稳定，开销也更大。默认 4。',
    },
    'set.project.physics.contactHertz': { en: 'Contact Hz', zh: '接触频率' },
    'set.project.physics.contactHertz.desc': {
        en: 'Contact stiffness frequency. Default 120.',
        zh: '接触刚度频率。默认 120。',
    },
    'set.project.physics.contactDampingRatio': { en: 'Contact damping', zh: '接触阻尼' },
    'set.project.physics.contactDampingRatio.desc': {
        en: 'Contact damping ratio. Default 10.',
        zh: '接触阻尼比。默认 10。',
    },
    'set.project.physics.contactSpeed': { en: 'Contact push speed', zh: '接触推出速度' },
    'set.project.physics.contactSpeed.desc': {
        en: 'Max speed used to resolve overlap. Default 10.',
        zh: '解除重叠使用的最大速度。默认 10。',
    },
    'set.project.physics.enableSleep': { en: 'Allow sleeping', zh: '允许休眠' },
    'set.project.physics.enableSleep.desc': {
        en: 'Let resting bodies sleep to save CPU (Box2D default on).',
        zh: '让静止刚体休眠以节省 CPU（Box2D 默认开启）。',
    },
    'set.project.physics.enableContinuous': { en: 'Continuous collision', zh: '连续碰撞检测' },
    'set.project.physics.enableContinuous.desc': {
        en: 'Anti-tunneling for fast bodies (Box2D default on).',
        zh: '高速刚体的防穿透（Box2D 默认开启）。',
    },
    'set.project.packaging.wechat.appid': { en: 'AppID', zh: 'AppID' },
    'set.project.packaging.wechat.appid.desc': {
        en: 'Your WeChat MiniGame appid — written into project.config.json on export.',
        zh: '微信小游戏的 appid——导出时写入 project.config.json。',
    },
    'set.orientation.portrait': { en: 'Portrait', zh: '竖屏' },
    'set.orientation.landscape': { en: 'Landscape', zh: '横屏' },
    'set.project.packaging.desktop.appId': { en: 'App ID', zh: 'App ID' },
    'set.project.packaging.desktop.appId.desc': {
        en: 'Reverse-DNS id for the installer (electron-builder appId), e.g. com.studio.game.',
        zh: '安装包的反向域名 id（electron-builder appId），例如 com.studio.game。',
    },
    'set.project.packaging.desktop.productName': { en: 'Product name', zh: '产品名称' },
    'set.project.packaging.desktop.productName.desc': {
        en: 'Display name for the desktop app + installer (defaults to the project name).',
        zh: '桌面应用与安装包的显示名称（默认为项目名）。',
    },

    // — Setting-fired feedback —
    'toast.langReload': {
        en: 'Reload to switch the editor language',
        zh: '重新加载以切换编辑器语言',
    },
    'toast.backendReload': {
        en: 'Reload to render with {backend}',
        zh: '重新加载后使用 {backend} 渲染',
    },
    'toast.colorSpaceReload': {
        en: 'Reload to apply the new color space',
        zh: '重新加载后应用新的色彩空间',
    },
});
