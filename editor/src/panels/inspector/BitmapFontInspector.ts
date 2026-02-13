/**
 * @file    BitmapFontInspector.ts
 * @brief   Bitmap font file inspector with glyph editing and atlas building
 */

import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { icons } from '../../utils/icons';
import {
    getNativeFS,
    getFileName,
    getFileExtension,
    getMimeType,
    getProjectDir,
    openAssetInBrowser,
    renderError,
    escapeHtml,
} from './InspectorHelpers';

export async function renderBitmapFontInspector(
    container: HTMLElement,
    path: string
): Promise<void> {
    const fs = getNativeFS();
    const platform = getPlatformAdapter();
    if (!fs) {
        renderError(container, 'File system not available');
        return;
    }

    const content = await fs.readFile(path);
    if (!content) {
        renderError(container, 'Failed to load font file');
        return;
    }

    let fontData: Record<string, unknown>;
    try {
        fontData = JSON.parse(content);
    } catch {
        renderError(container, 'Invalid font file');
        return;
    }

    const fontType = (fontData.type as string) ?? 'label-atlas';

    const fontDir = path.substring(0, path.lastIndexOf('/'));
    const baseName = getFileName(path).replace('.bmfont', '');

    const save = async () => {
        try {
            await platform.writeTextFile(path, JSON.stringify(fontData, null, 2));
        } catch (err) {
            console.error('Failed to save bitmap font:', err);
        }
    };

    const buildAtlas = async (): Promise<boolean> => {
        const glyphs = (fontData.glyphs ?? {}) as Record<string, string>;
        const validGlyphs = Object.fromEntries(
            Object.entries(glyphs).filter(([, v]) => v)
        );
        const generated = await buildBitmapFontAtlas(fontDir, baseName, validGlyphs);
        if (generated) {
            fontData.generatedFnt = generated.fntName;
            await save();
            return true;
        }
        return false;
    };

    const section = document.createElement('div');
    section.className = 'es-component-section es-collapsible es-expanded';
    section.innerHTML = `
        <div class="es-component-header es-collapsible-header">
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icons.type(14)}</span>
            <span class="es-component-title">BitmapFont</span>
        </div>
        <div class="es-component-properties es-collapsible-content"></div>
    `;

    const header = section.querySelector('.es-collapsible-header');
    header?.addEventListener('click', () => {
        section.classList.toggle('es-expanded');
    });

    const propsContainer = section.querySelector('.es-component-properties')!;

    const typeRow = document.createElement('div');
    typeRow.className = 'es-property-row';
    typeRow.innerHTML = `<label class="es-property-label">Type</label><div class="es-property-editor"></div>`;
    const typeEditor = typeRow.querySelector('.es-property-editor')!;
    const typeSelect = document.createElement('select');
    typeSelect.className = 'es-input es-input-select';
    for (const opt of [{ label: 'BMFont (.fnt)', value: 'bmfont' }, { label: 'LabelAtlas', value: 'label-atlas' }]) {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === fontType) option.selected = true;
        typeSelect.appendChild(option);
    }
    typeEditor.appendChild(typeSelect);
    propsContainer.appendChild(typeRow);

    const dynamicContainer = document.createElement('div');
    propsContainer.appendChild(dynamicContainer);

    const renderFields = () => {
        dynamicContainer.innerHTML = '';
        const currentType = fontData.type as string;

        if (currentType === 'bmfont') {
            createBmfontFileInput(dynamicContainer, 'fntFile', String(fontData.fntFile ?? ''), ['.fnt'], 'FNT Files', async (v) => {
                fontData.fntFile = v;
                await save();
            });
        } else {
            renderGlyphList(dynamicContainer, fontData, fontDir, save);

            const buildBtn = document.createElement('button');
            buildBtn.className = 'es-btn es-btn-primary';
            buildBtn.textContent = 'Build Atlas';
            buildBtn.style.marginTop = '8px';
            buildBtn.style.width = '100%';
            buildBtn.addEventListener('click', async () => {
                buildBtn.disabled = true;
                buildBtn.textContent = 'Building...';
                try {
                    const result = await buildAtlas();
                    buildBtn.textContent = result ? 'Done!' : 'No valid glyphs';
                } catch (err) {
                    console.error('[BitmapFont] Build failed:', err);
                    buildBtn.textContent = 'Build Failed';
                }
                setTimeout(() => {
                    buildBtn.disabled = false;
                    buildBtn.textContent = 'Build Atlas';
                }, 1500);
            });
            dynamicContainer.appendChild(buildBtn);
        }
    };

    typeSelect.addEventListener('change', async () => {
        fontData.type = typeSelect.value;
        if (typeSelect.value === 'label-atlas' && !fontData.glyphs) {
            fontData.glyphs = {};
        }
        await save();
        renderFields();
    });

    renderFields();
    container.appendChild(section);
}

