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
      description: 'A lightweight C++17 game engine for WebAssembly and WeChat MiniGames',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
        replacesTitle: false,
      },
      social: {
        github: 'https://github.com/esengine/microes',
      },
      editLink: {
        baseUrl: 'https://github.com/esengine/microes/edit/main/docs/astro/',
      },
      customCss: [
        './src/styles/custom.css',
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Project Structure', slug: 'guides/project-structure' },
            { label: 'ECS Architecture', slug: 'guides/ecs' },
            { label: 'Rendering', slug: 'guides/rendering' },
            { label: 'Input Handling', slug: 'guides/input' },
          ],
        },
        {
          label: 'Platforms',
          items: [
            { label: 'Web (Emscripten)', slug: 'platforms/web' },
            { label: 'WeChat MiniGame', slug: 'platforms/wechat' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Overview', slug: 'api/overview' },
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
