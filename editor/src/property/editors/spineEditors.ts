import {
    type PropertyEditorContext,
    type PropertyEditorInstance,
} from '../PropertyEditor';
import { getEditorStore } from '../../store/EditorStore';
import { getSpineService } from '../../services';
import { getAssetTypeEntry } from 'esengine';
import {
    getNativeFS,
    getProjectDir,
    resolveDisplayName,
    resolveToPath,
    checkAssetMissing,
    BROWSE_ICON,
    CLEAR_ICON,
} from './assetEditors';
import { showAssetPicker } from '../../ui/asset-picker';

interface SpineSkeletonData {
    animations?: Record<string, unknown>;
    skins?: Array<{ name: string }> | Record<string, unknown>;
}

async function loadSpineSkeletonData(skeletonPath: string, atlasPath?: string): Promise<SpineSkeletonData | null> {
    if (!skeletonPath) return null;

    const spineService = getSpineService();
    const store = getEditorStore();
    {
        const entityId = store.selectedEntity as number | null;
        if (entityId !== null) {
            const info = spineService.getSpineSkeletonInfo(entityId);
            if (info) {
                const animRecord: Record<string, unknown> = {};
                for (const name of info.animations) {
                    animRecord[name] = {};
                }
                return {
                    animations: animRecord,
                    skins: info.skins.map(name => ({ name })),
                };
            }
        }
    }

    if (getAssetTypeEntry(skeletonPath)?.contentType === 'binary') {
        return null;
    }

    const projectDir = getProjectDir();
    const fs = getNativeFS();
    if (!projectDir || !fs) return null;

    const jsonPath = `${projectDir}/${skeletonPath}`;
    try {
        const content = await fs.readFile(jsonPath);
        if (!content) return null;
        return JSON.parse(content) as SpineSkeletonData;
    } catch {
        return null;
    }
}

function getAnimationNames(data: SpineSkeletonData): string[] {
    if (!data.animations) return [];
    return Object.keys(data.animations);
}

function getSkinNames(data: SpineSkeletonData): string[] {
    if (!data.skins) return [];
    if (Array.isArray(data.skins)) {
        return data.skins.map(s => s.name);
    }
    return Object.keys(data.skins);
}

export function createSpineFileEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, meta, onChange } = ctx;
    const fileFilter = meta.fileFilter ?? ['.json', '.skel'];

    const wrapper = document.createElement('div');
    wrapper.className = 'es-file-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'es-input es-input-file';
    input.value = resolveDisplayName(String(value ?? ''));
    input.placeholder = 'None';
    checkAssetMissing(String(value ?? ''), input);

    const browseBtn = document.createElement('button');
    browseBtn.className = 'es-btn es-btn-icon es-btn-browse';
    browseBtn.title = 'Browse';
    browseBtn.innerHTML = BROWSE_ICON;

    const clearBtn = document.createElement('button');
    clearBtn.className = 'es-btn es-btn-icon es-btn-clear';
    clearBtn.title = 'Clear';
    clearBtn.innerHTML = CLEAR_ICON;

    input.addEventListener('change', () => {
        onChange(input.value || '');
    });

    browseBtn.addEventListener('click', async () => {
        const extensions = fileFilter.map((f: string) => f.replace('.', ''));
        const result = await showAssetPicker({ title: 'Select Spine File', extensions });
        if (result) {
            input.value = result.relativePath;
            onChange(result.uuid ?? result.relativePath);
        }
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        onChange('');
    });

    wrapper.appendChild(input);
    wrapper.appendChild(browseBtn);
    wrapper.appendChild(clearBtn);
    container.appendChild(wrapper);

    return {
        update(v: unknown) {
            const ref = String(v ?? '');
            input.value = resolveDisplayName(ref);
            checkAssetMissing(ref, input);
        },
        dispose() {
            wrapper.remove();
        },
    };
}

