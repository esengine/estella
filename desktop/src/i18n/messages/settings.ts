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
    'set.rebindConflict': {
        en: '{keys} is also bound to “{cmd}” — one may shadow the other',
        zh: '{keys} 也绑定了“{cmd}”——两者可能相互覆盖',
    },
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
    'set.section.externalTools': { en: 'External Tools', zh: '外部工具' },
    'set.section.agents': { en: 'AI Agents', zh: 'AI 代理' },
    'toast.programMissing': {
      en: 'Could not find {program} — it may have been moved or uninstalled',
      zh: '找不到 {program}，可能已被移动或卸载',
    },
    'toast.programFailed': { en: 'Could not start {program}', zh: '无法启动 {program}' },
    'toast.mcpFailed': {
      en: 'Could not open the port for AI agents: {message}',
      zh: '无法为 AI 代理开启端口：{message}',
    },
    'toast.openFailed': { en: 'No program is set up to open this file', zh: '没有可打开该文件的程序' },
    'set.externalTools.placeholder': { en: 'Automatic — the system default', zh: '自动 — 使用系统默认程序' },
    'set.externalTools.autoNamed': { en: 'Automatic ({program})', zh: '自动（{program}）' },
    'set.externalTools.script': { en: 'Script editor', zh: '默认脚本编辑器' },
    'set.externalTools.script.desc': {
      en: 'Opens .ts, .js and .esshader files, with the project alongside so types resolve.',
      zh: '用于打开 .ts、.js 和 .esshader 文件；会连同项目一起打开，类型才能解析。',
    },
    'set.externalTools.image': { en: 'Image editor', zh: '默认图片编辑器' },
    'set.externalTools.image.desc': {
      en: 'Opens .png, .webp, .jpg and .gif files.',
      zh: '用于打开 .png、.webp、.jpg 和 .gif 文件。',
    },
    'set.externalTools.browser': { en: 'Browser', zh: '默认浏览器' },
    'set.externalTools.browser.desc': {
      en: 'Opens documentation links and web build previews.',
      zh: '用于打开文档链接和 Web 构建预览。',
    },
    'set.section.display': { en: 'Display', zh: '显示' },
    'set.section.physics': { en: 'Physics', zh: '物理' },
    'set.section.rendering': { en: 'Rendering', zh: '渲染' },
    'set.section.ui': { en: 'UI', zh: 'UI' },
    'set.group.uiTheme': { en: 'Widget Theme', zh: '控件主题' },
    'set.project.ui.theme': { en: 'Theme', zh: '主题' },
    'set.project.ui.theme.desc': {
        en: 'Design-token palette for the built-in widgets. Applied when the game boots; themed widgets (including placed prefabs) re-resolve their colors.',
        zh: '内置控件的设计令牌配色。游戏启动时应用;带主题标记的控件(包括摆放的预制体)会重新解析颜色。',
    },
    'set.project.ui.theme.dark': { en: 'Dark', zh: '暗色' },
    'set.project.ui.theme.light': { en: 'Light', zh: '亮色' },
    'set.group.uiThemeColors': { en: 'Theme Colors', zh: '主题颜色' },
    'set.project.ui.color.desc': {
        en: 'Overrides this role for the whole project; unset inherits the base theme. The viewport and shipped builds resolve identically.',
        zh: '为整个项目覆盖该颜色角色;不设置则继承基础主题。视口与导出成品解析一致。',
    },
    'set.inherited': { en: 'inherited', zh: '继承' },
    'set.section.packaging': { en: 'Packaging', zh: '打包' },

    // — Group headers —
    'set.group.appearance': { en: 'Appearance', zh: '外观' },
    'set.group.grid': { en: 'Grid', zh: '网格' },
    'set.group.gizmos': { en: 'Gizmos', zh: 'Gizmo' },
    'set.group.background': { en: 'Background', zh: '后台' },
    'set.group.console': { en: 'Console', zh: '控制台' },
    'set.group.renderer': { en: 'Renderer', zh: '渲染器' },
    'set.group.builtinAgent': { en: 'Built-in Agent', zh: '内置 Agent' },
    'set.group.agents': { en: 'External Agents', zh: '外部代理' },

    // — A credential the editor holds but never shows —
    'set.secret.stored': { en: 'Stored', zh: '已配置' },
    'set.secret.store': { en: 'Store it', zh: '保存' },
    'set.secret.forget': { en: 'Forget it', zh: '清除' },
    'set.secret.needed': { en: 'Add key', zh: '添加密钥' },
    'set.secret.noKeychain': {
        en: 'This machine has no keychain to encrypt with, so nothing can be stored here. On Linux, install GNOME Keyring or KWallet, or start the editor with --password-store=gnome-libsecret.',
        zh: '这台机器没有可用于加密的密钥库，因此无法保存。Linux 上请安装 GNOME Keyring 或 KWallet，或以 --password-store=gnome-libsecret 启动编辑器。',
    },
    'set.secret.obfuscated': {
        en: 'No system keychain was found, so this is only obfuscated on disk — anyone with your files can read it back. Installing GNOME Keyring or KWallet upgrades it.',
        zh: '没有找到系统密钥库，因此只是在磁盘上做了混淆——拿到你文件的人即可还原。安装 GNOME Keyring 或 KWallet 后会自动改用它。',
    },
    'set.secret.damaged': {
        en: 'The stored value cannot be decrypted on this machine ({message}) — it was most likely sealed by another one. Enter it again.',
        zh: '已保存的值在这台机器上无法解密（{message}），多半是在另一台机器上加密的。请重新输入。',
    },

    // — AI Agents —
    'set.agents.providerKey': { en: '{provider} API key', zh: '{provider} API 密钥' },
    'set.agents.providerKey.desc': {
        en: 'Held by the system keychain — never written to the project or the settings file, and never handed back to this window. Every provider keeps its own, so switching back to one costs nothing.',
        zh: '存在系统钥匙串里——不写进项目、不写进设置文件,也不会交回给这个窗口。每个提供方各存各的,切回来不用重输。',
    },
    'set.group.customProvider': { en: 'Your providers', zh: '你的提供方' },
    'set.agents.effort': { en: 'Reasoning depth', zh: '思考深度' },
    'set.agents.effort.desc': {
        en: 'How hard the model is asked to think before it acts. `xhigh` is what agentic work is for and is the default; drop it when a turn costs more or takes longer than the task deserved. Applies to the next conversation.',
        zh: '模型动手之前被要求思考到什么程度。`xhigh` 是为 agent 类工作准备的,也是默认值;当一次运行的花费或耗时超过这件事本身的价值时,把它调低。对下一次对话生效。',
    },
    'set.agents.providerModels': { en: '{provider} models', zh: '{provider} 型号' },
    'set.agents.providerModels.desc': {
        en: 'Which models to offer in the composer, comma- or newline-separated. Typed rather than shipped: a list here would be right until the vendor\'s next release, and a name that no longer exists is not refused — the endpoint serves something smaller instead, for the rest of the session.',
        zh: '在输入框旁边可选的型号,用逗号或换行分隔。要自己填而不是内置:内置的列表只能正确到厂商下次发布为止,而写了个已经不存在的名字并不会被拒绝——接口会改用一个更小的模型顶上,并且一整个会话都是如此。',
    },
    'set.agents.protocol.openai': { en: 'OpenAI (Chat Completions)', zh: 'OpenAI(Chat Completions)' },
    'set.agents.protocol.anthropic': { en: 'Anthropic (Messages)', zh: 'Anthropic(Messages)' },
    // In a table cell the long form is truncated to something no shorter and far
    // less readable; which format each name means is the row's description.
    'set.agents.protocolShort.openai': { en: 'OpenAI', zh: 'OpenAI' },
    'set.agents.protocolShort.anthropic': { en: 'Anthropic', zh: 'Anthropic' },
    'set.agents.providers': { en: 'Endpoints', zh: '接口' },
    'set.agents.providers.desc': {
        en: 'Endpoints of your own — a local runner, a company gateway, a vendor not in the list above. Each keeps its own key and appears in the composer under its own name. The expander holds what the endpoint can DO: what it cannot be told, the agent has to work around.',
        zh: '你自己的接口——本地运行器、公司网关,或者上面列表里没有的厂商。每一条各存各的密钥,并以自己的名字出现在输入框的模型选择器里。展开项里是这个接口「能做什么」:没告诉它的部分,Agent 只能绕着走。',
    },
    'set.agents.providers.empty': {
        en: 'None yet. The built-in providers above cover the major vendors; add one here for anything else that speaks either protocol.',
        zh: '还没有。上面的内置提供方覆盖了主要厂商;讲这两种协议中任意一种的其它接口,在这里添加。',
    },
    'set.agents.addProvider': { en: 'Add a provider', zh: '添加提供方' },
    'set.agents.col.label': { en: 'Name', zh: '名称' },
    'set.agents.col.protocol': { en: 'Protocol', zh: '协议' },
    'set.agents.col.baseUrl': { en: 'Endpoint', zh: 'API 地址' },
    'set.agents.col.models': { en: 'Models', zh: '模型' },
    'set.agents.col.key': { en: 'Key', zh: '密钥' },
    'set.agents.capabilities': { en: 'What it can do', zh: '它能做什么' },
    'set.agents.col.contextWindow': { en: 'Context window', zh: '上下文窗口' },
    'set.agents.col.reasoningEffort': { en: 'Takes a reasoning-depth argument', zh: '接受思考深度参数' },
    'set.agents.err.baseUrl': { en: 'This provider has no endpoint address.', zh: '这个提供方还没有填接口地址。' },
    'set.agents.err.models': { en: 'No models, so nothing to pick in the composer.', zh: '没有填模型,输入框里就没有可选项。' },
    'set.agents.customVision': { en: 'Accepts images', zh: '接受图片' },
    'set.agents.customVision.desc': {
        en: 'Turn on only if this endpoint\'s models can see. The agent takes screenshots to check its own work; where they cannot be sent it asks for the same frame as a coarse text grid instead, and says so in the transcript. Claiming sight an endpoint lacks costs a whole turn to a refused request, which is why this starts off.',
        zh: '只有这个接口的模型确实能看图时才打开。Agent 会截图来检查自己干的活;发不出去图片时,它会改成把同一帧要成粗颗粒的文字色块网格,并在对话里说明。给一个其实看不了图的接口打开它,代价是整轮请求被拒——所以默认是关的。',
    },
    'set.agents.mcpEnabled': { en: 'Allow AI agents to connect', zh: '允许 AI 代理连接' },
    'set.agents.mcpEnabled.desc': {
        en: 'Serve this editor over MCP on a local-only port, so an agent set up with --attach can drive the project you have open. Off means nothing is listening.',
        zh: '通过 MCP 在仅限本机的端口上开放此编辑器，让配置了 --attach 的代理能够操作你正打开的项目。关闭时不会有任何监听。',
    },
    'set.agents.mcp.listening': {
        en: 'Listening on 127.0.0.1:{port} — agents configured with --attach will find it.',
        zh: '正在监听 127.0.0.1:{port}——配置了 --attach 的代理即可找到它。',
    },
    'set.agents.mcp.forced': {
        en: 'Listening on 127.0.0.1:{port}, opened by the --mcp launch flag. It stays open for this session.',
        zh: '正在监听 127.0.0.1:{port}，由启动参数 --mcp 开启。本次会话期间将保持开启。',
    },
    'set.agents.mcp.error': { en: 'Could not open the port: {message}', zh: '无法开启端口：{message}' },
    'set.project.display.screenPresets': { en: 'Screen presets', zh: '屏幕预设' },
    'set.project.display.screenPresets.desc': {
        en: 'Extra screens the viewport and Game view can simulate, on top of the built-in devices. Reusing a built-in id (iphone, ipad, 1080p, 720p) replaces it.',
        zh: '视口与游戏视图可模拟的额外屏幕，叠加在内置设备之上。使用与内置相同的 id（iphone、ipad、1080p、720p）即可替换它。',
    },
    'set.screenPreset.id': { en: 'Id', zh: '标识' },
    'set.screenPreset.label': { en: 'Name', zh: '名称' },
    'set.screenPreset.width': { en: 'Width', zh: '宽' },
    'set.screenPreset.height': { en: 'Height', zh: '高' },
    'set.screenPreset.safeArea': { en: 'Safe area (px)', zh: '安全区域（像素）' },
    'set.screenPreset.safeTop': { en: 'Top', zh: '上' },
    'set.screenPreset.safeBottom': { en: 'Bottom', zh: '下' },
    'set.screenPreset.safeLeft': { en: 'Left', zh: '左' },
    'set.screenPreset.safeRight': { en: 'Right', zh: '右' },
    'set.screenPreset.add': { en: 'Add screen', zh: '添加屏幕' },
    'set.screenPreset.empty': {
        en: 'No project screens — the dropdown shows the built-in devices only.',
        zh: '尚无项目屏幕——下拉中只显示内置设备。',
    },
    'set.screenPreset.errId': { en: 'An id is required (it is what a saved selection refers to)', zh: '必须填写标识（已保存的选择依据它解析）' },
    'set.screenPreset.errDup': { en: 'This id is used by another row', zh: '该标识与其它行重复' },
    'set.screenPreset.errSize': { en: 'Width and height must both be above zero', zh: '宽和高都必须大于 0' },
    'set.objList.remove': { en: 'Remove', zh: '移除' },
    'set.group.designResolution': { en: 'Design Resolution', zh: '设计分辨率' },
    'set.group.sortingLayers': { en: 'Sorting Layers', zh: '排序层' },
    'set.group.ySort': { en: 'Y-Sort', zh: 'Y 轴排序' },
    'set.group.depth': { en: 'Depth (2.5D)', zh: '深度（2.5D）' },
    'set.group.colorSpace': { en: 'Color Space', zh: '色彩空间' },
    'set.group.physics': { en: 'Physics', zh: '物理' },
    'set.group.gravity': { en: 'Gravity', zh: '重力' },
    'set.group.collisionLayers': { en: 'Collision Layers', zh: '碰撞层' },
    'set.group.solver': { en: 'Solver', zh: '求解器' },
    'set.group.application': { en: 'Application', zh: '应用' },
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
        en: 'Scales the whole editor — panels, fonts, controls, and popped-out panel windows. Also on Ctrl/Cmd +, − and 0.',
        zh: '缩放整个编辑器——面板、字体、控件，以及弹出的面板窗口。也可用 Ctrl/Cmd +、− 和 0 调节。',
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
    'set.project.display.cameraFit': { en: 'Camera Fit', zh: '相机适配' },
    'set.project.display.cameraFit.desc': {
        en: 'How the main camera scales the design resolution — independent of any UI Canvas, so it works in a gameplay-only scene. “None” keeps the camera’s own orthoSize (default); any other mode letterboxes every target and the editor device preview.',
        zh: '主相机如何按设计分辨率缩放——独立于任何 UI Canvas，纯玩法场景也生效。“无”保持相机自身的 orthoSize（默认）；其他模式会让所有导出目标与编辑器设备预览都做 letterbox。',
    },
    'set.project.display.cameraMatch': { en: 'Match (width ↔ height)', zh: '匹配（宽 ↔ 高）' },
    'set.project.display.cameraMatch.desc': {
        en: 'Blend between fitting width (0) and height (1), for the “Match” camera fit only.',
        zh: '在适配宽度（0）与高度（1）之间插值，仅“匹配”相机适配模式生效。',
    },
    'set.cameraFit.none': { en: 'None', zh: '无' },
    'set.cameraFit.fixedHeight': { en: 'Fit Height', zh: '适配高度' },
    'set.cameraFit.fixedWidth': { en: 'Fit Width', zh: '适配宽度' },
    'set.cameraFit.expand': { en: 'Expand', zh: '扩展' },
    'set.cameraFit.shrink': { en: 'Shrink', zh: '收缩' },
    'set.cameraFit.match': { en: 'Match', zh: '匹配' },
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
    'set.project.rendering.depthLayers': { en: 'Depth-sorted layers', zh: '深度排序层' },
    'set.project.rendering.depthLayers.desc': {
        en: "Entities on a checked layer are resolved by the depth buffer using their Z, instead of by paint order. Opaque materials (blend mode None) write depth and occlude each other correctly at any angle; translucent ones test against it but stay in paint order. Use with a perspective camera for 2.5D. A layer that also y-sorts keeps y-sorting.",
        zh: '勾选层上的实体按 Z 值经深度缓冲判定遮挡，而非绘制顺序。不透明材质（混合模式 None）写入深度，任意角度下互相遮挡都正确；半透明材质只测试不写入，仍按绘制顺序。配合透视相机即为 2.5D。同时勾选了 Y 轴排序的层仍按 Y 排序。',
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
    'set.project.packaging.appId': { en: 'Application ID', zh: '应用 ID' },
    'set.project.packaging.appId.desc': {
        en: 'Reverse-DNS id the installed app is known by — the Android manifest package, the iOS bundle id, the desktop installer id. Empty derives one from the project name; a published app should set its own, because a store keeps it forever.',
        zh: '已安装应用的反向域名 id——Android 的 manifest package、iOS 的 bundle id、桌面安装包的 id。留空则按项目名推导；正式发布的应用应当自己指定，因为应用商店会永久沿用它。',
    },
    'set.project.packaging.icon': { en: 'App Icon', zh: '应用图标' },
    'set.project.packaging.icon.desc': {
        en: 'Project-relative square PNG, ideally 1024×1024 — the launcher icon on every installable target. Android takes it as the launcher mipmap and iOS as the asset catalog Xcode derives its sizes from, so one image is all you keep. Empty ships Estella\'s mark rather than the platform\'s placeholder.',
        zh: '项目内的方形 PNG，建议 1024×1024——所有可安装目标的启动图标。Android 用作 launcher mipmap，iOS 用作 Xcode 据以派生各尺寸的 asset catalog，所以只需保留这一张。留空则使用 Estella 的标识，而不是平台的占位图。',
    },
    'set.project.packaging.android.versionCode': { en: 'Android Version Code', zh: 'Android 版本号' },
    'set.project.packaging.android.versionCode.desc': {
        en: 'The integer Google Play orders builds by — it must increase with every upload. The version users see comes from the project version.',
        zh: 'Google Play 用来排序构建的整数，每次上传都必须递增。用户看到的版本号来自项目版本。',
    },
    'set.project.packaging.desktop.appId': { en: 'Desktop App ID', zh: '桌面 App ID' },
    'set.project.packaging.desktop.appId.desc': {
        en: 'Overrides the Application ID for the desktop installer only (electron-builder appId).',
        zh: '仅为桌面安装包覆盖应用 ID（electron-builder appId）。',
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
