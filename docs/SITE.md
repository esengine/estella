# Building the Estella Docs Site

The published documentation site ([estellaengine.com/docs](https://estellaengine.com/docs))
is built with **Astro Starlight** (guides) and **Doxygen** (C++ API reference),
merged into a single static bundle.

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

### Adding a New Guide

1. Create a new `.mdx` file in `astro/src/content/docs/guides/`
2. Add frontmatter:
   ```mdx
   ---
   title: My Guide
   description: A brief description
   ---

   Your content here...
   ```
3. Add to sidebar in `astro/astro.config.mjs`

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
