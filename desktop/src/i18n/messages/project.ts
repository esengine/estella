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
    'build.comingSoon': { en: 'Coming soon', zh: '即将推出' },
    'build.soon': { en: 'soon', zh: '即将' },
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
    'build.prereq.wechat': {
        en: 'Requires the WeChat runtime — run: node build-tools/cli.js build -t wechat',
        zh: '需要微信运行时——请运行：node build-tools/cli.js build -t wechat',
    },
    'build.prereq.playable': {
        en: 'Requires the single-file runtime — run: node build-tools/cli.js build -t playable',
        zh: '需要单文件运行时——请运行：node build-tools/cli.js build -t playable',
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
    'build.next.playable': {
        en: 'Preview over http below (its real surface is an ad-network iframe). Note: a full engine usually exceeds ad-network size limits.',
        zh: '在下方通过 http 预览（其真实运行环境是广告网络的 iframe）。注意：完整引擎通常会超出广告网络的体积限制。',
    },

    // — Options —
    'build.configuration': { en: 'Configuration', zh: '配置' },
    'build.development': { en: 'Development', zh: '开发' },
    'build.shipping': { en: 'Shipping', zh: '发行' },
    'build.output': { en: 'Output', zh: '输出' },
    'build.browse': { en: 'Browse', zh: '浏览' },
    'build.openFolderWhenDone': { en: 'Open output folder when done', zh: '完成后打开输出文件夹' },
    'build.includeSourceMaps': { en: 'Include source maps', zh: '包含源码映射' },
    'build.compressTextures': { en: 'Compress textures (PNG → KTX2)', zh: '压缩纹理（PNG → KTX2）' },
    'build.compressAudio': { en: 'Compress audio (WAV → MP3)', zh: '压缩音频（WAV → MP3）' },
    'build.compressAudioTip': {
        en: 'Re-encode WAV sources to MP3 at cook. Per-asset Import Settings can opt a clip out (seamless loops) or pick a bitrate.',
        zh: '打包时将 WAV 源重编码为 MP3。可在资产的导入设置中单独关闭（无缝循环素材）或选择码率。',
    },
    'build.atlasTextures': { en: 'Pack .atlas folders into atlases', zh: '将 .atlas 文件夹打包为图集' },

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

    // — Run / progress / result —
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
    'proj.noOverrides': { en: 'No overrides to apply', zh: '没有可应用的覆盖' },
    'proj.applyWriteFailed': { en: 'Apply failed: could not write {name}', zh: '应用失败：无法写入 {name}' },
    'proj.appliedOverride': { en: 'Applied {count} override to {name}', zh: '已将 {count} 项覆盖应用到 {name}' },
    'proj.appliedOverrides': { en: 'Applied {count} overrides to {name}', zh: '已将 {count} 项覆盖应用到 {name}' },
    'proj.applyPreviewTitle': { en: 'Apply changes to prefab?', zh: '将改动应用到预制体？' },
    'proj.applyPreviewLead': { en: 'These changes will be written to "{name}" and affect every instance:', zh: '以下改动将写入"{name}"并影响其所有实例：' },
    'proj.applyDiffName': { en: 'name', zh: '名称' },
    'proj.applyDiffVisibility': { en: 'visibility', zh: '可见性' },
    'proj.applyDiffAdded': { en: 'added', zh: '新增' },
    'proj.applyDiffRemoved': { en: 'removed', zh: '移除' },
    'proj.applyLabel': { en: 'Apply', zh: '应用' },
    'proj.appliedStructural': { en: 'Applied to {name}: {overrides} override(s), {added} added, {removed} removed', zh: '已应用到 {name}：{overrides} 项覆盖，新增 {added}，移除 {removed}' },
    'proj.prefabExternalRefsTitle': { en: 'Clear external references?', zh: '清除外部引用？' },
    'proj.prefabExternalRefsBody': { en: '{count} component reference(s) point to entities outside this selection and will be cleared in the prefab.', zh: '有 {count} 处组件引用指向所选之外的实体，将在预制体中被清除。' },
    'proj.prefabExternalRefsConfirm': { en: 'Create anyway', zh: '仍然创建' },
    'proj.resaveNone': { en: 'No prefabs to re-save', zh: '没有可重新保存的预制体' },
    'proj.resaveDone': { en: 'Re-saved {count} prefab(s) to the current format', zh: '已将 {count} 个预制体重新保存为当前格式' },
    'proj.resaveFailed': { en: 'Re-saved {upgraded}, {failed} failed', zh: '已重新保存 {upgraded} 个，{failed} 个失败' },
    'proj.prefabCreateFailed': { en: 'Failed to create prefab: {name}', zh: '创建预制体失败：{name}' },
    'proj.prefabCreated': { en: 'Created prefab: {name}', zh: '已创建预制体：{name}' },
    'proj.saveSortingLayersFailed': { en: 'Failed to save sorting layers', zh: '保存排序层失败' },
    'proj.saveDesignResolutionFailed': { en: 'Failed to save design resolution', zh: '保存设计分辨率失败' },
    'proj.savePackagingFailed': { en: 'Failed to save packaging settings', zh: '保存打包设置失败' },
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
    'proj.savedScene': { en: 'Saved {name}', zh: '已保存 {name}' },

    // — Play realm (Game panel overlay fallbacks) —
    'proj.playPrepareFailed': { en: 'failed to prepare play realm', zh: '无法准备游戏运行环境' },
    'proj.playPrepareTimeout': {
        en: 'Preparing the game timed out (the script bundler may be wedged). Press Play to retry; restart the editor if it persists.',
        zh: '准备游戏运行环境超时（脚本打包器可能卡死）。请再次点击运行重试；若仍然如此，请重启编辑器。',
    },
    'proj.playRealmError': { en: 'play realm error', zh: '游戏运行环境错误' },
});
