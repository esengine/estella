# Building the Estella Docs Site

The published documentation site ([estellaengine.com/docs](https://estellaengine.com/docs))
is built with **Astro Starlight** (guides), **TypeDoc** (TypeScript API reference,
generated at build time from the SDK's public barrels via `starlight-typedoc` —
the pages land in `docs/astro/src/content/docs/api-ts/`, which is gitignored) and
**Doxygen** (C++ API reference), merged into a single static bundle.

The Starlight site lives in `docs/astro/` and the landing page in `docs/landing/`.
The Doxygen API version (`PROJECT_NUMBER`) is injected at build time from
`desktop/package.json` (the single app-version source) via the `ESTELLA_VERSION`
environment variable — see `build.sh`, `build.ps1`, and
`.github/workflows/docs.yml`.

## Structure

```
docs/
├── astro/              # Astro Starlight documentation site
│   ├── src/content/    # MDX documentation files
│   ├── src/assets/     # Images and assets
│   └── package.json    # Node dependencies
├── landing/            # Landing page + static site assets
├── api/                # Doxygen output (generated)
├── Doxyfile            # Doxygen configuration
├── build.sh            # Build script (Linux/macOS)
├── build.ps1           # Build script (Windows)
└── dist/               # Final merged output (generated)
```

## Prerequisites

- **Node.js** 18+ (for Astro)
- **Doxygen** (for API docs)

### Installing Doxygen

**Windows:**
```powershell
choco install doxygen.install
# or download from https://www.doxygen.nl/download.html
```

**macOS:**
```bash
brew install doxygen
```

**Linux:**
```bash
sudo apt install doxygen  # Debian/Ubuntu
sudo dnf install doxygen  # Fedora
```

## Quick Start

### Development (Hot Reload)

```bash
# Windows
.\build.ps1 dev

# Linux/macOS
./build.sh dev
```

Opens http://localhost:4321 with live reload.

### Full Build

```bash
# Windows
.\build.ps1 build

# Linux/macOS
./build.sh build
```

This will:
1. Build Doxygen API documentation → `docs/api/`
2. Build Astro site → `docs/astro/dist/`
3. Merge everything → `docs/dist/`

## Writing Documentation

### The one structural rule

**A page's directory path is its sidebar path is its URL.** A sidebar group is a
directory (`editor/`, `scripting/`, `graphics/`, …); a subgroup inside one is a
directory inside it (`gameplay/ai/`); and a group's general page is
`<dir>/overview.mdx`, labelled **Overview** in the sidebar because the group
header already says the topic — its `title` stays descriptive, since that is the
page's own heading. Nothing else decides where a file goes.

Depth is free: images are referenced through the `@/` alias
(`![](@/assets/guides/en/foo.png)`), not by counting `../`, so a page can move
between levels without its pictures going dark.

### Adding a New Guide

1. Create the `.mdx` under the group it belongs to — sections today are
   `getting-started`, `editor`, `core-concepts`, `scripting`, `graphics`,
   `animation`, `gameplay`, `ui`, `world`, `assets`, `publishing`,
   `performance`, `extending` and `reference`.
2. Add frontmatter:
   ```mdx
   ---
   title: My Guide
   description: A brief description
   ---

   Your content here...
   ```
3. Add it to the matching sidebar group in `astro/astro.config.mjs`, and write the
   Simplified Chinese page at `astro/src/content/docs/zh-cn/<same path>.mdx`.
4. If you move or rename a page, append its old path to `MOVED` in
   `astro/astro.config.mjs`. That map is append-only — a URL published once keeps
   resolving.

### The gates

Three checks keep the site honest; all three run in CI, and all three are worth
running locally before a docs PR.

| Check | Run from | Catches |
|---|---|---|
| `npm run verify:imports` | `docs/astro` | A guide importing a symbol the SDK does not export — a renamed or invented API. Runs before the build. |
| `npm run verify:structure` | `docs/astro` | The rule above going soft: a page in no sidebar group, a sidebar entry with no page, a group page not labelled Overview, or a page that exists in only one language. Runs before the build. |
| `npm run verify:links` | `docs/astro` | Any in-site link or `#anchor` that does not resolve against the pages the build emitted, including a root-relative link that forgot the `/docs` base. Runs **after** the build. |
| `node tools/component-reference.mjs --check` | repo root | The component reference disagreeing with the engine's component registry, or a component with no entry in `src/data/componentDocs.ts`. Part of `pnpm run verify`, so pre-push catches it. Refresh with `--update` after building the SDK. |

### Available Components

Starlight provides several built-in components:

```mdx
import { Tabs, TabItem, Card, CardGrid, Aside, Steps } from '@astrojs/starlight/components';

<Aside type="tip">
  Helpful tip here
</Aside>

<Tabs>
  <TabItem label="Tab 1">Content 1</TabItem>
  <TabItem label="Tab 2">Content 2</TabItem>
</Tabs>

<Steps>
1. First step
2. Second step
</Steps>
```

### Code Blocks

````mdx
```cpp title="example.cpp" {3-5}
int main() {
    // This line is highlighted
    Application app;
    app.run();
    return 0;
}
```
````

## Deployment

### GitHub Actions (Automatic)

The site is built and deployed by `.github/workflows/docs.yml` when a `docs-v*`
tag is pushed or the workflow is dispatched manually. The workflow:

1. Builds Doxygen API documentation
2. Builds the Astro site
3. Merges and deploys to GitHub Pages

**Setting up GitHub Pages:**
1. Go to repository Settings → Pages
2. Set Source to "GitHub Actions"
3. Push a `docs-v*` tag (or run the workflow manually) to trigger deployment

### Manual Deployment

Build locally and deploy anywhere:

```bash
./build.sh build  # or .\build.ps1 build on Windows
```

Copy `docs/dist/` to any static host:
- Vercel
- Netlify
- Cloudflare Pages
- Any web server

## Updating API Docs

API documentation is generated from source-code comments. To update:

1. Add or update Doxygen comments in the source (see [CODE_COMMENTS.md](./CODE_COMMENTS.md))
2. Run `./build.sh doxygen`

### Doxygen Comment Format

```cpp
/**
 * @brief Brief description
 * @details Longer description with more details.
 *
 * @param paramName Description of parameter
 * @return Description of return value
 *
 * @code
 * // Example usage
 * MyClass obj;
 * obj.method();
 * @endcode
 */
void MyClass::method(int paramName);
```