async function buildBitmapFontAtlas(
    fontDir: string,
    baseName: string,
    glyphs: Record<string, string>,
): Promise<{ fntName: string } | null> {
    const fs = getNativeFS();
    const platform = getPlatformAdapter();
    if (!fs) return null;

    const entries: { char: string; img: HTMLImageElement; w: number; h: number }[] = [];

    for (const [char, imgPath] of Object.entries(glyphs)) {
        if (!imgPath) continue;
        const fullPath = `${fontDir}/${imgPath}`;
        const url = platform.convertFilePathToUrl(fullPath);
        try {
            const img = await loadImageFromUrl(url);
            entries.push({ char, img, w: img.naturalWidth, h: img.naturalHeight });
        } catch (err) {
            console.error(`[BitmapFont] Failed to load glyph '${char}': ${fullPath}`, err);
        }
    }

    console.log(`[BitmapFont] Loaded ${entries.length}/${Object.keys(glyphs).length} glyphs`);

    const maxH = entries.length > 0 ? Math.max(...entries.map(e => e.h)) : 1;
    const totalW = entries.reduce((sum, e) => sum + e.w, 0) || 1;
    const atlasW = nextPowerOf2(totalW);
    const atlasH = nextPowerOf2(maxH);

    const canvas = document.createElement('canvas');
    canvas.width = atlasW;
    canvas.height = atlasH;
    const ctx = canvas.getContext('2d')!;

    let x = 0;
    const fntLines = [
        `info face="${baseName}" size=${maxH}`,
        `common lineHeight=${maxH} base=${maxH} scaleW=${atlasW} scaleH=${atlasH} pages=1`,
        `page id=0 file="${baseName}.atlas.png"`,
        `chars count=${entries.length}`,
    ];

    for (const entry of entries) {
        ctx.drawImage(entry.img, x, 0);
        const charCode = entry.char.codePointAt(0)!;
        fntLines.push(
            `char id=${charCode} x=${x} y=0 width=${entry.w} height=${entry.h} xoffset=0 yoffset=0 xadvance=${entry.w} page=0`
        );
        x += entry.w;
    }

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;

    const arrayBuffer = await blob.arrayBuffer();
    const pngData = new Uint8Array(arrayBuffer);

    const atlasPath = `${fontDir}/${baseName}.atlas.png`;
    const fntPath = `${fontDir}/${baseName}.fnt`;

    await fs.writeBinaryFile(atlasPath, pngData);
    await fs.writeFile(fntPath, fntLines.join('\n'));

    return { fntName: `${baseName}.fnt` };
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load: ${url}`));
        img.src = url;
    });
}

function nextPowerOf2(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

function renderGlyphList(
    container: HTMLElement,
    fontData: Record<string, unknown>,
    fontDir: string,
    save: () => Promise<void>,
): void {
    const glyphs = (fontData.glyphs ?? {}) as Record<string, string>;

    const listContainer = document.createElement('div');
    listContainer.className = 'es-bmfont-glyph-list';

    const blobUrls: string[] = [];

    const loadGlyphThumb = async (imgPath: string, dir: string, thumb: HTMLImageElement) => {
        const fs = getNativeFS();
        if (!fs) return;
        const fullPath = `${dir}/${imgPath}`;
        try {
            const data = await fs.readBinaryFile(fullPath);
            if (!data) return;
            const ext = getFileExtension(imgPath);
            const blob = new Blob([new Uint8Array(data).buffer], { type: getMimeType(ext) });
            const url = URL.createObjectURL(blob);
            blobUrls.push(url);
            thumb.src = url;
            thumb.style.display = 'block';
        } catch {}
    };

    const rebuildList = () => {
        for (const url of blobUrls) URL.revokeObjectURL(url);
        blobUrls.length = 0;
        listContainer.innerHTML = '';
        const currentGlyphs = (fontData.glyphs ?? {}) as Record<string, string>;

        for (const [char, imgPath] of Object.entries(currentGlyphs)) {
            const row = document.createElement('div');
            row.className = 'es-property-row es-bmfont-glyph-row';

            const charInput = document.createElement('input');
            charInput.type = 'text';
            charInput.className = 'es-input es-bmfont-char-input';
            charInput.value = char;
            charInput.maxLength = 2;
            charInput.style.width = '36px';
            charInput.style.textAlign = 'center';

            const fileInput = document.createElement('input');
            fileInput.type = 'text';
            fileInput.className = 'es-input es-input-file';
            fileInput.value = imgPath;
            fileInput.placeholder = 'image.png';
            fileInput.readOnly = true;
            fileInput.style.flex = '1';

            const browseBtn = document.createElement('button');
            browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
            browseBtn.title = 'Browse';
            browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'es-btn es-btn-icon es-btn-clear';
            removeBtn.title = 'Remove';
            removeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

            const thumb = document.createElement('img');
            thumb.className = 'es-bmfont-glyph-thumb';
            thumb.style.cssText = 'width:24px;height:24px;object-fit:contain;border-radius:2px;background:#222;flex-shrink:0';
            thumb.style.display = 'none';

            if (imgPath) {
                loadGlyphThumb(imgPath, fontDir, thumb);
            }

            charInput.addEventListener('change', async () => {
                const newChar = charInput.value;
                if (newChar && newChar !== char) {
                    const g = fontData.glyphs as Record<string, string>;
                    delete g[char];
                    g[newChar] = imgPath;
                    await save();
                    rebuildList();
                }
            });

            charInput.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const inputs = listContainer.querySelectorAll('.es-bmfont-char-input');
                    const arr = Array.from(inputs);
                    const idx = arr.indexOf(charInput);
                    const next = e.shiftKey ? arr[idx - 1] : arr[idx + 1];
                    if (next) (next as HTMLInputElement).focus();
                }
            });

            fileInput.style.cursor = 'pointer';
            fileInput.classList.add('es-asset-link');
            fileInput.addEventListener('click', () => {
                if (!imgPath) return;
                const fullRelative = `${fontDir}/${imgPath}`;
                const projectDir = getProjectDir();
                if (projectDir && fullRelative.startsWith(projectDir + '/')) {
                    openAssetInBrowser(fullRelative.substring(projectDir.length + 1));
                } else {
                    openAssetInBrowser(fullRelative);
                }
            });

            browseBtn.addEventListener('click', async () => {
                try {
                    const result = await getPlatformAdapter().openFileDialog({
                        title: 'Select Glyph Image',
                        defaultPath: fontDir,
                        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
                    });
                    if (result) {
                        const relativePath = toRelativeFromDir(result, fontDir);
                        if (relativePath) {
                            (fontData.glyphs as Record<string, string>)[char] = relativePath;
                            fileInput.value = relativePath;
                            await save();
                            loadGlyphThumb(relativePath, fontDir, thumb);
                        }
                    }
                } catch (err) {
                    console.error('Failed to open file dialog:', err);
                }
            });

            removeBtn.addEventListener('click', async () => {
                delete (fontData.glyphs as Record<string, string>)[char];
                await save();
                rebuildList();
            });

            const wrapper = document.createElement('div');
            wrapper.className = 'es-file-editor';
            wrapper.style.display = 'flex';
            wrapper.style.gap = '4px';
            wrapper.style.alignItems = 'center';
            wrapper.style.width = '100%';
            wrapper.appendChild(charInput);
            wrapper.appendChild(thumb);
            wrapper.appendChild(fileInput);
            wrapper.appendChild(browseBtn);
            wrapper.appendChild(removeBtn);

            row.appendChild(wrapper);
            listContainer.appendChild(row);
        }
    };

    rebuildList();
    container.appendChild(listContainer);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'es-bmfont-actions';
    actionsRow.style.display = 'flex';
    actionsRow.style.gap = '4px';
    actionsRow.style.padding = '4px 0';

    const addBtn = document.createElement('button');
    addBtn.className = 'es-btn es-btn-small';
    addBtn.textContent = 'Add Glyph';
    addBtn.addEventListener('click', async () => {
        const g = (fontData.glyphs ?? {}) as Record<string, string>;
        let nextChar = 'A';
        for (let i = 65; i < 127; i++) {
            const c = String.fromCharCode(i);
            if (!(c in g)) { nextChar = c; break; }
        }
        g[nextChar] = '';
        fontData.glyphs = g;
        await save();
        rebuildList();
    });

    const importBtn = document.createElement('button');
    importBtn.className = 'es-btn es-btn-small';
    importBtn.textContent = 'Import Folder';
    importBtn.addEventListener('click', async () => {
        const fs = getNativeFS();
        if (!fs) return;
        try {
            const sampleFile = await getPlatformAdapter().openFileDialog({
                title: 'Select any image in the glyph folder',
                defaultPath: fontDir,
                filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
            });
            if (!sampleFile) return;
            const normalized = sampleFile.replace(/\\/g, '/');
            const folderPath = normalized.substring(0, normalized.lastIndexOf('/'));
            const entries = await fs.listDirectoryDetailed(folderPath);
            const imageExts = ['.png', '.jpg', '.jpeg', '.webp'];
            const g = (fontData.glyphs ?? {}) as Record<string, string>;
            for (const entry of entries) {
                if (entry.isDirectory) continue;
                const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase();
                if (!imageExts.includes(ext)) continue;
                const charName = entry.name.substring(0, entry.name.lastIndexOf('.'));
                if (!charName) continue;
                const relativePath = toRelativeFromDir(`${folderPath}/${entry.name}`, fontDir);
                if (relativePath) {
                    g[charName] = relativePath;
                }
            }
            fontData.glyphs = g;
            await save();
            rebuildList();
        } catch (err) {
            console.error('Failed to import folder:', err);
        }
    });

    actionsRow.appendChild(addBtn);
    actionsRow.appendChild(importBtn);
    container.appendChild(actionsRow);

    const countDiv = document.createElement('div');
    countDiv.className = 'es-property-value';
    countDiv.style.padding = '2px 0';
    countDiv.style.fontSize = '11px';
    countDiv.style.opacity = '0.6';
    countDiv.textContent = `${Object.keys(glyphs).length} glyphs`;
    container.appendChild(countDiv);
}

function toRelativeFromDir(absolutePath: string, dir: string): string | null {
    const normalized = absolutePath.replace(/\\/g, '/');
    const normalizedDir = dir.replace(/\\/g, '/');
    if (normalized.startsWith(normalizedDir + '/')) {
        return normalized.substring(normalizedDir.length + 1);
    }
    return normalized.substring(normalized.lastIndexOf('/') + 1);
}

function createBmfontFileInput(
    container: HTMLElement,
    label: string,
    value: string,
    extensions: string[],
    filterName: string,
    onChange: (v: string) => void
): void {
    const row = document.createElement('div');
    row.className = 'es-property-row';
    row.innerHTML = `<label class="es-property-label">${escapeHtml(label)}</label><div class="es-property-editor"></div>`;
    const editor = row.querySelector('.es-property-editor')!;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-file-editor';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-file';
    input.value = value;
    input.placeholder = 'None';

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"></path></svg>`;

    browseBtn.addEventListener('click', async () => {
        const projectDir = getProjectDir();
        if (!projectDir) return;
        try {
            const result = await getPlatformAdapter().openFileDialog({
                title: `Select ${label}`,
                defaultPath: `${projectDir}/assets`,
                filters: [{ name: filterName, extensions: extensions.map(e => e.replace('.', '')) }],
            });
            if (result) {
                const normalizedPath = result.replace(/\\/g, '/');
                const assetsIndex = normalizedPath.indexOf('/assets/');
                if (assetsIndex !== -1) {
                    const relativePath = normalizedPath.substring(assetsIndex + '/assets/'.length);
                    input.value = relativePath;
                    onChange(relativePath);
                }
            }
        } catch (err) {
            console.error('Failed to open file dialog:', err);
        }
    });

    input.addEventListener('change', () => onChange(input.value));
    wrapper.appendChild(input);
    wrapper.appendChild(browseBtn);
    editor.appendChild(wrapper);
    container.appendChild(row);
}
