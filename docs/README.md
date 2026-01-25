# ESEngine Documentation

This directory contains the documentation system for ESEngine, built with **Astro Starlight** and **Doxygen**.

## Structure

```
docs/
├── astro/              # Astro Starlight documentation site
│   ├── src/content/    # MDX documentation files
│   ├── src/assets/     # Images and assets
│   └── package.json    # Node dependencies
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

Documentation is automatically built and deployed when:
- Changes are pushed to `main` branch in `docs/`, `src/**/*.hpp`, or `include/**/*.hpp`
- Workflow is manually triggered

**Setup GitHub Pages:**
1. Go to repository Settings → Pages
2. Set Source to "GitHub Actions"
3. Push changes to trigger deployment

The workflow (`.github/workflows/docs.yml`) will:
1. Build Doxygen API documentation
2. Build Astro site
3. Merge and deploy to GitHub Pages

### Manual Deployment

Build locally and deploy anywhere:

```bash
./build.sh build  # or .\build.ps1 build on Windows
```

Copy `docs/dist/` to any static hosting:
- Vercel
- Netlify
- Cloudflare Pages
- Any web server

## Updating API Docs

API documentation is automatically generated from source code comments. To update:

1. Add/update Doxygen comments in source files
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
