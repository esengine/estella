import { icons } from '../../utils/icons';
import { getNativeFS, getFileName, getFileExtension, formatFileSize, formatDate, renderError } from './InspectorHelpers';

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}.${ms}` : `${s}.${ms}s`;
}

export async function renderAudioInspector(container: HTMLElement, path: string): Promise<void> {
    const fs = getNativeFS();
    if (!fs) {
        renderError(container, 'File system not available');
        return;
    }

    const previewSection = document.createElement('div');
    previewSection.className = 'es-asset-preview-section';
    previewSection.innerHTML = '<div class="es-asset-preview-loading">Loading...</div>';
    container.appendChild(previewSection);

    try {
        const data = await fs.readBinaryFile(path);
        if (!data) {
            previewSection.innerHTML = '<div class="es-asset-preview-error">Failed to load audio</div>';
            return;
        }

        const ext = getFileExtension(path);
        const mimeMap: Record<string, string> = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.aac': 'audio/aac',
            '.flac': 'audio/flac',
            '.webm': 'audio/webm',
        };
        const mimeType = mimeMap[ext] ?? 'audio/mpeg';
        const blob = new Blob([new Uint8Array(data).buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);

        previewSection.innerHTML = '';

        const playerContainer = document.createElement('div');
        playerContainer.style.cssText = 'padding: 12px; display: flex; flex-direction: column; gap: 8px;';

        const controlsRow = document.createElement('div');
        controlsRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const playBtn = document.createElement('button');
        playBtn.style.cssText = `
            width: 28px; height: 28px; border: none; border-radius: 4px;
            background: var(--es-accent, #4a9eff); color: #fff; cursor: pointer;
            display: flex; align-items: center; justify-content: center; flex-shrink: 0;
            font-size: 12px; padding: 0;
        `;
        playBtn.innerHTML = icons.play(14);

        const timeLabel = document.createElement('span');
        timeLabel.style.cssText = 'font-size: 11px; color: var(--es-text-secondary); min-width: 70px; text-align: right; flex-shrink: 0;';
        timeLabel.textContent = '0.0s / --';

        const progressBar = document.createElement('div');
        progressBar.style.cssText = `
            flex: 1; height: 4px; background: var(--es-bg-tertiary, #333);
            border-radius: 2px; cursor: pointer; position: relative;
        `;

        const progressFill = document.createElement('div');
        progressFill.style.cssText = 'height: 100%; background: var(--es-accent, #4a9eff); border-radius: 2px; width: 0%; transition: width 0.05s linear;';
        progressBar.appendChild(progressFill);

        controlsRow.appendChild(playBtn);
        controlsRow.appendChild(progressBar);
        controlsRow.appendChild(timeLabel);
        playerContainer.appendChild(controlsRow);
        previewSection.appendChild(playerContainer);

        const audio = new Audio();
        audio.src = url;
        let animId = 0;
        let disposed = false;

        const updateProgress = () => {
            if (disposed) return;
            const cur = audio.currentTime;
            const dur = audio.duration || 0;
            timeLabel.textContent = `${formatDuration(cur)} / ${formatDuration(dur)}`;
            progressFill.style.width = dur > 0 ? `${(cur / dur) * 100}%` : '0%';
            if (!audio.paused) {
                animId = requestAnimationFrame(updateProgress);
            }
        };

        const setPlaying = (playing: boolean) => {
            playBtn.innerHTML = playing ? icons.pause(14) : icons.play(14);
        };

        playBtn.addEventListener('click', () => {
            if (audio.paused) {
                audio.play();
            } else {
                audio.pause();
            }
        });

        audio.addEventListener('play', () => {
            setPlaying(true);
            animId = requestAnimationFrame(updateProgress);
        });

        audio.addEventListener('pause', () => {
            setPlaying(false);
            cancelAnimationFrame(animId);
            updateProgress();
        });

        audio.addEventListener('ended', () => {
            setPlaying(false);
            cancelAnimationFrame(animId);
            progressFill.style.width = '0%';
            audio.currentTime = 0;
            updateProgress();
        });

        audio.addEventListener('loadedmetadata', () => {
            updateProgress();
        });

        progressBar.addEventListener('click', (e: MouseEvent) => {
            const rect = progressBar.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (audio.duration) {
                audio.currentTime = ratio * audio.duration;
                updateProgress();
            }
        });

        const cleanup = () => {
            disposed = true;
            cancelAnimationFrame(animId);
            audio.pause();
            audio.src = '';
            URL.revokeObjectURL(url);
        };

        const observer = new MutationObserver(() => {
            if (!document.contains(previewSection)) {
                cleanup();
                observer.disconnect();
            }
        });
        observer.observe(container.parentElement ?? document.body, { childList: true, subtree: true });

        await renderAudioMetadata(container, path, audio, ext);
    } catch (err) {
        console.error('Failed to load audio:', err);
        previewSection.innerHTML = '<div class="es-asset-preview-error">Failed to load audio</div>';
    }
}

async function renderAudioMetadata(
    container: HTMLElement,
    path: string,
    audio: HTMLAudioElement,
    ext: string,
): Promise<void> {
    const fs = getNativeFS();
    const stats = fs ? await fs.getFileStats(path) : null;

    const duration = await new Promise<number>((resolve) => {
        if (audio.duration && isFinite(audio.duration)) {
            resolve(audio.duration);
            return;
        }
        const onLoaded = () => {
            audio.removeEventListener('loadedmetadata', onLoaded);
            resolve(audio.duration || 0);
        };
        audio.addEventListener('loadedmetadata', onLoaded);
    });

    const section = document.createElement('div');
    section.className = 'es-component-section es-collapsible es-expanded';
    section.innerHTML = `
        <div class="es-component-header es-collapsible-header">
            <span class="es-collapse-icon">${icons.chevronDown(12)}</span>
            <span class="es-component-icon">${icons.settings(14)}</span>
            <span class="es-component-title">Properties</span>
        </div>
        <div class="es-component-properties es-collapsible-content">
            <div class="es-property-row">
                <label class="es-property-label">Duration</label>
                <div class="es-property-value">${formatDuration(duration)}</div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">Format</label>
                <div class="es-property-value">${ext.substring(1).toUpperCase() || 'Unknown'}</div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">File Size</label>
                <div class="es-property-value">${stats ? formatFileSize(stats.size) : 'Unknown'}</div>
            </div>
            <div class="es-property-row">
                <label class="es-property-label">Modified</label>
                <div class="es-property-value">${stats ? formatDate(stats.modified) : 'Unknown'}</div>
            </div>
        </div>
    `;

    const header = section.querySelector('.es-collapsible-header');
    header?.addEventListener('click', () => {
        section.classList.toggle('es-expanded');
    });

    container.appendChild(section);
}
