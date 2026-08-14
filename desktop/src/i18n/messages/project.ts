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
    'build.needXcode': {
        en: 'Xcode not found — the iOS app is built and signed by it.',
        zh: '未找到 Xcode——iOS 应用由它构建并签名。',
    },
    'build.needMacos': {
        en: 'Building the iOS app needs a Mac with Xcode — Apple ships no toolchain for this OS.',
        zh: '构建 iOS 应用需要装有 Xcode 的 Mac——Apple 未在本系统提供工具链。',
    },
    // — The runtime template: the prebuilt engine a native app is assembled around.
    //   Not a toolchain and not something to build — an artifact of this release. —
    'build.templateMissing': {
        en: 'No {id} runtime template for v{version} on this machine.',
        zh: '本机没有 v{version} 的 {id} 运行时模板。',
    },
    'build.templateHint': {
        en: 'It is the prebuilt engine the app is assembled around, downloaded once per editor version. Already have the archive? Install it from a file instead.',
        zh: '它是应用装配所围绕的预编译引擎，每个编辑器版本下载一次即可。已经有归档文件了？也可以直接从文件安装。',
    },
    'build.downloadTemplate': { en: 'Download', zh: '下载' },
    'build.downloadingTemplate': { en: 'Downloading…', zh: '下载中…' },
    'build.downloadingTemplatePct': { en: 'Downloading {pct}% of {size}', zh: '下载中 {pct}%（共 {size}）' },
    'build.installTemplate': { en: 'Install from file…', zh: '从文件安装…' },
    'build.templateInstalled': {
        en: 'Installed the {id} runtime template (v{version}).',
        zh: '已安装 {id} 运行时模板（v{version}）。',
    },
    'build.templateVersionMismatch': {
        en: 'That template is built for v{version}; this editor is v{editor}. A template must match exactly — the SDK is compiled into the app binary.',
        zh: '该模板面向 v{version} 构建，而当前编辑器是 v{editor}。模板必须精确匹配——SDK 是编译进应用二进制的。',
    },
    'build.toolchainHint': {
        en: 'The export still writes the app\'s content here; assembling the installable app needs this toolchain, and that step can run on another machine.',
        zh: '导出仍会在此写出应用内容；将其装配成可安装的应用才需要该工具链，且这一步可以在另一台机器上完成。',
    },
    'build.copyCommand': { en: 'Copy command', zh: '复制命令' },
    'build.copied': { en: 'Copied', zh: '已复制' },
    'build.platformBroken': { en: 'This platform profile failed to load', zh: '该平台配置加载失败' },
    'build.platformNeedsTrust': {
        en: 'Not approved yet — this profile runs with full system access. Approve it in the Plugins panel.',
        zh: '尚未批准 —— 该配置以完整系统权限运行。请在插件面板中批准。',
    },
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
        en: 'Content for the native desktop app (Metal / D3D12 / Vulkan) — a real app, not a browser.',
        zh: '原生桌面应用（Metal / D3D12 / Vulkan）的内容——真正的应用，而非浏览器。',
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
        en: 'The app is in {out}/ — double-click it. Nothing to install first.',
        zh: '应用就在 {out}/ 中——双击即可运行，无需先安装任何东西。',
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
        en: 'The content is in {out}. Install the Android runtime template to get a signed APK assembled around it.',
        zh: '内容已写入 {out}。安装 Android 运行时模板后，导出会围绕它装配出已签名的 APK。',
    },
    'build.next.apk': {
        en: 'Signed APK: {apk} — install it with adb install -r, or copy it to the device.',
        zh: '已签名 APK：{apk} —— 用 adb install -r 安装，或直接拷到设备上。',
    },
    'build.next.apkAab': {
        en: 'Signed APK: {apk} (install it with adb install -r). App Bundle for Google Play: {aab} — upload it; a bundle cannot be installed directly.',
        zh: '已签名 APK：{apk}（用 adb install -r 安装）。Google Play 上传用 App Bundle：{aab} —— 直接上传即可，bundle 本身无法安装。',
    },
    'build.next.steam': {
        en: 'The app is in {out}/ — double-click it. The depot scripts are beside it, and STEAM.md '
            + 'lists what only the Steamworks backend can be told: the depot ids, the launch string, '
            + 'the cloud-save paths and the achievement ids to create.',
        zh: '应用就在 {out}/ 中——双击即可运行。depot 脚本在它旁边，而 STEAM.md 列出了只能在 Steamworks '
            + '后台填写的那些值:depot id、启动项、云存档路径,以及要去建的成就 id。',
    },
    'build.openSteamChecklist': { en: 'Open STEAM.md', zh: '打开 STEAM.md' },
    'build.showApk': { en: 'Show APK', zh: '显示 APK' },
    'build.appBundle': { en: 'Google Play App Bundle (.aab)', zh: 'Google Play App Bundle（.aab）' },
    'build.appBundleTip': {
        en: 'Also write the upload format Google Play requires for new apps, beside the installable APK. A bundle cannot be installed on a device — Play builds the APKs from it.',
        zh: '在可安装的 APK 之外，另写一份 Google Play 对新应用强制要求的上传格式。bundle 无法直接装到设备上——Play 会用它生成各机型的 APK。',
    },
    'build.androidOutput': { en: 'Package as', zh: '打包为' },
    'build.androidOutputTip': {
        en: 'A package installs on a device with nothing else installed. A project is an ordinary Android Studio project — the route for a game that has to add an SDK, a permission or an Activity of its own, and build and sign the package itself.',
        zh: '「安装包」什么都不用装就能直接装到设备上。「工程」是一个普通的 Android Studio 工程——需要接自己的 SDK、加权限或加 Activity、自己构建和签名的游戏走这条路。',
    },
    'build.androidOutput.package': { en: 'Installable package (.apk)', zh: '安装包（.apk）' },
    'build.androidOutput.project': { en: 'Android Studio project', zh: 'Android Studio 工程' },
    'build.next.androidProject': {
        en: 'The Android Studio project is written — open the folder in Android Studio and Run. Your SDKs go in app/build.gradle.kts; re-exporting rewrites the game and leaves that file alone.',
        zh: 'Android Studio 工程已写好——用 Android Studio 打开该文件夹后直接运行。你的 SDK 加在 app/build.gradle.kts 里；重新导出只会覆盖游戏内容，不动这个文件。',
    },
    'build.openAndroidProject': { en: 'Open project folder', zh: '打开工程文件夹' },
    'build.next.ios': {
        en: 'The content is in {out}. Install the iOS runtime template to get an Xcode project written around it.',
        zh: '内容已写入 {out}。安装 iOS 运行时模板后，导出会围绕它写出 Xcode 工程。',
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
    'build.secTarget': { en: '{platform} settings', zh: '{platform}设置' },
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

    // — What the package weighs (BuildSizePanel). A limit's own wording (a
    //   platform's rule) is quoted from the profile, not translated here. —
    'size.scope.initial': { en: 'Initial download', zh: '首包' },
    'size.scope.total': { en: 'Package total', zh: '整包' },
    'size.scope.deliverable': { en: 'Uploaded file', zh: '上传文件' },
    'size.ofLimit': { en: '{used} of {max}', zh: '{used} / {max}' },
    'size.over': { en: '{by} over the limit', zh: '超出上限 {by}' },
    'size.near': { en: '{pct}% of the limit', zh: '已用上限的 {pct}%' },
    'size.projectBudget': { en: "this project's own budget", zh: '本项目自定的体积预算' },
    'size.bucket.initial': { en: 'Initial', zh: '首包' },
    'size.bucket.lazy': { en: 'On demand', zh: '按需分包' },
    'size.bucket.remote': { en: 'CDN (not packaged)', zh: 'CDN（不进包）' },
    'size.composition': { en: 'Package composition', zh: '包体构成' },
    'size.largest': { en: 'Largest files ({count} total)', zh: '最大的文件（共 {count} 个）' },
    'size.kind.engine': { en: 'Engine', zh: '引擎' },
    'size.kind.scripts': { en: 'Scripts', zh: '脚本' },
    'size.kind.texture': { en: 'Textures', zh: '纹理' },
    'size.kind.audio': { en: 'Audio', zh: '音频' },
    'size.kind.video': { en: 'Video', zh: '视频' },
    'size.kind.font': { en: 'Fonts', zh: '字体' },
    'size.kind.scene': { en: 'Scenes', zh: '场景' },
    'size.kind.data': { en: 'Data', zh: '数据' },
    'size.kind.other': { en: 'Other', zh: '其他' },
    // — Packaging settings: the project's own ceiling for this target —
    'build.sizeBudget': { en: 'Size budget', zh: '体积预算' },
    'build.sizeBudgetPlaceholder': { en: 'MB (blank = the platform’s own limit)', zh: 'MB（留空 = 平台自身上限）' },
    'build.sizeBudgetHint': {
        en: 'Judge this target against your own ceiling instead of the platform’s.',
        zh: '用你自己的上限来判定这个目标，而不是平台的。',
    },

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
    'proj.saveScreenPresetsFailed': { en: 'Failed to save screen presets', zh: '保存屏幕预设失败' },
    'proj.saveDesignResolutionFailed': { en: 'Failed to save design resolution', zh: '保存设计分辨率失败' },
    'proj.savePackagingFailed': { en: 'Failed to save packaging settings', zh: '保存打包设置失败' },
    'proj.saveAssetGroupsFailed': { en: 'Failed to save asset delivery config', zh: '保存资产交付配置失败' },
    'proj.savePlatformFailed': { en: 'Failed to save platform settings', zh: '保存平台设置失败' },
    'proj.savePhysicsFailed': { en: 'Failed to save physics setting', zh: '保存物理设置失败' },
    'proj.saveFeatureFailed': { en: 'Failed to save project setting: {name}', zh: '保存项目设置失败：{name}' },
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

    // — New Script dialog (Content Browser → New Script) —
    'script.newTitle': { en: 'New Script', zh: '新建脚本' },
    'script.create': { en: 'Create', zh: '创建' },
    'script.field.kind': { en: 'Kind', zh: '类型' },
    'script.field.name': { en: 'Name', zh: '名称' },
    'script.kind.component': { en: 'Component', zh: '组件' },
    'script.kind.system': { en: 'System', zh: '系统' },
    'script.kind.componentHint': {
        en: 'Data an entity carries. Declared for the editor to read, so it shows up in Add Component with a row per field.',
        zh: '实体携带的数据。声明后编辑器即可读取，会出现在「添加组件」里，每个字段一行。',
    },
    'script.kind.systemHint': {
        en: 'Behaviour that runs every frame while the scene plays, over the entities its query matches.',
        zh: '场景运行时每帧执行的行为，作用于查询匹配到的实体。',
    },
    'script.willCreate': { en: 'Creates', zh: '创建' },
    'script.willWire': { en: 'Wires into', zh: '接入' },
    'script.created': { en: 'Created {path} and wired it into {entry}', zh: '已创建 {path} 并接入 {entry}' },
});
