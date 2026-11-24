// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { expect, it, vi } from 'vitest';
import { VideoAPI } from '../src/video/VideoAPI';
import { WebVideoBackend } from '../src/video/WebVideoBackend';

it('opens a host video only after its package is available and skips a stream stopped while waiting', async () => {
    let open!: () => void;
    const ready = new Promise<void>(resolve => { open = resolve; });
    const files = { prepareFile: vi.fn(() => ready), fetchText: vi.fn(), fetchBinary: vi.fn(), resolveUrl: (path: string) => path };
    const api = new VideoAPI(new WebVideoBackend());
    api.setRefResolver(ref => 'subpackages/intro/' + ref, files);
    const opened: string[] = [];
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) {
        const file = this.getAttribute('src');
        if (file) opened.push(file);
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    try {
        api.play('intro.mp4', { autoplay: false });
        api.stop(api.play('discarded.mp4', { autoplay: false }));
        expect(opened).toEqual([]);
        open();
        await ready;
        expect(opened).toEqual(['subpackages/intro/intro.mp4']);
        expect(files.fetchBinary).not.toHaveBeenCalled();
    } finally {
        api.dispose();
        load.mockRestore();
        pause.mockRestore();
    }
});
