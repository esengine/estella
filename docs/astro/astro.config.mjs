// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

// The site is deployed under estellaengine.com/docs (docs.yml merges this build
// into docs/dist/docs/), so everything is served from the /docs base path.
export default defineConfig({
  site: 'https://estellaengine.com',
  base: '/docs',
  outDir: './dist',
  integrations: [
    starlight({
      title: 'Estella',
      description: 'A fast 2D game engine powered by WebAssembly and ECS.',
      // The editor's mark and palette, so the guides, the landing page and the
      // installed tool are visibly one product — see src/styles/estella.css.
      logo: { src: './public/favicon.svg', alt: 'Estella' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/estella.css'],
      // English is the root locale (served at /docs); 简体中文 at /docs/zh-cn.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      plugins: [
        // TS API reference GENERATED from the SDK's public barrels — the same
        // source the npm package ships, so the reference cannot drift from the
        // code (the guides stay hand-written; this is the exhaustive surface).
        starlightTypeDoc({
          entryPoints: [
            '../../sdk/src/index.ts',
            '../../sdk/src/physics/index.ts',
            '../../sdk/src/spine/index.ts',
            '../../sdk/src/dragonbones/index.ts',
          ],
          tsconfig: '../../sdk/tsconfig.json',
          output: 'api-ts',
          sidebar: { label: 'TypeScript API', collapsed: true },
          typeDoc: {
            excludePrivate: true,
            excludeInternal: true,
            excludeExternals: true,
          },
        }),
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/esengine/estella' },
        { icon: 'discord', label: 'Discord', href: 'https://discord.gg/sAX6PXZ9' },
      ],
      editLink: {
        baseUrl: 'https://github.com/esengine/estella/edit/master/docs/astro/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          translations: { 'zh-CN': '快速开始' },
          items: [
            { label: 'Introduction', translations: { 'zh-CN': '简介' }, slug: 'getting-started/introduction' },
            { label: 'Installation', translations: { 'zh-CN': '安装' }, slug: 'getting-started/installation' },
            { label: 'Quick Start', translations: { 'zh-CN': '快速上手' }, slug: 'getting-started/quick-start' },
            { label: 'The Editor', translations: { 'zh-CN': '编辑器' }, slug: 'guides/editor' },
          ],
        },
        {
          label: 'Core Concepts',
          translations: { 'zh-CN': '核心概念' },
          items: [
            { label: 'ECS Architecture', translations: { 'zh-CN': 'ECS 架构' }, slug: 'core-concepts/ecs' },
            { label: 'Components', translations: { 'zh-CN': '组件' }, slug: 'core-concepts/components' },
            { label: 'Systems', translations: { 'zh-CN': '系统' }, slug: 'core-concepts/systems' },
            { label: 'Plugins & Resources', translations: { 'zh-CN': '插件与资源' }, slug: 'core-concepts/plugins-resources' },
            { label: 'Transforms, Units & Coordinates', translations: { 'zh-CN': '变换、单位与坐标系' }, slug: 'core-concepts/transforms' },
            { label: 'Screen & Design Resolution', translations: { 'zh-CN': '屏幕与设计分辨率' }, slug: 'core-concepts/screen' },
            { label: 'App Setup & Lifecycle', translations: { 'zh-CN': '应用设置与生命周期' }, slug: 'core-concepts/app-lifecycle' },
          ],
        },
        {
          label: 'Gameplay',
          translations: { 'zh-CN': '玩法' },
          items: [
            { label: 'Scripting', translations: { 'zh-CN': '脚本' }, slug: 'guides/scripting' },
            { label: 'Event Binding', translations: { 'zh-CN': '事件绑定' }, slug: 'guides/events' },
            { label: 'Input', translations: { 'zh-CN': '输入' }, slug: 'guides/input' },
            { label: 'Camera', translations: { 'zh-CN': '相机' }, slug: 'guides/camera' },
            { label: 'Physics', translations: { 'zh-CN': '物理' }, slug: 'guides/physics' },
            { label: 'Markers & Trigger Areas', translations: { 'zh-CN': '标记与触发区' }, slug: 'guides/markers' },
            { label: 'Gameplay AI', translations: { 'zh-CN': '游戏 AI' }, slug: 'guides/ai' },
            { label: 'Animation', translations: { 'zh-CN': '动画' }, slug: 'guides/animation' },
            { label: 'Timeline', translations: { 'zh-CN': '时间轴' }, slug: 'guides/timeline' },
            { label: 'Spine Animation', translations: { 'zh-CN': 'Spine 动画' }, slug: 'guides/spine' },
            { label: 'DragonBones Animation', translations: { 'zh-CN': 'DragonBones 动画' }, slug: 'guides/dragonbones' },
          ],
        },
        {
          label: 'Graphics',
          translations: { 'zh-CN': '图形' },
          items: [
            { label: 'Sprites & Rendering', translations: { 'zh-CN': '精灵与渲染' }, slug: 'guides/sprites' },
            { label: 'Video', translations: { 'zh-CN': '视频' }, slug: 'guides/video' },
            { label: 'Tilemaps', translations: { 'zh-CN': '瓦片地图' }, slug: 'guides/tilemap' },
            { label: 'Particles', translations: { 'zh-CN': '粒子' }, slug: 'guides/particle' },
            { label: 'Post-processing', translations: { 'zh-CN': '后处理' }, slug: 'guides/postprocess' },
            { label: 'Materials & Shaders', translations: { 'zh-CN': '材质与着色器' }, slug: 'guides/material' },
            { label: '2D Lighting & Shadows', translations: { 'zh-CN': '2D 光照与阴影' }, slug: 'guides/lighting' },
            { label: 'Custom Drawing', translations: { 'zh-CN': '自定义绘制' }, slug: 'guides/drawing' },
          ],
        },
        {
          label: 'UI',
          translations: { 'zh-CN': 'UI' },
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'guides/ui' },
            { label: 'Layout', translations: { 'zh-CN': '布局' }, slug: 'guides/ui-layout' },
            { label: 'Text', translations: { 'zh-CN': '文本' }, slug: 'guides/ui-text' },
            { label: 'Widgets', translations: { 'zh-CN': '控件' }, slug: 'guides/ui-components' },
            { label: 'Lists & Scrolling', translations: { 'zh-CN': '列表与滚动' }, slug: 'guides/ui-lists' },
            { label: 'Interaction', translations: { 'zh-CN': '交互' }, slug: 'guides/ui-interaction' },
            { label: 'Theming', translations: { 'zh-CN': '主题' }, slug: 'guides/ui-theme' },
            { label: 'Data Binding', translations: { 'zh-CN': '数据绑定' }, slug: 'guides/ui-binding' },
            { label: 'Controllers', translations: { 'zh-CN': '控制器' }, slug: 'guides/ui-controllers' },
          ],
        },
        {
          label: 'Content & Flow',
          translations: { 'zh-CN': '内容与流程' },
          items: [
            { label: 'Assets', translations: { 'zh-CN': '资源' }, slug: 'guides/assets' },
            { label: 'Prefabs', translations: { 'zh-CN': '预制体' }, slug: 'guides/prefab' },
            { label: 'Audio', translations: { 'zh-CN': '音频' }, slug: 'guides/audio' },
            { label: 'Scenes', translations: { 'zh-CN': '场景' }, slug: 'guides/scene' },
            { label: 'Saving & Loading', translations: { 'zh-CN': '存档与读档' }, slug: 'guides/save' },
            { label: 'Localization', translations: { 'zh-CN': '本地化' }, slug: 'guides/localization' },
            { label: 'Ads & Sharing', translations: { 'zh-CN': '广告与分享' }, slug: 'guides/services' },
            { label: 'Building & Exporting', translations: { 'zh-CN': '构建与导出' }, slug: 'guides/build-export' },
            { label: 'Android & iOS', translations: { 'zh-CN': 'Android 与 iOS' }, slug: 'guides/mobile' },
            { label: 'Hot Update', translations: { 'zh-CN': '热更新' }, slug: 'guides/hot-update' },
            { label: 'WeChat MiniGame', translations: { 'zh-CN': '微信小游戏' }, slug: 'guides/wechat' },
            { label: 'Mini-Game Platforms', translations: { 'zh-CN': '小游戏平台' }, slug: 'guides/minigame-platforms' },
            { label: 'Networking', translations: { 'zh-CN': '联网' }, slug: 'guides/networking' },
            { label: 'Editor Plugins', translations: { 'zh-CN': '编辑器插件' }, slug: 'guides/editor-plugins' },
            { label: 'The Built-in Agent', translations: { 'zh-CN': '内置 Agent' }, slug: 'guides/agent' },
            { label: 'AI Agents (MCP)', translations: { 'zh-CN': 'AI 代理 (MCP)' }, slug: 'guides/mcp' },
          ],
        },
        {
          label: 'Utilities',
          translations: { 'zh-CN': '工具' },
          items: [
            { label: 'Math Helpers', translations: { 'zh-CN': '数学辅助' }, slug: 'guides/math' },
            { label: 'Profiling & Diagnostics', translations: { 'zh-CN': '性能剖析与诊断' }, slug: 'guides/profiling' },
          ],
        },
        {
          label: 'Reference',
          translations: { 'zh-CN': '参考' },
          items: [
            typeDocSidebarGroup,
            { label: 'C++ API (Doxygen)', link: '/docs/api/html/', attrs: { target: '_blank' } },
            { label: 'Architecture', link: 'https://github.com/esengine/estella/blob/master/docs/ARCHITECTURE.md' },
          ],
        },
      ],
    }),
  ],
});
