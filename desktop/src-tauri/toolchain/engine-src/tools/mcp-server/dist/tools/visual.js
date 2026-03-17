import { z } from 'zod';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export function registerVisualTools(server, bridge) {
    server.tool('capture_editor', 'Capture a screenshot of the editor (whole window or specific panel)', {
        panel: z.string().optional().describe('Panel to capture: scene|game|inspector|hierarchy|content|output (omit for WebGL view)'),
        maxWidth: z.number().optional().describe('Max width in pixels for resizing'),
    }, async (args) => {
        const params = new URLSearchParams();
        if (args.panel)
            params.set('panel', args.panel);
        if (args.maxWidth != null)
            params.set('maxWidth', String(args.maxWidth));
        const query = params.toString();
        const result = await bridge.get(`/capture${query ? '?' + query : ''}`);
        const dataUrl = result?.data?.dataUrl ?? result?.dataUrl;
        if (!dataUrl || typeof dataUrl !== 'string') {
            return { content: [{ type: 'text', text: 'Failed to capture screenshot' }] };
        }
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const tmpDir = await mkdtemp(join(tmpdir(), 'esengine-capture-'));
        const filePath = join(tmpDir, 'capture.png');
        await writeFile(filePath, Buffer.from(base64, 'base64'));
        return {
            content: [
                { type: 'image', data: base64, mimeType: 'image/png' },
                { type: 'text', text: `Screenshot saved to: ${filePath}` },
            ],
        };
    });
    server.tool('capture_diff', 'Compare two screenshots and show pixel differences', {
        screenshot_a: z.string().describe('File path to first screenshot'),
        screenshot_b: z.string().describe('File path to second screenshot'),
    }, async (args) => {
        try {
            const { default: pixelmatch } = await import('pixelmatch');
            const { PNG } = await import('pngjs');
            const imgA = PNG.sync.read(await readFile(args.screenshot_a));
            const imgB = PNG.sync.read(await readFile(args.screenshot_b));
            const width = Math.min(imgA.width, imgB.width);
            const height = Math.min(imgA.height, imgB.height);
            const diff = new PNG({ width, height });
            const numDiffPixels = pixelmatch(imgA.data, imgB.data, diff.data, width, height, { threshold: 0.1 });
            const totalPixels = width * height;
            const diffPercent = ((numDiffPixels / totalPixels) * 100).toFixed(2);
            const diffBuffer = PNG.sync.write(diff);
            const base64 = diffBuffer.toString('base64');
            const tmpDir = await mkdtemp(join(tmpdir(), 'esengine-diff-'));
            const filePath = join(tmpDir, 'diff.png');
            await writeFile(filePath, diffBuffer);
            return {
                content: [
                    { type: 'image', data: base64, mimeType: 'image/png' },
                    { type: 'text', text: `Diff: ${diffPercent}% (${numDiffPixels}/${totalPixels} pixels). Saved to: ${filePath}` },
                ],
            };
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Diff failed: ${msg}` }] };
        }
    });
    server.tool('get_element_bounds', 'Get the position and size of a DOM element by CSS selector', {
        selector: z.string().describe('CSS selector for the element'),
    }, async (args) => {
        const result = await bridge.get(`/state/element-bounds?selector=${encodeURIComponent(args.selector)}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    });
}
