import { icons } from '../../utils/icons';
import { getNativeFS, getFileName, renderError, getAssetServer } from './InspectorHelpers';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { getGlobalPathResolver } from '../../asset';

interface AnimClipAssetData {
    version: string;
    type: 'animation-clip';
    fps?: number;
    loop?: boolean;
    frames: { texture: string }[];
}

const MIN_FPS = 1;
const MAX_FPS = 60;

interface FrameInfo {
    texture: string;
    thumbnailUrl: string | null;
}

export async function renderAnimClipInspector(container: HTMLElement, path: string): Promise<void> {
    const platform = getPlatformAdapter();

    let data: AnimClipAssetData;
    try {
        const raw = await platform.readTextFile(path);
        data = JSON.parse(raw) as AnimClipAssetData;
    } catch {
        renderError(container, 'Failed to load animation clip');
        return;
    }

    const section = document.createElement('div');
    section.className = 'es-component-section es-collapsible es-expanded';
    container.appendChild(section);

    const frames: FrameInfo[] = data.frames.map(f => ({
        texture: f.texture,
        thumbnailUrl: null,
    }));

    const state = {
        fps: data.fps ?? 12,
        loop: data.loop ?? true,
        frames,
    };

    renderSection(section, state, path);
    loadThumbnails(section, state, path);
}

function renderSection(
    section: HTMLElement,
    state: { fps: number; loop: boolean; frames: FrameInfo[] },
    filePath: string,
): void {
    section.innerHTML = `
        <div class="es-component-header es-collapsible-header">
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icons.film(14)}</span>
            <span class="es-component-title">Animation Clip</span>
        </div>
        <div class="es-component-properties es-collapsible-content">
            <div class="es-property-row">
                <label class="es-property-label">FPS</label>
                <div class="es-property-value es-animclip-fps">
                    <input type="range" min="${MIN_FPS}" max="${MAX_FPS}" step="1" value="${state.fps}" class="es-animclip-slider">
                    <span class="es-animclip-fps-value">${state.fps}</span>
                </div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">Loop</label>
                <div class="es-property-value">
                    <input type="checkbox" class="es-animclip-loop" ${state.loop ? 'checked' : ''}>
                </div>
            </div>
            <div class="es-property-row es-animclip-frames-header">
                <label class="es-property-label">Frames (${state.frames.length})</label>
                <button class="es-btn es-btn-sm es-animclip-add-btn">${icons.plus(12)} Add</button>
            </div>
            <div class="es-animclip-frame-list">
                ${renderFrameList(state.frames)}
            </div>
            <div class="es-animclip-drop-zone">
                Drop images here to add frames
            </div>
        </div>
    `;

    const header = section.querySelector('.es-collapsible-header');
    header?.addEventListener('click', () => {
        section.classList.toggle('es-expanded');
    });

    const slider = section.querySelector('.es-animclip-slider') as HTMLInputElement;
    const fpsValue = section.querySelector('.es-animclip-fps-value')!;
    slider.addEventListener('input', () => {
        fpsValue.textContent = slider.value;
    });
    slider.addEventListener('change', () => {
        state.fps = parseInt(slider.value, 10);
        save(state, filePath);
    });

    const loopCheckbox = section.querySelector('.es-animclip-loop') as HTMLInputElement;
    loopCheckbox.addEventListener('change', () => {
        state.loop = loopCheckbox.checked;
        save(state, filePath);
    });

    const addBtn = section.querySelector('.es-animclip-add-btn')!;
    addBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.multiple = true;
        input.addEventListener('change', async () => {
            if (!input.files || input.files.length === 0) return;
            for (const file of Array.from(input.files)) {
                const resolver = getGlobalPathResolver();
                const projectDir = resolver.getProjectDir();
                if (!projectDir) continue;
                state.frames.push({ texture: file.name, thumbnailUrl: null });
            }
            await save(state, filePath);
            renderSection(section, state, filePath);
            loadThumbnails(section, state, filePath);
        });
        input.click();
    });

    setupDeleteButtons(section, state, filePath);
    setupDropZone(section, state, filePath);
}

