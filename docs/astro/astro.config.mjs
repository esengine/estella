// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

const SITE = 'https://estellaengine.com';

// Every address this site has published that is not where its page lives now.
// A page's directory path IS its sidebar path IS its URL — that is the rule the
// structure follows, and this map is the cost of having changed it. Append-only:
// moving a page again means adding lines here, never editing or deleting them,
// so a URL published once keeps resolving. Astro emits a redirect page per entry
// in both locales.
const MOVED = {
  // The AI guide grew into a chapter of its own.
  'gameplay/ai': 'gameplay/ai/overview',
  'gameplay/ai-perception': 'gameplay/ai/perception',
  'gameplay/ai-navigation': 'gameplay/ai/navigation',
  'gameplay/ai-state-machines': 'gameplay/ai/state-machines',
  'gameplay/ai-behavior-trees': 'gameplay/ai/behavior-trees',
  'gameplay/ai-blackboard': 'gameplay/ai/blackboard',
  'gameplay/ai-authoring': 'gameplay/ai/authoring',
  'gameplay/ai-advanced': 'gameplay/ai/advanced',

  // One flat `guides/` folder became one directory per sidebar group.
  'guides/editor': 'editor/overview',
  'guides/scripting': 'scripting/overview',
  'guides/input': 'scripting/input',
  'guides/events': 'scripting/events',
  'guides/save': 'scripting/save',
  'guides/networking': 'scripting/networking',
  'guides/math': 'scripting/math',
  'guides/sprites': 'graphics/sprites',
  'guides/camera': 'graphics/camera',
  'guides/material': 'graphics/materials',
  'guides/lighting': 'graphics/lighting',
  'guides/postprocess': 'graphics/post-processing',
  'guides/drawing': 'graphics/drawing',
  'guides/video': 'graphics/video',
  'guides/animation': 'animation/overview',
  'guides/timeline': 'animation/timeline',
  'guides/spine': 'animation/spine',
  'guides/dragonbones': 'animation/dragonbones',
  'guides/physics': 'gameplay/physics',
  'guides/markers': 'gameplay/markers',
  'guides/ai': 'gameplay/ai/overview',
  'guides/ui': 'ui/overview',
  'guides/ui-layout': 'ui/layout',
  'guides/ui-text': 'ui/text',
  'guides/ui-components': 'ui/widgets',
  'guides/ui-lists': 'ui/lists',
  'guides/ui-interaction': 'ui/interaction',
  'guides/ui-theme': 'ui/theming',
  'guides/ui-binding': 'ui/data-binding',
  'guides/ui-controllers': 'ui/controllers',
  'guides/scene': 'world/scenes',
  'guides/prefab': 'world/prefabs',
  'guides/tilemap': 'world/tilemaps',
  'guides/particle': 'world/particles',
  'guides/assets': 'assets/overview',
  'guides/audio': 'assets/audio',
  'guides/localization': 'assets/localization',
  'guides/build-export': 'publishing/overview',
  'guides/mobile': 'publishing/android-ios',
  'guides/wechat': 'publishing/wechat',
  'guides/minigame-platforms': 'publishing/minigame-platforms',
  'guides/hot-update': 'publishing/hot-update',
  'guides/services': 'publishing/ads-sharing',
  'guides/profiling': 'performance/profiling',
  'guides/editor-plugins': 'extending/editor-plugins',
  'guides/agent': 'extending/built-in-agent',
  'guides/mcp': 'extending/mcp',
};

