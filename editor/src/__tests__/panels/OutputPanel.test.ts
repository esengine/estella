import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services', () => ({
    getOutputService: vi.fn(() => ({
        registerOutputHandler: vi.fn(() => () => {}),
    })),
}));

import { OutputPanel } from '../../panels/OutputPanel';

describe('OutputPanel', () => {
    let container: HTMLElement;
    let panel: OutputPanel;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        panel = new OutputPanel(container);
        // Mock clipboard
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    describe('Copy Line with multi-selection', () => {
        it('should copy all selected lines when multiple lines are selected', () => {
            panel.appendOutput('first line', 'stdout');
            panel.appendOutput('second line', 'stdout');
            panel.appendOutput('third line', 'stdout');

            const lines = container.querySelectorAll('.es-output-line');
            expect(lines.length).toBe(3);

            // Simulate native text selection spanning lines 0..2
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            const range = document.createRange();
            range.setStart(lines[0], 0);
            range.setEnd(lines[2], lines[2].childNodes.length);
            selection.addRange(range);

            // Right-click on second line to show context menu
            const contextEvent = new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: 100,
                clientY: 100,
            });
            lines[1].dispatchEvent(contextEvent);

            // Click "Copy Line"
            const menuItem = document.querySelector('[data-action="copy-line"]') as HTMLElement;
            expect(menuItem).not.toBeNull();
            menuItem.click();

            // Should have copied ALL 3 selected lines, not just the right-clicked one
            const clipboardCall = (navigator.clipboard.writeText as any).mock.calls[0][0] as string;
            const copiedLines = clipboardCall.split('\n');
            expect(copiedLines.length).toBe(3);
            expect(copiedLines[0]).toContain('first line');
            expect(copiedLines[1]).toContain('second line');
            expect(copiedLines[2]).toContain('third line');
        });

        it('should copy single line when only one line is selected', () => {
            panel.appendOutput('first line', 'stdout');
            panel.appendOutput('second line', 'stdout');

            const lines = container.querySelectorAll('.es-output-line');

            // No multi-selection - just right-click
            const selection = window.getSelection()!;
            selection.removeAllRanges();

            const contextEvent = new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: 100,
                clientY: 100,
            });
            lines[0].dispatchEvent(contextEvent);

            const menuItem = document.querySelector('[data-action="copy-line"]') as HTMLElement;
            menuItem.click();

            const clipboardCall = (navigator.clipboard.writeText as any).mock.calls[0][0] as string;
            expect(clipboardCall).toContain('first line');
            expect(clipboardCall).not.toContain('second line');
        });
    });
});