function renderFrameList(frames: FrameInfo[]): string {
    if (frames.length === 0) {
        return '<div class="es-animclip-empty">No frames</div>';
    }

    return frames.map((frame, i) => `
        <div class="es-animclip-frame" data-index="${i}">
            <div class="es-animclip-frame-thumb">
                ${frame.thumbnailUrl
                    ? `<img src="${frame.thumbnailUrl}" alt="frame ${i}">`
                    : `<span class="es-animclip-frame-index">${String(i).padStart(2, '0')}</span>`
                }
            </div>
            <span class="es-animclip-frame-name" title="${frame.texture}">${getFileName(frame.texture)}</span>
            <button class="es-btn es-btn-icon es-animclip-delete-btn" data-index="${i}" title="Remove frame">
                ${icons.x(12)}
            </button>
        </div>
    `).join('');
}

function setupDeleteButtons(
    section: HTMLElement,
    state: { fps: number; loop: boolean; frames: FrameInfo[] },
    filePath: string,
): void {
    const buttons = section.querySelectorAll('.es-animclip-delete-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const index = parseInt((btn as HTMLElement).dataset.index!, 10);
            const removed = state.frames[index];
            state.frames.splice(index, 1);
            if (removed?.thumbnailUrl) {
                URL.revokeObjectURL(removed.thumbnailUrl);
            }
            await save(state, filePath);
            renderSection(section, state, filePath);
            loadThumbnails(section, state, filePath);
        });
    });
}

function setupDropZone(
    section: HTMLElement,
    state: { fps: number; loop: boolean; frames: FrameInfo[] },
    filePath: string,
): void {
    const dropZone = section.querySelector('.es-animclip-drop-zone')!;
    const content = section.querySelector('.es-collapsible-content')!;

    const handleDragOver = (e: Event) => {
        const de = e as DragEvent;
        de.preventDefault();
        de.stopPropagation();
        dropZone.classList.add('es-drag-over');
    };

    const handleDragLeave = (e: Event) => {
        const de = e as DragEvent;
        de.preventDefault();
        dropZone.classList.remove('es-drag-over');
    };

    const handleDrop = async (e: Event) => {
        const de = e as DragEvent;
        de.preventDefault();
        de.stopPropagation();
        dropZone.classList.remove('es-drag-over');

        const assetStr = de.dataTransfer?.getData('application/esengine-asset');
        if (!assetStr) return;

        let assets: { type: string; path: string; name: string }[];
        try {
            const parsed = JSON.parse(assetStr);
            assets = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
            return;
        }

        const imageAssets = assets.filter(a => a.type === 'image');
        if (imageAssets.length === 0) return;

        const resolver = getGlobalPathResolver();
        for (const asset of imageAssets) {
            const relativePath = resolver.toRelativePath(asset.path);
            state.frames.push({ texture: relativePath, thumbnailUrl: null });
        }

        await save(state, filePath);
        renderSection(section, state, filePath);
        loadThumbnails(section, state, filePath);
    };

    content.addEventListener('dragover', handleDragOver);
    content.addEventListener('dragleave', handleDragLeave);
    content.addEventListener('drop', handleDrop);
}

async function loadThumbnails(
    section: HTMLElement,
    state: { fps: number; loop: boolean; frames: FrameInfo[] },
    _filePath: string,
): Promise<void> {
    const fs = getNativeFS();
    if (!fs) return;

    const resolver = getGlobalPathResolver();

    for (let i = 0; i < state.frames.length; i++) {
        const frame = state.frames[i];
        if (frame.thumbnailUrl) continue;

        const absPath = resolver.toAbsolutePath(frame.texture);
        try {
            const data = await fs.readBinaryFile(absPath);
            if (!data) continue;

            const blob = new Blob([new Uint8Array(data).buffer]);
            const url = URL.createObjectURL(blob);
            frame.thumbnailUrl = url;

            const thumbEl = section.querySelector(`.es-animclip-frame[data-index="${i}"] .es-animclip-frame-thumb`);
            if (thumbEl) {
                thumbEl.innerHTML = `<img src="${url}" alt="frame ${i}">`;
            }
        } catch {
            // skip unresolvable frames
        }
    }
}

async function save(
    state: { fps: number; loop: boolean; frames: FrameInfo[] },
    filePath: string,
): Promise<void> {
    const data: AnimClipAssetData = {
        version: '1.0',
        type: 'animation-clip',
        fps: state.fps,
        loop: state.loop,
        frames: state.frames.map(f => ({ texture: f.texture })),
    };

    const platform = getPlatformAdapter();
    await platform.writeTextFile(filePath, JSON.stringify(data, null, 2));

    const resolver = getGlobalPathResolver();
    const relativePath = resolver.toRelativePath(filePath);
    getAssetServer()?.reloadAnimClip(relativePath);
}