export function createSpineAnimationEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange, getComponentValue, getCurrentValue } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-spine-animation-editor';

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'es-btn es-btn-icon es-btn-refresh';
    refreshBtn.title = 'Refresh animations';
    refreshBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`;

    let currentAnimations: string[] = [];

    const liveValue = () => String(getCurrentValue?.() ?? value ?? '');

    const updateOptions = (animations: string[], currentValue: string) => {
        select.innerHTML = '';

        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = '(None)';
        select.appendChild(emptyOption);

        for (const anim of animations) {
            const option = document.createElement('option');
            option.value = anim;
            option.textContent = anim;
            if (anim === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        currentAnimations = animations;
    };

    const loadAnimations = async () => {
        const skeletonRef = getComponentValue?.('skeletonPath') as string;
        const skeletonPath = skeletonRef ? resolveToPath(skeletonRef) : '';
        if (!skeletonPath) {
            updateOptions([], liveValue());
            return;
        }

        const atlasRef = getComponentValue?.('atlasPath') as string;
        const atlasPath = atlasRef ? resolveToPath(atlasRef) : undefined;
        const data = await loadSpineSkeletonData(skeletonPath, atlasPath);
        if (data) {
            const animations = getAnimationNames(data);
            updateOptions(animations, liveValue());
        } else {
            updateOptions([], liveValue());
        }
    };

    const unsubSpineReady = getSpineService().onSpineInstanceReady((entityId: number) => {
        const selected = getEditorStore().selectedEntity as number | null;
        if (selected === entityId) {
            loadAnimations();
        }
    });

    select.addEventListener('change', () => {
        onChange(select.value);
    });

    refreshBtn.addEventListener('click', () => {
        loadAnimations();
    });

    wrapper.appendChild(select);
    wrapper.appendChild(refreshBtn);
    container.appendChild(wrapper);

    loadAnimations();

    return {
        update(v: unknown) {
            const newValue = String(v ?? '');
            if (currentAnimations.includes(newValue) || newValue === '') {
                select.value = newValue;
            } else {
                loadAnimations();
            }
        },
        dispose() {
            unsubSpineReady?.();
            wrapper.remove();
        },
    };
}

export function createSpineSkinEditor(
    container: HTMLElement,
    ctx: PropertyEditorContext
): PropertyEditorInstance {
    const { value, onChange, getComponentValue, getCurrentValue } = ctx;

    const wrapper = document.createElement('div');
    wrapper.className = 'es-spine-skin-editor';

    const select = document.createElement('select');
    select.className = 'es-input es-input-select';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'es-btn es-btn-icon es-btn-refresh';
    refreshBtn.title = 'Refresh skins';
    refreshBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"></path></svg>`;

    let currentSkins: string[] = [];

    const liveValue = () => String(getCurrentValue?.() ?? value ?? 'default');

    const updateOptions = (skins: string[], currentValue: string) => {
        select.innerHTML = '';

        for (const skin of skins) {
            const option = document.createElement('option');
            option.value = skin;
            option.textContent = skin;
            if (skin === currentValue) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        if (skins.length === 0) {
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.textContent = 'default';
            select.appendChild(defaultOption);
        }

        currentSkins = skins;
    };

    const loadSkins = async () => {
        const skeletonRef = getComponentValue?.('skeletonPath') as string;
        const skeletonPath = skeletonRef ? resolveToPath(skeletonRef) : '';
        if (!skeletonPath) {
            updateOptions(['default'], liveValue());
            return;
        }

        const atlasRef = getComponentValue?.('atlasPath') as string;
        const atlasPath = atlasRef ? resolveToPath(atlasRef) : undefined;
        const data = await loadSpineSkeletonData(skeletonPath, atlasPath);
        if (data) {
            const skins = getSkinNames(data);
            updateOptions(skins.length > 0 ? skins : ['default'], liveValue());
        } else {
            updateOptions(['default'], liveValue());
        }
    };

    const unsubSpineReady = getSpineService().onSpineInstanceReady((entityId: number) => {
        const selected = getEditorStore().selectedEntity as number | null;
        if (selected === entityId) {
            loadSkins();
        }
    });

    select.addEventListener('change', () => {
        onChange(select.value);
    });

    refreshBtn.addEventListener('click', () => {
        loadSkins();
    });

    wrapper.appendChild(select);
    wrapper.appendChild(refreshBtn);
    container.appendChild(wrapper);

    loadSkins();

    return {
        update(v: unknown) {
            const newValue = String(v ?? 'default');
            if (currentSkins.includes(newValue)) {
                select.value = newValue;
            } else {
                loadSkins();
            }
        },
        dispose() {
            unsubSpineReady?.();
            wrapper.remove();
        },
    };
}
