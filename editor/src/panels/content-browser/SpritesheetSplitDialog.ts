/**
 * @file    SpritesheetSplitDialog.ts
 * @brief   Dialog for splitting a spritesheet image into animation clip frames
 */

import { Dialog } from '../../ui/dialog';
import { getPlatformAdapter } from '../../platform/PlatformAdapter';
import { showErrorToast } from '../../ui/Toast';
import { getGlobalPathResolver } from '../../asset';
import { getNativeFS, type ContentBrowserState } from './ContentBrowserTypes';
import { getFileExtension, getMimeType } from '../inspector/InspectorHelpers';

interface SpritesheetConfig {
    columns: number;
    rows: number;
    fps: number;
    loop: boolean;
    frameCount: number;
    clipName: string;
}

export async function showSpritesheetSplitDialog(
    state: ContentBrowserState,
    imagePath: string,
): Promise<void> {
    const fs = getNativeFS();
    if (!fs) return;

    const data = await fs.readBinaryFile(imagePath);
    if (!data) {
        showErrorToast('Failed to load image', 'Could not read file');
        return;
    }

    const ext = getFileExtension(imagePath);
    const mimeType = getMimeType(ext);
    const blob = new Blob([new Uint8Array(data).buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = url;
    });

    const fileName = imagePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'NewAnimClip';

    const config: SpritesheetConfig = {
        columns: 4,
        rows: 4,
        fps: 12,
        loop: true,
        frameCount: 16,
        clipName: fileName,
    };

    const content = document.createElement('div');
    content.className = 'es-spritesheet-dialog';

    const previewContainer = document.createElement('div');
    previewContainer.className = 'es-spritesheet-preview';

    const canvas = document.createElement('canvas');
    canvas.className = 'es-spritesheet-canvas';
    previewContainer.appendChild(canvas);

    const sizeLabel = document.createElement('div');
    sizeLabel.className = 'es-spritesheet-size-label';
    previewContainer.appendChild(sizeLabel);

    content.appendChild(previewContainer);

    const controls = document.createElement('div');
    controls.className = 'es-spritesheet-controls';

    const nameRow = createFieldRow('Clip Name', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'es-dialog-input';
        input.value = config.clipName;
        input.addEventListener('input', () => { config.clipName = input.value.trim(); });
        return input;
    });
    controls.appendChild(nameRow);

    const gridSection = document.createElement('div');
    gridSection.className = 'es-spritesheet-grid-row';

    const colInput = createNumberInput('Columns', config.columns, 1, 64, (v) => {
        config.columns = v;
        config.frameCount = Math.min(config.frameCount, v * config.rows);
        frameInput.max = String(v * config.rows);
        (frameInput as HTMLInputElement).value = String(config.frameCount);
        drawGrid();
    });
    gridSection.appendChild(colInput);

    const rowInput = createNumberInput('Rows', config.rows, 1, 64, (v) => {
        config.rows = v;
        config.frameCount = Math.min(config.frameCount, config.columns * v);
        frameInput.max = String(config.columns * v);
        (frameInput as HTMLInputElement).value = String(config.frameCount);
        drawGrid();
    });
    gridSection.appendChild(rowInput);

    controls.appendChild(gridSection);

    const frameRow = document.createElement('div');
    frameRow.className = 'es-spritesheet-grid-row';

    let frameInput!: HTMLInputElement;
    const frameField = createNumberInput('Frames', config.frameCount, 1, config.columns * config.rows, (v) => {
        config.frameCount = v;
        drawGrid();
    });
    frameInput = frameField.querySelector('input')!;
    frameRow.appendChild(frameField);

    const fpsField = createNumberInput('FPS', config.fps, 1, 120, (v) => {
        config.fps = v;
    });
    frameRow.appendChild(fpsField);

    controls.appendChild(frameRow);

    const loopRow = createFieldRow('Loop', () => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = config.loop;
        checkbox.addEventListener('change', () => { config.loop = checkbox.checked; });
        return checkbox;
    });
    controls.appendChild(loopRow);

    const frameSizeInfo = document.createElement('div');
    frameSizeInfo.className = 'es-spritesheet-info';
    controls.appendChild(frameSizeInfo);

    content.appendChild(controls);

    function drawGrid(): void {
        const maxW = 400;
        const maxH = 300;
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);

        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const cellW = w / config.columns;
        const cellH = h / config.rows;

        ctx.strokeStyle = 'rgba(209, 154, 102, 0.8)';
        ctx.lineWidth = 1;

        for (let c = 1; c < config.columns; c++) {
            const x = Math.round(c * cellW) + 0.5;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let r = 1; r < config.rows; r++) {
            const y = Math.round(r * cellH) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        const total = config.columns * config.rows;
        if (config.frameCount < total) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            for (let i = config.frameCount; i < total; i++) {
                const col = i % config.columns;
                const row = Math.floor(i / config.columns);
                ctx.fillRect(col * cellW, row * cellH, cellW, cellH);
            }
        }

        const frameW = Math.round(img.naturalWidth / config.columns);
        const frameH = Math.round(img.naturalHeight / config.rows);
        sizeLabel.textContent = `${img.naturalWidth} \u00d7 ${img.naturalHeight}`;
        frameSizeInfo.textContent = `Frame: ${frameW} \u00d7 ${frameH} px \u00b7 ${config.frameCount} frames`;
    }

    drawGrid();

    let dialog: Dialog;

    const submit = async (): Promise<boolean> => {
        const name = config.clipName || fileName;
        const clipFileName = name.endsWith('.esanim') ? name : name + '.esanim';
        const parentDir = imagePath.substring(0, imagePath.lastIndexOf('/'));
        const clipPath = `${parentDir}/${clipFileName}`;

        const resolver = getGlobalPathResolver();
        const relativeImagePath = resolver.toRelativePath(imagePath);

        const frameW = img.naturalWidth / config.columns;
        const frameH = img.naturalHeight / config.rows;

        const frames = [];
        for (let i = 0; i < config.frameCount; i++) {
            const col = i % config.columns;
            const row = Math.floor(i / config.columns);
            frames.push({
                texture: relativeImagePath,
                atlasFrame: {
                    x: Math.round(col * frameW),
                    y: Math.round(row * frameH),
                    width: Math.round(frameW),
                    height: Math.round(frameH),
                    pageWidth: img.naturalWidth,
                    pageHeight: img.naturalHeight,
                },
            });
        }

        const clipData = {
            version: '1.0',
            type: 'animation-clip',
            fps: config.fps,
            loop: config.loop,
            frames,
        };

        try {
            const platform = getPlatformAdapter();
            await platform.writeTextFile(clipPath, JSON.stringify(clipData, null, 2));
            state.refresh();
        } catch (err) {
            showErrorToast('Failed to create animation clip', String(err));
            return false;
        }

        return true;
    };

    dialog = new Dialog({
        title: 'Split Spritesheet',
        content,
        width: 520,
        buttons: [
            { label: 'Cancel', role: 'cancel' },
            { label: 'Create', role: 'confirm', primary: true, onClick: () => submit() },
        ],
        closeOnEscape: true,
    });

    await dialog.open();
    URL.revokeObjectURL(url);
}

function createFieldRow(label: string, createInput: () => HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'es-spritesheet-field';

    const lbl = document.createElement('label');
    lbl.className = 'es-spritesheet-label';
    lbl.textContent = label;
    row.appendChild(lbl);

    const input = createInput();
    row.appendChild(input);

    return row;
}

function createNumberInput(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'es-spritesheet-field';

    const lbl = document.createElement('label');
    lbl.className = 'es-spritesheet-label';
    lbl.textContent = label;
    wrapper.appendChild(lbl);

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'es-dialog-input';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener('input', () => {
        const v = parseInt(input.value, 10);
        if (!isNaN(v) && v >= min && v <= parseInt(input.max, 10)) {
            onChange(v);
        }
    });
    wrapper.appendChild(input);

    return wrapper;
}
