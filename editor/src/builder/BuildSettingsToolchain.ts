import { icons } from '../utils/icons';
import { getEditorContext } from '../context/EditorContext';
import { showProgressToast, dismissToast, showSuccessToast, showErrorToast, updateToast } from '../ui/Toast';
import { renderToolchainRows } from './BuildSettingsRenderer';
import type { BuildSettingsToolchainContext } from './BuildSettingsDialog';

export async function checkToolchainStatus(ctx: BuildSettingsToolchainContext): Promise<void> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        ctx.toolchainStatus = await invoke('get_toolchain_status');
        ctx.toolchainError = false;
    } catch {
        ctx.toolchainStatus = null;
        ctx.toolchainError = true;
    }
    updateToolchainUI(ctx);
}

export function updateToolchainUI(ctx: BuildSettingsToolchainContext): void {
    const section = ctx.overlay?.querySelector('[data-section="toolchain"]');
    if (!section) return;

    const s = ctx.toolchainStatus;
    const header = section.querySelector('.es-build-collapse-header');
    const badgeEl = section.querySelector('.es-build-toolchain-badge');
    const infoEl = section.querySelector('.es-build-toolchain-info');

    if (ctx.toolchainError) {
        if (badgeEl) badgeEl.remove();
        if (infoEl) infoEl.innerHTML = '<span class="es-build-module-desc">Not available in browser mode</span>';
        return;
    }

    if (!s) {
        if (infoEl) infoEl.innerHTML = '<span class="es-build-module-desc">Detecting...</span>';
        return;
    }

    const badgeClass = s.installed ? 'es-ready' : 'es-not-ready';
    const badgeText = s.installed ? 'Ready' : 'Not ready';

    if (badgeEl) {
        badgeEl.className = `es-build-toolchain-badge ${badgeClass}`;
        badgeEl.textContent = badgeText;
    } else if (header) {
        header.insertAdjacentHTML('beforeend', `<span class="es-build-toolchain-badge ${badgeClass}">${badgeText}</span>`);
    }

    if (infoEl) {
        infoEl.innerHTML = renderToolchainRows(s);
    }

    updateBuildButtonState(ctx);
}

export function updateBuildButtonState(ctx: BuildSettingsToolchainContext): void {
    const ready = !!ctx.toolchainStatus?.installed;
    const buildBtn = ctx.overlay?.querySelector('[data-action="build"]') as HTMLButtonElement | null;
    const buildAllBtn = ctx.overlay?.querySelector('[data-action="build-all"]') as HTMLButtonElement | null;
    if (buildBtn) {
        buildBtn.disabled = !ready;
        buildBtn.title = ready ? '' : 'Toolchain not ready';
    }
    if (buildAllBtn) {
        buildAllBtn.disabled = !ready;
        buildAllBtn.title = ready ? 'Build All Configs' : 'Toolchain not ready';
    }
}

export async function handleBrowseEmsdk(ctx: BuildSettingsToolchainContext): Promise<void> {
    const fs = getEditorContext().fs;
    if (!fs) return;

    const selected = await fs.selectDirectory();
    if (!selected) return;

    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_emsdk_path', { path: selected });
        showSuccessToast('emsdk path set');
        await checkToolchainStatus(ctx);
    } catch (err: any) {
        showErrorToast(err.toString());
    }
}

export async function handleInstallEmsdk(ctx: BuildSettingsToolchainContext): Promise<void> {
    const toastId = showProgressToast('Downloading toolchain...');
    let unlisten: (() => void) | undefined;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ stage: string; message: string; progress: number }>('compile-progress', (event) => {
            updateToast(toastId, {
                message: event.payload.message,
                progress: event.payload.progress,
            });
        });
        await invoke('install_emsdk');
        dismissToast(toastId);
        showSuccessToast('Toolchain installed');
        await checkToolchainStatus(ctx);
    } catch (err: any) {
        dismissToast(toastId);
        showErrorToast(`Install failed: ${err}`);
    } finally {
        unlisten?.();
    }
}

export async function handleRepairToolchain(ctx: BuildSettingsToolchainContext): Promise<void> {
    const toastId = showProgressToast('Repairing toolchain...');
    let unlisten: (() => void) | undefined;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ stage: string; message: string; progress: number }>('compile-progress', (event) => {
            updateToast(toastId, {
                message: event.payload.message,
                progress: event.payload.progress,
            });
        });
        await invoke('repair_toolchain');
        dismissToast(toastId);
        showSuccessToast('Toolchain repaired');
        await checkToolchainStatus(ctx);
    } catch (err: any) {
        dismissToast(toastId);
        showErrorToast(`Repair failed: ${err}`);
    } finally {
        unlisten?.();
    }
}
