// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

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
      // English is the root locale (served at /docs); 简体中文 at /docs/zh-cn.
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
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
          ],
        },
        {
          label: 'Core Concepts',
          translations: { 'zh-CN': '核心概念' },
          items: [
            { label: 'ECS Architecture', translations: { 'zh-CN': 'ECS 架构' }, slug: 'core-concepts/ecs' },
            { label: 'Components', translations: { 'zh-CN': '组件' }, slug: 'core-concepts/components' },
            { label: 'Systems', translations: { 'zh-CN': '系统' }, slug: 'core-concepts/systems' },
          ],
        },
        {
          label: 'Reference',
          translations: { 'zh-CN': '参考' },
          items: [
            { label: 'C++ API (Doxygen)', link: '/docs/api/html/', attrs: { target: '_blank' } },
            { label: 'Architecture', link: 'https://github.com/esengine/estella/blob/master/docs/ARCHITECTURE.md' },
          ],
        },
      ],
    }),
  ],
});
