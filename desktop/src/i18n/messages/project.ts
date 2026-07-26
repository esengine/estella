// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  project.ts — Build/export dialog + project-level feedback (save, watch, play realm).
 */
import { defineMessages } from './types';

export const projectMessages = defineMessages({
    // — Package Project dialog: platform picker —
    'build.title': { en: 'Package Project', zh: '打包项目' },
    'build.platform': { en: 'Platform', zh: '平台' },
    'build.plat.web': { en: 'Web', zh: '网页' },
    'build.plat.desktop': { en: 'Desktop', zh: '桌面' },
    'build.plat.wechat': { en: 'WeChat', zh: '微信小游戏' },
    'build.plat.playable': { en: 'Playable', zh: 'Playable' },
    'build.plat.android': { en: 'Android', zh: 'Android' },
    'build.plat.ios': { en: 'iOS', zh: 'iOS' },
    // — Platform categories (the nav's group headings) —
    'build.cat.general': { en: 'General', zh: '通用' },
    'build.cat.minigame': { en: 'Mini-Games', zh: '小游戏' },
    'build.cat.mobile': { en: 'Mobile', zh: '移动' },
    'build.cat.custom': { en: 'Project', zh: '项目自定义' },
    // — Runtime readiness (probed on disk, not a static hint) —
    'build.notReady': { en: 'Engine runtime missing', zh: '缺少引擎运行时' },
    'build.runtimeMissingIn': {
        en: 'Engine runtime not found in {dir} (looked for {files})',
        zh: '在 {dir} 中未找到引擎运行时（查找的文件：{files}）',
    },
    'build.notReadyHint': {
        en: 'This target needs an engine runtime that is not built yet. Packaging will fail until it is.',
        zh: '该目标需要的引擎运行时尚未构建，在此之前打包会失败。',
    },
    // — Native toolchain readiness. A native target's export is app CONTENT, which
    //   always succeeds; only assembling the installable app needs these, and that
    //   step can run on another machine. —
    'build.needAndroidSdk': {
        en: 'Android SDK not found — set ANDROID_HOME, or install it with Android Studio.',
        zh: '未找到 Android SDK——请设置 ANDROID_HOME，或通过 Android Studio 安装。',
    },
    'build.needAndroidNdk': {
        en: 'No NDK in the Android SDK — install one from the SDK Manager (the app is cross-compiled with it).',
        zh: 'Android SDK 中没有 NDK——请在 SDK Manager 中安装（应用由它交叉编译）。',
    },
    'build.needXcode': {
        en: 'Xcode not found — the iOS app is built and signed by it.',
        zh: '未找到 Xcode——iOS 应用由它构建并签名。',
    },
    'build.needMacos': {
        en: 'Building the iOS app needs a Mac with Xcode — Apple ships no toolchain for this OS.',
        zh: '构建 iOS 应用需要装有 Xcode 的 Mac——Apple 未在本系统提供工具链。',
    },
    'build.toolchainHint': {
        en: 'The export still writes the app\'s content here; assembling the installable app needs this toolchain, and that step can run on another machine.',
        zh: '导出仍会在此写出应用内容；将其装配成可安装的应用才需要该工具链，且这一步可以在另一台机器上完成。',
    },
    'build.copyCommand': { en: 'Copy command', zh: '复制命令' },
    'build.copied': { en: 'Copied', zh: '已复制' },
    'build.platformBroken': { en: 'This platform profile failed to load', zh: '该平台配置加载失败' },
    'build.customHint': {
        en: 'Defined by this project in .esengine/platforms/ — it rides the same mini-game pipeline as the built-in targets.',
        zh: '由本项目在 .esengine/platforms/ 中定义，与内置目标走同一条小游戏导出管线。',
    },
    'build.next.custom': {
        en: 'Package written to {out} — open it in your platform\'s devtools.',
        zh: '包已输出到 {out} —— 用该平台的开发者工具打开。',
    },
    'build.newPlatform': { en: 'New platform', zh: '新建平台' },
    'build.newPlatformTitle': { en: 'New project platform', zh: '新建项目平台' },
    'build.newPlatformBlurb': {
        en: 'A mini-game host gets both halves written and already joined — the packaging profile and the runtime profile it points at. An ad network is one file: a playable always runs in a browser, so only its size limit, its <head> markup and its click-through API differ.',
        zh: '小游戏宿主会写好两半并连接完毕——打包配置，以及它指向的运行时配置。广告平台只需一个文件：试玩包始终跑在浏览器里，只有体积上限、<head> 注入内容与点击跳转接口不同。',
    },
    'build.platformKind': { en: 'Kind', zh: '类型' },
    'build.platformKind.minigame': { en: 'Mini-game host', zh: '小游戏宿主' },
    'build.platformKind.playable': { en: 'Playable ad network', zh: '试玩广告平台' },
    'build.platformId': { en: 'Id', zh: '标识' },
    'build.platformIdTip': {
        en: 'Lowercase letters, digits and dashes. Also the per-texture Import Settings key for this platform.',
        zh: '小写字母、数字和短横线。它同时是该平台的逐纹理导入设置键。',
    },
    'build.platformLabel': { en: 'Name', zh: '名称' },
    'build.create': { en: 'Create', zh: '创建' },
    'build.created': {
        en: 'Created {packaging} and {runtime}. Edit them to describe your host, then package.',
        zh: '已创建 {packaging} 与 {runtime}。编辑它们来描述你的宿主，然后就可以打包。',
    },
    'build.createdNetwork': {
        en: 'Created {file} and selected it below. Fill in its size limit and CTA bridge, then package.',
        zh: '已创建 {file},并已在下方选中它。填好它的体积上限与 CTA 桥接后即可打包。',
    },
    'build.revealFiles': { en: 'Show files', zh: '显示文件' },
    'build.noCustomPlatforms': {
        en: 'Drop a profile in .esengine/platforms/<id>.mjs to add your own target.',
        zh: '在 .esengine/platforms/<id>.mjs 放一个配置文件即可添加自己的目标。',
    },
    'build.blurb.web': {
        en: 'Static, self-contained web build — host it anywhere.',
        zh: '静态、自包含的网页构建——可托管在任何地方。',
    },
    'build.blurb.desktop': {
        en: 'Electron app — package to .dmg / .exe / AppImage.',
        zh: 'Electron 应用——可打包为 .dmg / .exe / AppImage。',
    },
    'build.blurb.wechat': { en: 'WeChat MiniGame package.', zh: '微信小游戏包。' },
    'build.blurb.playable': {
        en: 'Single-file HTML playable ad — everything inlined, no requests.',
        zh: '单文件 HTML 试玩广告——所有内容内联，无网络请求。',
    },
    'build.blurb.android': {
        en: 'Content for the native Android app (Vulkan) — a real APK, not a WebView.',
        zh: '原生 Android 应用（Vulkan）的内容——真正的 APK，而非 WebView。',
    },
    'build.blurb.ios': {
        en: 'Content for the native iOS app (Metal) — packaged and signed by Xcode.',
        zh: '原生 iOS 应用（Metal）的内容——由 Xcode 打包并签名。',
    },
    'build.next.web': {
        en: "Preview over http below, or upload {out}/ to any static host. (A web build needs an http origin — opening index.html directly won't stream the wasm.)",
        zh: '在下方通过 http 预览，或将 {out}/ 上传到任意静态托管。（网页构建需要 http 源——直接打开 index.html 无法流式加载 wasm。）',
    },
    'build.next.desktop': {
        en: 'cd {out} && npm install && npm start — or npm run dist for a native installer.',
        zh: 'cd {out} && npm install && npm start——或运行 npm run dist 以生成原生安装包。',
    },
    'build.next.wechat': {
        en: 'Open {out}/ in WeChat DevTools, then set your appid in project.config.json.',
        zh: '在微信开发者工具中打开 {out}/，然后在 project.config.json 中设置 appid。',
    },
    'build.next.playableZip': {
        en: 'Upload playable.zip (this network takes an archive). Preview over http below — its real surface is an ad-network iframe.',
        zh: '上传 playable.zip(该平台收的是归档包)。可在下方通过 http 预览——它的真实宿主是广告平台的 iframe。',
    },
    'build.next.playable': {
        en: 'Preview over http below (its real surface is an ad-network iframe). Note: a full engine usually exceeds ad-network size limits.',
        zh: '在下方通过 http 预览（其真实运行环境是广告网络的 iframe）。注意：完整引擎通常会超出广告网络的体积限制。',
    },

    'build.next.android': {
        en: 'Build the signed APK around it: node build-tools/cli.js native --package --content {out} (see native/README.md for the one-time Dawn + QuickJS setup).',
        zh: '据此构建签名 APK：node build-tools/cli.js native --package --content {out}（一次性的 Dawn + QuickJS 准备见 native/README.md）。',
    },
    'build.next.ios': {
        en: 'On a Mac: node build-tools/cli.js native --target ios --package --content {out} — that writes the Xcode project around this content.',
        zh: '在 Mac 上运行：node build-tools/cli.js native --target ios --package --content {out} —— 它会围绕这份内容写出 Xcode 工程。',
    },
    'build.next.iosProject': {
        en: 'The Xcode project is written — open it, pick your Team under Signing & Capabilities, then Run.',
        zh: 'Xcode 工程已写好——打开它，在 Signing & Capabilities 下选择你的 Team，然后运行。',
    },
    'build.openXcode': { en: 'Open in Xcode', zh: '在 Xcode 中打开' },

    // — Options —
    'build.adNetwork': { en: 'Ad network', zh: '广告平台' },
    'build.adNetworkTip': {
        en: 'Decides the size limit, what goes in <head>, and the API playableCta() calls.',
        zh: '决定体积上限、<head> 注入内容,以及 playableCta() 调用的接口。',
    },
    'build.adNetworkFile': {
        en: 'Defined by this project in {file}.',
        zh: '由本项目在 {file} 中定义。',
    },
    'build.adNetworkHint': {
        en: 'Each network gets its own output folder. Add one we don\'t ship with a kind: \'playable\' profile in .esengine/platforms/.',
        zh: '每个平台输出到各自的目录。我们没内置的平台,可在 .esengine/platforms/ 放一个 kind: \'playable\' 的配置来添加。',
    },
    'build.configuration': { en: 'Configuration', zh: '配置' },
    'build.development': { en: 'Development', zh: '开发' },
    'build.shipping': { en: 'Shipping', zh: '发行' },
    'build.output': { en: 'Output', zh: '输出' },
    'build.browse': { en: 'Browse', zh: '浏览' },
    'build.openFolderWhenDone': { en: 'Open output folder when done', zh: '完成后打开输出文件夹' },
    'build.includeSourceMaps': { en: 'Include source maps', zh: '包含源码映射' },

    // — Section headers + asset-optimization mode (per-asset compression lives in
    //   the Inspector's Import Settings; the build only picks honor-vs-skip) —
    'build.secBuild': { en: 'Build', zh: '构建' },
    'build.advanced': { en: 'Advanced', zh: '高级' },
    'build.assetCompression': { en: 'Compression', zh: '资源压缩' },
    'build.assetAuto': { en: 'By import settings', zh: '按导入设置' },
    'build.assetSkip': { en: 'Skip all', zh: '全部跳过' },
    'build.assetCompressionTip': {
        en: 'By import settings — each texture and audio clip compresses per its Inspector Import Settings (KTX2 · Max Size · WAV→MP3) and .atlas folders pack. Skip all — ship everything raw for fast iteration.',
        zh: '按导入设置——纹理与音频各自按检视面板的导入设置压缩（KTX2 · Max Size · WAV→MP3），.atlas 文件夹打包。全部跳过——一律原样输出，便于快速迭代。',
    },
    'build.compressionHint': {
        en: 'Per-asset compression lives in each asset’s Import Settings.',
        zh: '每个资源的压缩设置在其「导入设置」里。',
    },

    // — Scenes in build —
    'build.scenesHead': { en: 'Scenes in build', zh: '构建包含的场景' },
    'build.startupScene': { en: 'Startup scene', zh: '启动场景' },
    'build.setStartupScene': { en: 'Set as startup scene', zh: '设为启动场景' },
    'build.setStartupSceneNamed': { en: 'Set {name} as startup scene', zh: '将 {name} 设为启动场景' },
    'build.noScenes': {
        en: "No scenes found under the project's scenes folder.",
        zh: '项目的场景文件夹下未找到场景。',
    },
    'build.playableSingleScene': {
        en: 'Playable ships the startup scene only — a size-capped single file.',
        zh: 'Playable 仅打包启动场景——一个有体积上限的单文件。',
    },

    // — Asset delivery (CDN / hot-update) —
    'build.cdnRoot': { en: 'CDN root', zh: 'CDN 地址' },
    'build.cdnRootTip': {
      en: 'Base URL that remote-group assets are fetched from for this build profile. Empty → remote groups load from the game origin. Mark folders remote in the Content Browser (right-click → Delivery).',
      zh: '当前构建 profile 下远端组资产的拉取根地址。留空则从游戏同源加载。在内容浏览器右键文件夹 → 交付方式 里把文件夹标为远端。',
    },

    // — Run / progress / result —
    'build.footSummary': { en: '{count} scene(s) · {platform}', zh: '{count} 个场景 · {platform}' },
    'build.package': { en: 'Package', zh: '打包' },
    'build.packaging': { en: 'Packaging…', zh: '打包中…' },
    'build.packagingPlatform': { en: 'Packaging the {platform} build…', zh: '正在打包 {platform} 构建…' },
    'build.outputLog': { en: 'Output Log', zh: '输出日志' },
    'build.copyLog': { en: 'Copy log', zh: '复制日志' },
    // {size} is either '' or a pre-built ' · N.N MB' fragment.
    'build.packagedSummary': { en: 'Packaged {count} assets{size} → {out}', zh: '已打包 {count} 个资产{size} → {out}' },
    'build.previewHttp': { en: 'Preview over http', zh: '通过 http 预览' },
    'build.openFolder': { en: 'Open folder', zh: '打开文件夹' },
    'build.packageFailed': { en: 'Package failed', zh: '打包失败' },
    'build.warnings': { en: '{count} warning(s): {first}', zh: '{count} 个警告：{first}' },
    'build.noProjectOpen': { en: 'no project open', zh: '没有打开的项目' },

    // — Project-level feedback toasts (ProjectStore) —
    'proj.openFailed': { en: 'Could not open project: {message}', zh: '无法打开项目：{message}' },
    'proj.createFailed': { en: 'Could not create project: {message}', zh: '无法创建项目：{message}' },
    'proj.sdkTypesFailed': { en: 'SDK types staging failed — the IDE cannot resolve "esengine": {message}', zh: 'SDK 类型入驻失败——IDE 将无法解析 "esengine"：{message}' },
    'proj.prefabLoadFailed': { en: 'Could not load prefab: {name}', zh: '无法加载预制体：{name}' },
    'proj.saveAsInPrefabMode': { en: 'Save As isn’t available while editing a prefab — use Save Prefab, or go Back to the scene first.', zh: '编辑预制体时无法使用"另存为"——请用"保存预制体"，或先返回场景。' },
    'proj.returnSceneGone': { en: 'The scene “{name}” is no longer available — opened a blank scene instead.', zh: '场景"{name}"已不存在——已改为打开空白场景。' },
    'proj.noOverrides': { en: 'No overrides to apply', zh: '没有可应用的覆盖' },
    'proj.applyWriteFailed': { en: 'Apply failed: could not write {name}', zh: '应用失败：无法写入 {name}' },
    'proj.appliedOverride': { en: 'Applied {count} override to {name}', zh: '已将 {count} 项覆盖应用到 {name}' },
    'proj.appliedOverrides': { en: 'Applied {count} overrides to {name}', zh: '已将 {count} 项覆盖应用到 {name}' },
    'proj.applyPreviewTitle': { en: 'Apply changes to prefab?', zh: '将改动应用到预制体？' },
    'proj.applyPreviewLead': { en: 'These changes will be written to "{name}" and affect every instance:', zh: '以下改动将写入"{name}"并影响其所有实例：' },
    'proj.applyDiffName': { en: 'name', zh: '名称' },
    'proj.applyDiffVisibility': { en: 'visibility', zh: '可见性' },
    'proj.applyDiffReparent': { en: 're-parented', zh: '移动父级' },
    'proj.applyDiffAdded': { en: 'added', zh: '新增' },
    'proj.applyDiffRemoved': { en: 'removed', zh: '移除' },
    'proj.applyLabel': { en: 'Apply', zh: '应用' },
    'proj.appliedStructural': { en: 'Applied to {name}: {overrides} override(s), {added} added, {removed} removed', zh: '已应用到 {name}：{overrides} 项覆盖，新增 {added}，移除 {removed}' },
    'proj.prefabExternalRefsTitle': { en: 'Expose external references?', zh: '暴露外部引用？' },
    'proj.prefabExternalRefsBody': {
        en: "{count} reference(s) point to entities outside this prefab. They'll be left unbound in the prefab — each instance can then bind them to a scene entity in the Inspector.",
        zh: '有 {count} 处引用指向此预制体之外的实体。它们将在预制体中留空——之后每个实例可在细节面板中将其绑定到场景实体。',
    },
    'proj.prefabExternalRefsConfirm': { en: 'Create Prefab', zh: '创建预制体' },
    'proj.openedPrefab': { en: 'Editing prefab {name}', zh: '正在编辑预制体 {name}' },
    'proj.savedPrefab': { en: 'Saved prefab {name}', zh: '已保存预制体 {name}' },
    'proj.prefabModeNested': { en: 'Nested / variant prefabs can\'t be edited in place yet', zh: '暂不支持原位编辑嵌套 / 变体预制体' },
    'proj.prefabModeBanner': { en: 'Editing Prefab', zh: '正在编辑预制体' },
    'proj.prefabModeVariantBanner': { en: 'Editing Variant', zh: '正在编辑变体' },
    'proj.prefabModeBack': { en: 'Back to Scene', zh: '返回场景' },
    'proj.prefabModeBackTo': { en: 'Back to {name}', zh: '返回 {name}' },
    'proj.prefabModeSave': { en: 'Save Prefab', zh: '保存预制体' },
    'proj.prefabBadge': { en: 'Prefab', zh: '预制体' },
    'proj.resaveNone': { en: 'No prefabs to re-save', zh: '没有可重新保存的预制体' },
    'proj.resaveDone': { en: 'Re-saved {count} prefab(s) to the current format', zh: '已将 {count} 个预制体重新保存为当前格式' },
    'proj.resaveFailed': { en: 'Re-saved {upgraded}, {failed} failed', zh: '已重新保存 {upgraded} 个，{failed} 个失败' },
    'proj.prefabCreateFailed': { en: 'Failed to create prefab: {name}', zh: '创建预制体失败：{name}' },
    'proj.prefabCreated': { en: 'Created prefab: {name}', zh: '已创建预制体：{name}' },
    'proj.variantCreated': { en: 'Created variant {name}', zh: '已创建变体 {name}' },
    'proj.variantNoRemove': { en: "Variant can't remove base entities — {count} removal(s) dropped", zh: '变体无法删除基础实体——已忽略 {count} 处删除' },
    'proj.staleOverrides': {
        en: '{overrides} override(s) on {instances} prefab instance(s) no longer match the prefab and were dropped',
        zh: '{instances} 个预制体实例上的 {overrides} 处覆盖已与预制体不符，已被丢弃',
    },
    'proj.saveSortingLayersFailed': { en: 'Failed to save sorting layers', zh: '保存排序层失败' },
    'proj.saveDesignResolutionFailed': { en: 'Failed to save design resolution', zh: '保存设计分辨率失败' },
    'proj.savePackagingFailed': { en: 'Failed to save packaging settings', zh: '保存打包设置失败' },
    'proj.saveAssetGroupsFailed': { en: 'Failed to save asset delivery config', zh: '保存资产交付配置失败' },
    'proj.savePlatformFailed': { en: 'Failed to save platform settings', zh: '保存平台设置失败' },
    'proj.savePhysicsFailed': { en: 'Failed to save physics setting', zh: '保存物理设置失败' },
    'proj.saveAudioFailed': { en: 'Failed to save audio setting', zh: '保存音频设置失败' },
    'proj.saveUiThemeFailed': { en: 'Failed to save UI theme', zh: '保存 UI 主题失败' },
    'proj.startupScene': { en: 'Startup scene: {name}', zh: '启动场景：{name}' },
    'proj.saveStartupSceneFailed': { en: 'Failed to save startup scene', zh: '保存启动场景失败' },
    'proj.excludedFromExport': { en: 'Excluded from export: {name}', zh: '已从导出中排除：{name}' },
    'proj.includedInExport': { en: 'Included in export: {name}', zh: '已包含在导出中：{name}' },
    'proj.saveExclusionFailed': { en: 'Failed to save export exclusion', zh: '保存导出排除项失败' },
    'proj.openedScene': { en: 'Opened {name}', zh: '已打开 {name}' },
    'proj.returnedScene': { en: 'Returned to {name}', zh: '已返回 {name}' },
    'proj.savedScene': { en: 'Saved {name}', zh: '已保存 {name}' },

    // — Play realm (Game panel overlay fallbacks) —
    'proj.playPrepareFailed': { en: 'failed to prepare play realm', zh: '无法准备游戏运行环境' },
    'proj.playPrepareTimeout': {
        en: 'Preparing the game timed out (the script bundler may be wedged). Press Play to retry; restart the editor if it persists.',
        zh: '准备游戏运行环境超时（脚本打包器可能卡死）。请再次点击运行重试；若仍然如此，请重启编辑器。',
    },
    'proj.playRealmError': { en: 'play realm error', zh: '游戏运行环境错误' },
});
