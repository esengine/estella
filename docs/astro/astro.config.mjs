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
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'ECS Architecture', slug: 'core-concepts/ecs' },
            { label: 'Components', slug: 'core-concepts/components' },
            { label: 'Systems', slug: 'core-concepts/systems' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'C++ API (Doxygen)', link: '/docs/api/html/', attrs: { target: '_blank' } },
            { label: 'Architecture', link: 'https://github.com/esengine/estella/blob/master/docs/ARCHITECTURE.md' },
          ],
        },
      ],
    }),
  ],
});
