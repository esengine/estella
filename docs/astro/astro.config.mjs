import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://esengine.github.io',
  base: '/microes',
  vite: {
    server: {
      fs: {
        allow: ['..'],
      },
    },
  },
  integrations: [
    starlight({
      title: 'ESEngine',
      description: 'A lightweight 2D game engine for web and WeChat MiniGames',
      favicon: '/favicon.svg',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      social: {
        github: 'https://github.com/esengine/microes',
        discord: 'https://discord.gg/sAX6PXZ9',
      },
      editLink: {
        baseUrl: 'https://github.com/esengine/microes/edit/master/docs/astro/',
      },
      customCss: [
        './src/styles/custom.css',
      ],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        zh: { label: '简体中文', lang: 'zh-CN' },
      },
      sidebar: [
        {
          label: 'Getting Started',
          translations: { 'zh-CN': '快速上手' },
          items: [
            { label: 'Introduction', translations: { 'zh-CN': '简介' }, slug: 'getting-started/introduction' },
            { label: 'Installation', translations: { 'zh-CN': '安装' }, slug: 'getting-started/installation' },
            { label: 'Quick Start', translations: { 'zh-CN': '快速开始' }, slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Core Concepts',
          translations: { 'zh-CN': '核心概念' },
          items: [
            { label: 'ECS Architecture', translations: { 'zh-CN': 'ECS 架构' }, slug: 'core-concepts/ecs' },
            { label: 'Components', translations: { 'zh-CN': '组件' }, slug: 'core-concepts/components' },
            { label: 'Systems', translations: { 'zh-CN': '系统' }, slug: 'core-concepts/systems' },
            { label: 'Queries', translations: { 'zh-CN': '查询' }, slug: 'core-concepts/queries' },
            { label: 'Resources', translations: { 'zh-CN': '资源' }, slug: 'core-concepts/resources' },
            { label: 'Change Detection', translations: { 'zh-CN': '变更检测' }, slug: 'core-concepts/change-detection' },
            { label: 'Events', translations: { 'zh-CN': '事件' }, slug: 'core-concepts/events' },
          ],
        },
        {
          label: 'Guides',
          translations: { 'zh-CN': '指南' },
          items: [
            {
              label: 'Rendering',
              translations: { 'zh-CN': '渲染' },
              items: [
                { label: 'Overview', translations: { 'zh-CN': '概览' }, slug: 'guides/rendering' },
                { label: 'Canvas & Resolution', translations: { 'zh-CN': 'Canvas 与分辨率' }, slug: 'guides/canvas' },
                { label: 'Sprite', translations: { 'zh-CN': '精灵' }, slug: 'guides/sprite' },
                { label: 'Sprite Animation', translations: { 'zh-CN': '精灵动画' }, slug: 'guides/sprite-animation' },
                { label: 'Tween Animation', translations: { 'zh-CN': '补间动画' }, slug: 'guides/tween' },
                { label: 'Spine Animation', translations: { 'zh-CN': 'Spine 动画' }, slug: 'guides/spine' },
                { label: 'Bitmap Text', translations: { 'zh-CN': '位图文本' }, slug: 'guides/bitmap-text' },
                { label: 'Custom Draw', translations: { 'zh-CN': '自定义绘制' }, slug: 'guides/custom-draw' },
                { label: 'Post-Processing', translations: { 'zh-CN': '后处理效果' }, slug: 'guides/post-processing' },
                { label: 'Render Texture', translations: { 'zh-CN': '渲染纹理' }, slug: 'guides/render-texture' },
                { label: 'Particles', translations: { 'zh-CN': '粒子系统' }, slug: 'guides/particles' },
                { label: 'Shape Renderer', translations: { 'zh-CN': '形状渲染器' }, slug: 'guides/shape-renderer' },
              ],
            },
            { label: 'Scenes', translations: { 'zh-CN': '场景' }, slug: 'guides/scenes' },
            { label: 'Prefabs', translations: { 'zh-CN': '预制体' }, slug: 'guides/prefabs' },
            { label: 'Input Handling', translations: { 'zh-CN': '输入处理' }, slug: 'guides/input' },
            {
              label: 'UI',
              translations: { 'zh-CN': 'UI' },
              items: [
                { label: 'Layout', translations: { 'zh-CN': '布局' }, slug: 'guides/ui' },
                { label: 'Text & Image', translations: { 'zh-CN': '文本与图片' }, slug: 'guides/ui-text' },
                { label: 'Interaction', translations: { 'zh-CN': '交互' }, slug: 'guides/ui-interaction' },
                { label: 'Widgets', translations: { 'zh-CN': '控件' }, slug: 'guides/ui-widgets' },
                { label: 'Masking & SafeArea', translations: { 'zh-CN': '遮罩与安全区' }, slug: 'guides/ui-masking' },
              ],
            },
            {
              label: 'Physics',
              translations: { 'zh-CN': '物理' },
              items: [
                { label: 'Overview', translations: { 'zh-CN': '概述' }, slug: 'guides/physics' },
                { label: 'RigidBody', translations: { 'zh-CN': '刚体' }, slug: 'guides/physics/rigidbody' },
                { label: 'Colliders', translations: { 'zh-CN': '碰撞器' }, slug: 'guides/physics/colliders' },
                { label: 'Segment Collider', translations: { 'zh-CN': '线段碰撞器' }, slug: 'guides/physics/segment-collider' },
                { label: 'Polygon Collider', translations: { 'zh-CN': '多边形碰撞器' }, slug: 'guides/physics/polygon-collider' },
                { label: 'Chain Collider', translations: { 'zh-CN': '链条碰撞器' }, slug: 'guides/physics/chain-collider' },
                { label: 'Events', translations: { 'zh-CN': '碰撞事件' }, slug: 'guides/physics/events' },
                { label: 'API', translations: { 'zh-CN': '物理 API' }, slug: 'guides/physics/api' },
                { label: 'Debug Draw', translations: { 'zh-CN': '调试绘制' }, slug: 'guides/physics/debug-draw' },
              ],
            },
            { label: 'Audio', translations: { 'zh-CN': '音频' }, slug: 'guides/audio' },
            { label: 'Tilemap', translations: { 'zh-CN': '瓦片地图' }, slug: 'guides/tilemap' },
            {
              label: 'Assets & Materials',
              translations: { 'zh-CN': '资源与材质' },
              items: [
                { label: 'Asset Loading', translations: { 'zh-CN': '资源加载' }, slug: 'guides/assets' },
                { label: 'Materials & Shaders', translations: { 'zh-CN': '材质与着色器' }, slug: 'guides/materials' },
                { label: 'Geometry & Meshes', translations: { 'zh-CN': '几何体与网格' }, slug: 'guides/geometry' },
              ],
            },
            { label: 'Storage', translations: { 'zh-CN': '数据存储' }, slug: 'guides/storage' },
            { label: 'Plugins', translations: { 'zh-CN': '插件系统' }, slug: 'guides/plugins' },
            {
              label: 'Editor',
              translations: { 'zh-CN': '编辑器' },
              items: [
                { label: 'Game View', translations: { 'zh-CN': 'Game View' }, slug: 'guides/game-view' },
                { label: 'Project Settings', translations: { 'zh-CN': '项目设置' }, slug: 'guides/project-settings' },
                { label: 'Editor Extensions', translations: { 'zh-CN': '编辑器扩展' }, slug: 'guides/editor-extensions' },
                { label: 'Profiler', translations: { 'zh-CN': '性能分析' }, slug: 'guides/profiler' },
                { label: 'Debugging', translations: { 'zh-CN': '调试' }, slug: 'guides/debugging' },
              ],
            },
            {
              label: 'Build & Deploy',
              translations: { 'zh-CN': '构建与部署' },
              items: [
                { label: 'Building', translations: { 'zh-CN': '构建' }, slug: 'guides/building' },
                { label: 'WeChat MiniGame', translations: { 'zh-CN': '微信小游戏' }, slug: 'guides/wechat' },
                { label: 'Playable Ads', translations: { 'zh-CN': '可玩广告' }, slug: 'guides/playable-ads' },
              ],
            },
          ],
        },
        {
          label: 'Changelog',
          translations: { 'zh-CN': '更新日志' },
          items: [
            { label: 'v0.8.3', slug: 'changelog-v083' },
            { label: 'v0.8.2', slug: 'changelog-v082' },
            { label: 'v0.8.1', slug: 'changelog-v081' },
            { label: 'v0.8.0', slug: 'changelog-v080' },
            { label: 'v0.7.0', slug: 'changelog-v070' },
            { label: 'v0.6.2', slug: 'changelog-v062' },
            { label: 'v0.6.1', slug: 'changelog-v061' },
            { label: 'v0.6.0', slug: 'changelog-v060' },
            { label: 'v0.5.1', slug: 'changelog-v051' },
            { label: 'v0.5.0', slug: 'changelog-v050' },
            { label: 'v0.4.3', slug: 'changelog-v043' },
            { label: 'v0.4.2', slug: 'changelog-v042' },
            { label: 'v0.4.1', slug: 'changelog-v041' },
            { label: 'v0.4.0', slug: 'changelog-v040' },
            { label: 'v0.3.0', slug: 'changelog' },
          ],
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'og:image',
            content: '/esengine/og-image.png',
          },
        },
      ],
      lastUpdated: true,
    }),
  ],
});
