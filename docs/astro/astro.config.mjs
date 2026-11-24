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
  'guides/timeline': 'animation/timeline/overview',
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
  'guides/tilemap': 'world/tilemaps/overview',
  'guides/particle': 'world/particles/overview',
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
  'guides/agent': 'agents/mcp',
  'guides/mcp': 'agents/mcp',
  'extending/built-in-agent': 'agents/mcp',
  // The editor no longer ships its own agent; an agent connects over MCP.
  'agents/built-in': 'agents/mcp',
  'extending/mcp': 'agents/mcp',
  // The graphics chapters were split into sub-chapters.
  'graphics/sprites': 'graphics/sprites/overview',
  'graphics/camera': 'graphics/camera/overview',
  'graphics/materials': 'graphics/materials/overview',
  'graphics/lighting': 'graphics/lighting/lights',
  'graphics/post-processing': 'graphics/post-processing/overview',
  'graphics/drawing': 'graphics/drawing/overview',
  'graphics/terrain': 'graphics/terrain/overview',
  'graphics/water': 'graphics/water/overview',
  'animation/timeline': 'animation/timeline/overview',
  'world/tilemaps': 'world/tilemaps/overview',
  'world/particles': 'world/particles/overview',
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
      description: 'A fast 2D and 3D game engine powered by WebAssembly and ECS.',
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
            '../../sdk/src/physics3d/index.ts',
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
            { label: 'History, Scatter & Health', translations: { 'zh-CN': '历史、散布与健康' }, slug: 'editor/history-scatter-health' },
            { label: 'Keyboard Shortcuts', translations: { 'zh-CN': '键盘快捷键' }, slug: 'editor/shortcuts' },
          ],
        },
        {
          // Driving the editor, not extending it — which is why this sits beside
          // the editor rather than under "Extending", where it read as a plugin
          // topic.
          label: 'AI Agents',
          translations: { 'zh-CN': 'AI 智能体' },
          collapsed: true,
          items: [
            { label: 'Connecting an Agent (MCP)', translations: { 'zh-CN': '连接智能体 (MCP)' }, slug: 'agents/mcp' },
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
            {
              label: 'Sprites',
              translations: { 'zh-CN': '精灵' },
              collapsed: true,
              items: [
                { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'graphics/sprites/overview' },
                { label: 'Texture Regions & Sampling', translations: { 'zh-CN': '纹理区域与采样' }, slug: 'graphics/sprites/textures' },
                { label: 'Draw Order & Sorting', translations: { 'zh-CN': '绘制顺序与排序' }, slug: 'graphics/sprites/sorting' },
                { label: 'Occlusion, Sight & Ground Effects', translations: { 'zh-CN': '遮挡、视野与地面效果' }, slug: 'graphics/sprites/visibility' },
                { label: 'Effects & 2D Renderers', translations: { 'zh-CN': '效果与 2D 渲染组件' }, slug: 'graphics/sprites/effects' },
              ],
            },
            {
              label: 'Camera',
              translations: { 'zh-CN': '相机' },
              collapsed: true,
              items: [
                { label: 'Camera Basics', translations: { 'zh-CN': '相机基础' }, slug: 'graphics/camera/overview' },
                { label: 'Following & Framing', translations: { 'zh-CN': '跟随与构图' }, slug: 'graphics/camera/follow' },
                { label: 'Noise, Shake & Impulses', translations: { 'zh-CN': '噪声、震屏与冲击' }, slug: 'graphics/camera/shake' },
                { label: 'Blending & Switching', translations: { 'zh-CN': '混合与切换' }, slug: 'graphics/camera/blending' },
                { label: 'Multiple Cameras & Large Worlds', translations: { 'zh-CN': '多相机与大世界' }, slug: 'graphics/camera/multiple-cameras' },
              ],
            },
            {
              label: 'Materials & Shaders',
              translations: { 'zh-CN': '材质与着色器' },
              collapsed: true,
              items: [
                { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'graphics/materials/overview' },
                { label: 'Surface Shaders', translations: { 'zh-CN': '表面着色器' }, slug: 'graphics/materials/surface-shaders' },
                { label: 'The .esshader Format', translations: { 'zh-CN': '.esshader 格式' }, slug: 'graphics/materials/esshader' },
                { label: 'Materials in Code', translations: { 'zh-CN': '代码中的材质' }, slug: 'graphics/materials/code' },
              ],
            },
            {
              label: 'Lighting & Shadows',
              translations: { 'zh-CN': '光照与阴影' },
              collapsed: true,
              items: [
                { label: 'Lights', translations: { 'zh-CN': '光源' }, slug: 'graphics/lighting/lights' },
                { label: 'Lit Surfaces', translations: { 'zh-CN': '受光表面' }, slug: 'graphics/lighting/surfaces' },
                { label: 'Shadows', translations: { 'zh-CN': '阴影' }, slug: 'graphics/lighting/shadows' },
                { label: 'Baked Lighting', translations: { 'zh-CN': '烘焙光照' }, slug: 'graphics/lighting/baked' },
                { label: 'Planar Reflections', translations: { 'zh-CN': '平面反射' }, slug: 'graphics/lighting/planar-reflections' },
                { label: 'Color Space & Quality', translations: { 'zh-CN': '色彩空间与画质' }, slug: 'graphics/lighting/color-and-quality' },
              ],
            },
            {
              label: 'Post-processing',
              translations: { 'zh-CN': '后处理' },
              collapsed: true,
              items: [
                { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'graphics/post-processing/overview' },
                { label: 'Color & Exposure', translations: { 'zh-CN': '色彩与曝光' }, slug: 'graphics/post-processing/color' },
                { label: 'Lens & Image Effects', translations: { 'zh-CN': '镜头与画面效果' }, slug: 'graphics/post-processing/image-effects' },
                { label: 'Screen-space Lighting', translations: { 'zh-CN': '屏幕空间光照' }, slug: 'graphics/post-processing/lighting' },
                { label: 'Sky, Fog & Weather', translations: { 'zh-CN': '天空、雾与天气' }, slug: 'graphics/post-processing/sky-and-weather' },
                { label: 'Scripting & Custom Effects', translations: { 'zh-CN': '脚本与自定义效果' }, slug: 'graphics/post-processing/scripting' },
              ],
            },
            {
              label: 'Terrain',
              translations: { 'zh-CN': '地形' },
              collapsed: true,
              items: [
                { label: 'Terrain', translations: { 'zh-CN': '地形' }, slug: 'graphics/terrain/overview' },
                { label: 'Rendering & Code', translations: { 'zh-CN': '绘制与代码' }, slug: 'graphics/terrain/rendering-and-code' },
                { label: 'Planets & Large Ground', translations: { 'zh-CN': '星球与大地形' }, slug: 'graphics/terrain/large-worlds' },
              ],
            },
            { label: 'Foliage', translations: { 'zh-CN': '植被' }, slug: 'graphics/foliage' },
            {
              label: 'Water',
              translations: { 'zh-CN': '水' },
              collapsed: true,
              items: [
                { label: 'Water', translations: { 'zh-CN': '水' }, slug: 'graphics/water/overview' },
                { label: 'Lakes, Rivers & Waterfalls', translations: { 'zh-CN': '湖泊、河流与瀑布' }, slug: 'graphics/water/rivers-and-shores' },
                { label: 'Interaction & Shader', translations: { 'zh-CN': '交互与着色器' }, slug: 'graphics/water/interaction-and-shader' },
              ],
            },
            { label: 'Weather', translations: { 'zh-CN': '天气' }, slug: 'graphics/weather' },
            { label: 'Time of Day', translations: { 'zh-CN': '昼夜' }, slug: 'graphics/time-of-day' },
            {
              label: 'Custom Drawing',
              translations: { 'zh-CN': '自定义绘制' },
              collapsed: true,
              items: [
                { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'graphics/drawing/overview' },
                { label: 'Vector Paths', translations: { 'zh-CN': '矢量路径' }, slug: 'graphics/drawing/vector-paths' },
                { label: 'Meshes', translations: { 'zh-CN': '网格' }, slug: 'graphics/drawing/meshes' },
                { label: 'Render Textures', translations: { 'zh-CN': '渲染纹理' }, slug: 'graphics/drawing/render-textures' },
              ],
            },
            { label: 'Video', translations: { 'zh-CN': '视频' }, slug: 'graphics/video' },
          ],
        },
        {
          label: 'Animation',
          translations: { 'zh-CN': '动画' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'animation/overview' },
            { label: 'Sprite Animation', translations: { 'zh-CN': '精灵动画' }, slug: 'animation/sprite-animation' },
            { label: 'Tweens', translations: { 'zh-CN': '补间' }, slug: 'animation/tweens' },
            { label: 'Animator', translations: { 'zh-CN': '动画控制器' }, slug: 'animation/animator' },
            { label: 'Animation Events', translations: { 'zh-CN': '动画事件' }, slug: 'animation/animator-events' },
            { label: 'Layers, IK & Root Motion', translations: { 'zh-CN': '图层、IK 与根运动' }, slug: 'animation/animator-layers' },
            {
              label: 'Timeline',
              translations: { 'zh-CN': '时间轴' },
              collapsed: true,
              items: [
                { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'animation/timeline/overview' },
                { label: 'Sequencer', translations: { 'zh-CN': '序列器' }, slug: 'animation/timeline/sequencer' },
                { label: 'Tracks & Bindings', translations: { 'zh-CN': '轨道与绑定' }, slug: 'animation/timeline/tracks' },
                { label: 'Playback & Scripting', translations: { 'zh-CN': '播放与脚本' }, slug: 'animation/timeline/playback' },
              ],
            },
            { label: 'Spring bones', translations: { 'zh-CN': '弹簧骨骼' }, slug: 'animation/spring-bones' },
            { label: 'Grip Pose', translations: { 'zh-CN': '握持姿势' }, slug: 'animation/grip-pose' },
            { label: '2D Rigs', translations: { 'zh-CN': '2D 骨骼' }, slug: 'animation/rig-2d' },
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
            { label: '3D Physics', translations: { 'zh-CN': '3D 物理' }, slug: 'gameplay/physics-3d' },
            { label: 'Markers & Trigger Areas', translations: { 'zh-CN': '标记与触发区' }, slug: 'gameplay/markers' },
            { label: 'Script Graphs', translations: { 'zh-CN': '脚本图' }, slug: 'gameplay/script-graphs' },
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
            { label: 'Your First Screen', translations: { 'zh-CN': '第一个界面' }, slug: 'ui/first-screen' },
            { label: 'Sprite or UI Image', translations: { 'zh-CN': '精灵还是 UI 图片' }, slug: 'ui/sprite-or-ui' },
            { label: 'Canvas', translations: { 'zh-CN': '画布' }, slug: 'ui/canvas' },
            { label: 'Layout', translations: { 'zh-CN': '布局' }, slug: 'ui/layout' },
            { label: 'Images', translations: { 'zh-CN': '图片' }, slug: 'ui/images' },
            { label: 'Text', translations: { 'zh-CN': '文本' }, slug: 'ui/text' },
            { label: 'Masks & Visibility', translations: { 'zh-CN': '遮罩与显隐' }, slug: 'ui/masks' },
            { label: 'Interaction', translations: { 'zh-CN': '交互' }, slug: 'ui/interaction' },
            { label: 'Widgets', translations: { 'zh-CN': '控件' }, slug: 'ui/widgets' },
            { label: 'Lists & Scrolling', translations: { 'zh-CN': '列表与滚动' }, slug: 'ui/lists' },
            { label: 'Theming', translations: { 'zh-CN': '主题' }, slug: 'ui/theming' },
            { label: 'Data Binding', translations: { 'zh-CN': '数据绑定' }, slug: 'ui/data-binding' },
            { label: 'Controllers', translations: { 'zh-CN': '控制器' }, slug: 'ui/controllers' },
            { label: 'World UI & Advanced', translations: { 'zh-CN': '世界中的 UI 与进阶' }, slug: 'ui/world-ui' },
            { label: 'UI Debugger', translations: { 'zh-CN': 'UI 调试器' }, slug: 'ui/debugger' },
          ],
        },
        {
          label: 'World Building',
          translations: { 'zh-CN': '世界搭建' },
          collapsed: true,
          items: [
            { label: 'Scenes', translations: { 'zh-CN': '场景' }, slug: 'world/scenes' },
            { label: 'Prefabs', translations: { 'zh-CN': '预制体' }, slug: 'world/prefabs' },
            {
              label: 'Tilemaps',
              translations: { 'zh-CN': '瓦片地图' },
              collapsed: true,
              items: [
                { label: 'Tilemap Basics', translations: { 'zh-CN': '瓦片地图基础' }, slug: 'world/tilemaps/overview' },
                { label: 'Painting Tiles', translations: { 'zh-CN': '绘制瓦片' }, slug: 'world/tilemaps/painting' },
                { label: 'Tilesets', translations: { 'zh-CN': '瓦片集' }, slug: 'world/tilemaps/tilesets' },
                { label: 'Tile Collision', translations: { 'zh-CN': '瓦片碰撞' }, slug: 'world/tilemaps/collision' },
                { label: 'Tiled Maps', translations: { 'zh-CN': 'Tiled 地图' }, slug: 'world/tilemaps/tiled' },
                { label: 'Tilemaps in Code', translations: { 'zh-CN': '代码中的瓦片地图' }, slug: 'world/tilemaps/code' },
              ],
            },
            {
              label: 'Particles',
              translations: { 'zh-CN': '粒子' },
              collapsed: true,
              items: [
                { label: 'Overview', translations: { 'zh-CN': '概述' }, slug: 'world/particles/overview' },
                { label: 'Motion', translations: { 'zh-CN': '运动' }, slug: 'world/particles/motion' },
                { label: 'Rendering', translations: { 'zh-CN': '渲染' }, slug: 'world/particles/rendering' },
                { label: 'Collision & Sub-emitters', translations: { 'zh-CN': '碰撞与子发射器' }, slug: 'world/particles/collision' },
                { label: 'GPU Particles & Performance', translations: { 'zh-CN': 'GPU 粒子与性能' }, slug: 'world/particles/gpu-simulation' },
              ],
            },
            { label: 'World Streaming', translations: { 'zh-CN': '世界流送' }, slug: 'world/streaming' },
            { label: 'Voxel Terrain', translations: { 'zh-CN': '体积地形' }, slug: 'world/voxel-terrain' },
            { label: 'Generated Worlds', translations: { 'zh-CN': '生成世界' }, slug: 'world/generation' },
          ],
        },
        {
          label: 'Assets',
          translations: { 'zh-CN': '资源' },
          collapsed: true,
          items: [
            { label: 'Overview', translations: { 'zh-CN': '总览' }, slug: 'assets/overview' },
            { label: 'Textures', translations: { 'zh-CN': '纹理' }, slug: 'assets/textures' },
            { label: 'Models', translations: { 'zh-CN': '模型' }, slug: 'assets/models' },
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
            { label: 'Device Disk Cache', translations: { 'zh-CN': '设备磁盘缓存' }, slug: 'publishing/content-cache' },
            { label: 'Ads & Sharing', translations: { 'zh-CN': '广告与分享' }, slug: 'publishing/ads-sharing' },
          ],
        },
        {
          label: 'Performance',
          translations: { 'zh-CN': '性能与调试' },
          collapsed: true,
          items: [
            { label: 'Profiling & Diagnostics', translations: { 'zh-CN': '性能剖析与诊断' }, slug: 'performance/profiling' },
            { label: 'Level of Detail', translations: { 'zh-CN': '细节层次(LOD)' }, slug: 'performance/level-of-detail' },
            { label: 'Quality Levels', translations: { 'zh-CN': '画质档位' }, slug: 'performance/quality-levels' },
            { label: 'Occlusion Culling', translations: { 'zh-CN': '遮挡剔除' }, slug: 'performance/occlusion-culling' },
            { label: 'Static Batching', translations: { 'zh-CN': '静态合并' }, slug: 'performance/static-batching' },
            { label: 'Frame Debugger', translations: { 'zh-CN': '帧调试器' }, slug: 'performance/frame-debugger' },
          ],
        },
        {
          label: 'Extending the Editor',
          translations: { 'zh-CN': '扩展编辑器' },
          collapsed: true,
          items: [
            { label: 'Editor Plugins', translations: { 'zh-CN': '编辑器插件' }, slug: 'extending/editor-plugins' },
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