// The site is deployed under estellaengine.com/docs (docs.yml merges this build
// into docs/dist/docs/), so everything is served from the /docs base path.
export default defineConfig({
  site: SITE,
  base: '/docs',
  outDir: './dist',
  // `@/` is src, the same alias the editor uses. An image referenced as
  // `../../../assets/…` encodes how deep its page sits, so a page could not move
  // between directory levels without every picture on it going dark — which is
  // why the guides were pinned one level deep. The alias is what lets the
  // structure be chosen for the reader instead of for the asset paths.
  vite: {
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  },
  // Astro prepends `base` to a redirect's SOURCE but not to its destination, so
  // the destination carries /docs itself — without it every old URL lands on a
  // 404 at the site root.
  redirects: Object.fromEntries(
    Object.entries(MOVED).flatMap(([from, to]) => [
      [`/${from}`, `/docs/${to}/`],
      [`/zh-cn/${from}`, `/docs/zh-cn/${to}/`],
    ]),
  ),
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
      // The sidebar is the table of contents of a manual, not a list of files:
      // grouped by the task a reader came to do, every group collapsed but the
      // first, so the rail shows ~17 rows instead of every page at once.
      // Starlight still auto-expands whichever group holds the current page.
      sidebar: [
        {
          label: 'Get Started',
          translations: { 'zh-CN': '快速开始' },
          items: [
            { label: 'Introduction', translations: { 'zh-CN': '简介' }, slug: 'getting-started/introduction' },
            { label: 'Installation', translations: { 'zh-CN': '安装' }, slug: 'getting-started/installation' },
            { label: 'Quick Start', translations: { 'zh-CN': '快速上手' }, slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Editor',
          translations: { 'zh-CN': '编辑器' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'editor/overview' },
            { label: 'Viewport & Editing Modes', translations: { 'zh-CN': '视口与编辑模式' }, slug: 'editor/viewport' },
            { label: 'Building a Scene', translations: { 'zh-CN': '搭建场景' }, slug: 'editor/scenes' },
            { label: 'Content Browser', translations: { 'zh-CN': '内容浏览器' }, slug: 'editor/content-browser' },
            { label: 'Play in the Editor', translations: { 'zh-CN': '编辑器内运行' }, slug: 'editor/play' },
            { label: 'Asset Editors', translations: { 'zh-CN': '专用编辑器' }, slug: 'editor/asset-editors' },
            { label: 'Project Settings', translations: { 'zh-CN': '项目设置' }, slug: 'editor/settings' },
            { label: 'Keyboard Shortcuts', translations: { 'zh-CN': '键盘快捷键' }, slug: 'editor/shortcuts' },
          ],
        },
        {
          label: 'Core Concepts',
          translations: { 'zh-CN': '核心概念' },
          collapsed: true,
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
          label: 'Scripting',
          translations: { 'zh-CN': '脚本' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'scripting/overview' },
            { label: 'Input', translations: { 'zh-CN': '输入' }, slug: 'scripting/input' },
            { label: 'Event Binding', translations: { 'zh-CN': '事件绑定' }, slug: 'scripting/events' },
            { label: 'Saving & Loading', translations: { 'zh-CN': '存档与读档' }, slug: 'scripting/save' },
            { label: 'Networking', translations: { 'zh-CN': '联网' }, slug: 'scripting/networking' },
            { label: 'Math Helpers', translations: { 'zh-CN': '数学辅助' }, slug: 'scripting/math' },
          ],
        },
        {
          label: 'Graphics',
          translations: { 'zh-CN': '图形' },
          collapsed: true,
          items: [
            { label: 'Sprites & Rendering', translations: { 'zh-CN': '精灵与渲染' }, slug: 'graphics/sprites' },
            { label: 'Camera', translations: { 'zh-CN': '相机' }, slug: 'graphics/camera' },
            { label: 'Materials & Shaders', translations: { 'zh-CN': '材质与着色器' }, slug: 'graphics/materials' },
            { label: '2D Lighting & Shadows', translations: { 'zh-CN': '2D 光照与阴影' }, slug: 'graphics/lighting' },
            { label: 'Post-processing', translations: { 'zh-CN': '后处理' }, slug: 'graphics/post-processing' },
            { label: 'Custom Drawing', translations: { 'zh-CN': '自定义绘制' }, slug: 'graphics/drawing' },
            { label: 'Video', translations: { 'zh-CN': '视频' }, slug: 'graphics/video' },
          ],
        },
        {
          label: 'Animation',
          translations: { 'zh-CN': '动画' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'animation/overview' },
            { label: 'Timeline', translations: { 'zh-CN': '时间轴' }, slug: 'animation/timeline' },
            { label: 'Spine Animation', translations: { 'zh-CN': 'Spine 动画' }, slug: 'animation/spine' },
            { label: 'DragonBones Animation', translations: { 'zh-CN': 'DragonBones 动画' }, slug: 'animation/dragonbones' },
          ],
        },
        {
          label: 'Gameplay',
          translations: { 'zh-CN': '玩法' },
          collapsed: true,
          items: [
            { label: 'Physics', translations: { 'zh-CN': '物理' }, slug: 'gameplay/physics' },
            { label: 'Markers & Trigger Areas', translations: { 'zh-CN': '标记与触发区' }, slug: 'gameplay/markers' },
            {
              label: 'Gameplay AI',
              translations: { 'zh-CN': '游戏 AI' },
              collapsed: true,
              items: [
                { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'gameplay/ai/overview' },
                { label: 'Perception', translations: { 'zh-CN': '感知' }, slug: 'gameplay/ai/perception' },
                { label: 'Navigation', translations: { 'zh-CN': '导航' }, slug: 'gameplay/ai/navigation' },
                { label: 'State Machines', translations: { 'zh-CN': '状态机' }, slug: 'gameplay/ai/state-machines' },
                { label: 'Behavior Trees', translations: { 'zh-CN': '行为树' }, slug: 'gameplay/ai/behavior-trees' },
                { label: 'The Blackboard', translations: { 'zh-CN': '黑板' }, slug: 'gameplay/ai/blackboard' },
                { label: 'Authoring in the Editor', translations: { 'zh-CN': '在编辑器里编排' }, slug: 'gameplay/ai/authoring' },
                { label: 'Below the Components', translations: { 'zh-CN': '组件层之下' }, slug: 'gameplay/ai/advanced' },
              ],
            },
          ],
        },
        {
          label: 'UI',
          translations: { 'zh-CN': 'UI' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'ui/overview' },
            { label: 'Layout', translations: { 'zh-CN': '布局' }, slug: 'ui/layout' },
            { label: 'Text', translations: { 'zh-CN': '文本' }, slug: 'ui/text' },
            { label: 'Widgets', translations: { 'zh-CN': '控件' }, slug: 'ui/widgets' },
            { label: 'Lists & Scrolling', translations: { 'zh-CN': '列表与滚动' }, slug: 'ui/lists' },
            { label: 'Interaction', translations: { 'zh-CN': '交互' }, slug: 'ui/interaction' },
            { label: 'Theming', translations: { 'zh-CN': '主题' }, slug: 'ui/theming' },
            { label: 'Data Binding', translations: { 'zh-CN': '数据绑定' }, slug: 'ui/data-binding' },
            { label: 'Controllers', translations: { 'zh-CN': '控制器' }, slug: 'ui/controllers' },
          ],
        },
        {
          label: 'World Building',
          translations: { 'zh-CN': '世界搭建' },
          collapsed: true,
          items: [
            { label: 'Scenes', translations: { 'zh-CN': '场景' }, slug: 'world/scenes' },
            { label: 'Prefabs', translations: { 'zh-CN': '预制体' }, slug: 'world/prefabs' },
            { label: 'Tilemaps', translations: { 'zh-CN': '瓦片地图' }, slug: 'world/tilemaps' },
            { label: 'Particles', translations: { 'zh-CN': '粒子' }, slug: 'world/particles' },
          ],
        },
        {
          label: 'Assets',
          translations: { 'zh-CN': '资源' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'assets/overview' },
            { label: 'Audio', translations: { 'zh-CN': '音频' }, slug: 'assets/audio' },
            { label: 'Localization', translations: { 'zh-CN': '本地化' }, slug: 'assets/localization' },
          ],
        },
        {
          label: 'Publishing',
          translations: { 'zh-CN': '发布' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'publishing/overview' },
            { label: 'Android & iOS', translations: { 'zh-CN': 'Android 与 iOS' }, slug: 'publishing/android-ios' },
            { label: 'Steam', translations: { 'zh-CN': 'Steam' }, slug: 'publishing/steam' },
            { label: 'WeChat MiniGame', translations: { 'zh-CN': '微信小游戏' }, slug: 'publishing/wechat' },
            { label: 'Mini-Game Platforms', translations: { 'zh-CN': '小游戏平台' }, slug: 'publishing/minigame-platforms' },
            { label: 'Hot Update', translations: { 'zh-CN': '热更新' }, slug: 'publishing/hot-update' },
            { label: 'Ads & Sharing', translations: { 'zh-CN': '广告与分享' }, slug: 'publishing/ads-sharing' },
          ],
        },
        {
          label: 'Performance',
          translations: { 'zh-CN': '性能与调试' },
          collapsed: true,
          items: [
            { label: 'Profiling & Diagnostics', translations: { 'zh-CN': '性能剖析与诊断' }, slug: 'performance/profiling' },
          ],
        },
        {
          label: 'Extending the Editor',
          translations: { 'zh-CN': '扩展编辑器' },
          collapsed: true,
          items: [
            { label: 'Editor Plugins', translations: { 'zh-CN': '编辑器插件' }, slug: 'extending/editor-plugins' },
            { label: 'The Built-in Agent', translations: { 'zh-CN': '内置 Agent' }, slug: 'extending/built-in-agent' },
            { label: 'AI Agents (MCP)', translations: { 'zh-CN': 'AI 代理 (MCP)' }, slug: 'extending/mcp' },
          ],
        },
        {
          label: 'Reference',
          translations: { 'zh-CN': '参考' },
          collapsed: true,
          items: [
            {
              // Look-up by component name — the question the Details panel
              // provokes ("what does this field do?"), which the task-shaped
              // guides answer only if you already know which guide to open.
              label: 'Component Reference',
              translations: { 'zh-CN': '组件参考' },
              collapsed: true,
              items: [
                { label: 'Core', translations: { 'zh-CN': '核心' }, slug: 'reference/components/core' },
                { label: 'Graphics', translations: { 'zh-CN': '图形' }, slug: 'reference/components/graphics' },
                { label: 'UI', translations: { 'zh-CN': 'UI' }, slug: 'reference/components/ui' },
                { label: 'Physics', translations: { 'zh-CN': '物理' }, slug: 'reference/components/physics' },
                { label: 'Animation', translations: { 'zh-CN': '动画' }, slug: 'reference/components/animation' },
                { label: 'World', translations: { 'zh-CN': '世界' }, slug: 'reference/components/world' },
                { label: 'Gameplay', translations: { 'zh-CN': '玩法' }, slug: 'reference/components/gameplay' },
              ],
            },
            {
              label: 'API Stability',
              translations: { 'zh-CN': 'API 稳定性' },
              slug: 'reference/api-stability',
            },
            typeDocSidebarGroup,
            // Doxygen output is merged in beside the Astro build, not routed by
            // it, and it isn't translated. A root-relative link would get BOTH
            // the /docs base and the active locale prepended (which is how this
            // one used to render as the dead /docs/zh-cn/docs/api/html/), so it
            // has to be absolute to escape them.
            { label: 'C++ API (Doxygen)', link: `${SITE}/docs/api/html/`, attrs: { target: '_blank' } },
            { label: 'Architecture', link: 'https://github.com/esengine/estella/blob/master/docs/ARCHITECTURE.md' },
          ],
        },
      ],
    }),
  ],
});
