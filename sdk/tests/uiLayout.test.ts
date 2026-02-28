import { describe, it, expect } from 'vitest';
import { computeUIRectLayout } from '../src/ui/uiLayout';
import type { LayoutRect, LayoutResult } from '../src/ui/uiLayout';

const PARENT: LayoutRect = { left: 0, bottom: 0, right: 800, top: 600 };

function noOffset() {
    return { x: 0, y: 0 };
}

describe('computeUIRectLayout', () => {
    describe('point anchor (anchorMin === anchorMax)', () => {
        it('centers element with default pivot at center anchor', () => {
            const r = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 100, y: 80 },
                PARENT,
            );
            expect(r.width).toBe(100);
            expect(r.height).toBe(80);
            expect(r.originX).toBe(400);
            expect(r.originY).toBe(300);
            expect(r.rect.left).toBe(350);
            expect(r.rect.right).toBe(450);
            expect(r.rect.bottom).toBe(260);
            expect(r.rect.top).toBe(340);
        });

        it('positions at top-left with anchor (0, 1)', () => {
            const r = computeUIRectLayout(
                { x: 0, y: 1 },
                { x: 0, y: 1 },
                noOffset(),
                noOffset(),
                { x: 100, y: 80 },
                PARENT,
            );
            // aLeft=0, aBottom=600
            // myLeft = 0 + 0 - 100*0.5 = -50, myRight = 50
            // myBottom = 600 + 0 - 80*0.5 = 560, myTop = 640
            expect(r.originX).toBe(0);
            expect(r.originY).toBe(600);
            expect(r.rect.left).toBe(-50);
            expect(r.rect.right).toBe(50);
            expect(r.rect.bottom).toBe(560);
            expect(r.rect.top).toBe(640);
        });

        it('positions at bottom-right with anchor (1, 0)', () => {
            const r = computeUIRectLayout(
                { x: 1, y: 0 },
                { x: 1, y: 0 },
                noOffset(),
                noOffset(),
                { x: 100, y: 80 },
                PARENT,
            );
            // aLeft=800, aBottom=0
            // myLeft = 800 - 50 = 750, myRight = 850
            // myBottom = 0 - 40 = -40, myTop = 40
            expect(r.originX).toBe(800);
            expect(r.originY).toBe(0);
            expect(r.rect.left).toBe(750);
            expect(r.rect.right).toBe(850);
        });

        it('shifts position with offset', () => {
            const r = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                { x: 20, y: -10 },
                noOffset(),
                { x: 100, y: 80 },
                PARENT,
            );
            // aLeft=400, aBottom=300
            // myLeft = 400 + 20 - 50 = 370, myRight = 470
            // myBottom = 300 + (-10) - 40 = 250, myTop = 330
            expect(r.rect.left).toBe(370);
            expect(r.rect.right).toBe(470);
            expect(r.rect.bottom).toBe(250);
            expect(r.rect.top).toBe(330);
            expect(r.originX).toBe(420);
            expect(r.originY).toBe(290);
        });

        it('places origin at bottom-left with pivot (0, 0)', () => {
            const r = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 100, y: 80 },
                PARENT,
                { x: 0, y: 0 },
            );
            // myLeft = 400 + 0 - 100*0 = 400, myRight = 500
            // myBottom = 300 + 0 - 80*0 = 300, myTop = 380
            expect(r.rect.left).toBe(400);
            expect(r.rect.right).toBe(500);
            expect(r.rect.bottom).toBe(300);
            expect(r.rect.top).toBe(380);
            expect(r.originX).toBe(400);
            expect(r.originY).toBe(300);
        });

        it('places origin at top-right with pivot (1, 1)', () => {
            const r = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 100, y: 80 },
                PARENT,
                { x: 1, y: 1 },
            );
            // myLeft = 400 - 100 = 300, myRight = 400
            // myBottom = 300 - 80 = 220, myTop = 300
            expect(r.rect.left).toBe(300);
            expect(r.rect.right).toBe(400);
            expect(r.originX).toBe(400);
            expect(r.originY).toBe(300);
        });

        it('allows element to extend beyond parent with large size', () => {
            const r = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 1600, y: 1200 },
                PARENT,
            );
            expect(r.width).toBe(1600);
            expect(r.height).toBe(1200);
            expect(r.rect.left).toBe(-400);
            expect(r.rect.right).toBe(1200);
        });

        it('produces zero-size rect with size (0, 0)', () => {
            const r = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
            );
            expect(r.width).toBe(0);
            expect(r.height).toBe(0);
            expect(r.originX).toBe(400);
            expect(r.originY).toBe(300);
            expect(r.rect.left).toBe(400);
            expect(r.rect.right).toBe(400);
        });
    });

    describe('stretch anchor (anchorMin !== anchorMax)', () => {
        it('fills parent exactly with full stretch and zero offsets', () => {
            const r = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
            );
            expect(r.width).toBe(800);
            expect(r.height).toBe(600);
            expect(r.rect.left).toBe(0);
            expect(r.rect.right).toBe(800);
            expect(r.rect.bottom).toBe(0);
            expect(r.rect.top).toBe(600);
            expect(r.originX).toBe(400);
            expect(r.originY).toBe(300);
        });

        it('insets from parent edges with positive offsets', () => {
            const r = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: 10, y: 20 },
                { x: -10, y: -20 },
                { x: 0, y: 0 },
                PARENT,
            );
            // myLeft = 0 + 10 = 10, myRight = 800 + (-10) = 790
            // myBottom = 0 + 20 = 20, myTop = 600 + (-20) = 580
            expect(r.rect.left).toBe(10);
            expect(r.rect.right).toBe(790);
            expect(r.rect.bottom).toBe(20);
            expect(r.rect.top).toBe(580);
            expect(r.width).toBe(780);
            expect(r.height).toBe(560);
        });

        it('extends beyond parent with negative offsetMin and positive offsetMax', () => {
            const r = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: -10, y: -10 },
                { x: 10, y: 10 },
                { x: 0, y: 0 },
                PARENT,
            );
            expect(r.rect.left).toBe(-10);
            expect(r.rect.right).toBe(810);
            expect(r.rect.bottom).toBe(-10);
            expect(r.rect.top).toBe(610);
            expect(r.width).toBe(820);
            expect(r.height).toBe(620);
        });

        it('stretches horizontally only when Y anchors match', () => {
            const r = computeUIRectLayout(
                { x: 0, y: 0.5 },
                { x: 1, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 0, y: 80 },
                PARENT,
            );
            // X: stretch => myLeft=0, myRight=800
            // Y: point => myBottom = 300 - 40 = 260, myTop = 340
            expect(r.width).toBe(800);
            expect(r.height).toBe(80);
            expect(r.rect.left).toBe(0);
            expect(r.rect.right).toBe(800);
            expect(r.rect.bottom).toBe(260);
            expect(r.rect.top).toBe(340);
        });

        it('stretches vertically only when X anchors match', () => {
            const r = computeUIRectLayout(
                { x: 0.5, y: 0 },
                { x: 0.5, y: 1 },
                noOffset(),
                noOffset(),
                { x: 100, y: 0 },
                PARENT,
            );
            // X: point => myLeft = 400 - 50 = 350, myRight = 450
            // Y: stretch => myBottom=0, myTop=600
            expect(r.width).toBe(100);
            expect(r.height).toBe(600);
            expect(r.rect.left).toBe(350);
            expect(r.rect.right).toBe(450);
            expect(r.rect.bottom).toBe(0);
            expect(r.rect.top).toBe(600);
        });

        it('computes partial stretch proportionally', () => {
            const r = computeUIRectLayout(
                { x: 0.25, y: 0.25 },
                { x: 0.75, y: 0.75 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
            );
            // aLeft=200, aRight=600, aBottom=150, aTop=450
            expect(r.rect.left).toBe(200);
            expect(r.rect.right).toBe(600);
            expect(r.rect.bottom).toBe(150);
            expect(r.rect.top).toBe(450);
            expect(r.width).toBe(400);
            expect(r.height).toBe(300);
            expect(r.originX).toBe(400);
            expect(r.originY).toBe(300);
        });

        it('applies margins via offsets with stretch', () => {
            const r = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: 50, y: 30 },
                { x: -50, y: -30 },
                { x: 0, y: 0 },
                PARENT,
            );
            expect(r.rect.left).toBe(50);
            expect(r.rect.right).toBe(750);
            expect(r.rect.bottom).toBe(30);
            expect(r.rect.top).toBe(570);
            expect(r.width).toBe(700);
            expect(r.height).toBe(540);
        });

        it('uses pivot for origin calculation in stretch mode', () => {
            const r = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
                { x: 0, y: 0 },
            );
            expect(r.originX).toBe(0);
            expect(r.originY).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('returns zero-size result for zero-size parent', () => {
            const zeroParent: LayoutRect = { left: 0, bottom: 0, right: 0, top: 0 };
            const r = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                zeroParent,
            );
            expect(r.width).toBe(0);
            expect(r.height).toBe(0);
            expect(r.originX).toBe(0);
            expect(r.originY).toBe(0);
        });

        it('clamps negative width/height to zero', () => {
            // Stretch with offsets that invert left/right
            const r = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: 500, y: 400 },
                { x: -500, y: -400 },
                { x: 0, y: 0 },
                PARENT,
            );
            // myLeft = 500, myRight = 800-500 = 300 => inverted
            // myBottom = 400, myTop = 600-400 = 200 => inverted
            expect(r.width).toBe(0);
            expect(r.height).toBe(0);
        });

        it('handles inverted anchors (anchorMin > anchorMax)', () => {
            const r = computeUIRectLayout(
                { x: 0.75, y: 0.75 },
                { x: 0.25, y: 0.25 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
            );
            // aLeft = 600, aRight = 200 => myLeft=600, myRight=200 => width clamped to 0
            expect(r.width).toBe(0);
            expect(r.height).toBe(0);
        });

        it('handles pivot at extremes (0 and 1) in point mode', () => {
            const r0 = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 200, y: 100 },
                PARENT,
                { x: 0, y: 1 },
            );
            // X: myLeft = 400 - 200*0 = 400, myRight = 600
            // Y: myBottom = 300 - 100*1 = 200, myTop = 300
            expect(r0.rect.left).toBe(400);
            expect(r0.rect.right).toBe(600);
            expect(r0.rect.bottom).toBe(200);
            expect(r0.rect.top).toBe(300);
            expect(r0.originX).toBe(400);
            expect(r0.originY).toBe(300);
        });

        it('works with parent rect not starting at origin', () => {
            const offsetParent: LayoutRect = { left: 100, bottom: 50, right: 500, top: 350 };
            const r = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 100, y: 80 },
                offsetParent,
            );
            // parentW = 400, parentH = 300
            // aLeft = 100 + 0.5*400 = 300
            // aBottom = 50 + 0.5*300 = 200
            // myLeft = 300 - 50 = 250, myRight = 350
            // myBottom = 200 - 40 = 160, myTop = 240
            expect(r.originX).toBe(300);
            expect(r.originY).toBe(200);
            expect(r.rect.left).toBe(250);
            expect(r.rect.right).toBe(350);
            expect(r.rect.bottom).toBe(160);
            expect(r.rect.top).toBe(240);
        });
    });

    describe('nested layout', () => {
        it('child fills parent when using full stretch', () => {
            const parent = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
            );
            const child = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                parent.rect,
            );
            expect(child.rect).toEqual(parent.rect);
            expect(child.width).toBe(parent.width);
            expect(child.height).toBe(parent.height);
        });

        it('centers child at half parent size', () => {
            const parent = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
            );
            const child = computeUIRectLayout(
                { x: 0.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
                noOffset(),
                noOffset(),
                { x: 400, y: 300 },
                parent.rect,
            );
            expect(child.width).toBe(400);
            expect(child.height).toBe(300);
            expect(child.originX).toBe(400);
            expect(child.originY).toBe(300);
            expect(child.rect.left).toBe(200);
            expect(child.rect.right).toBe(600);
            expect(child.rect.bottom).toBe(150);
            expect(child.rect.top).toBe(450);
        });

        it('chains layout results through multiple nesting levels', () => {
            const level1 = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: 20, y: 20 },
                { x: -20, y: -20 },
                { x: 0, y: 0 },
                PARENT,
            );
            // level1: left=20, right=780, bottom=20, top=580 => 760x560
            expect(level1.width).toBe(760);
            expect(level1.height).toBe(560);

            const level2 = computeUIRectLayout(
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: 10, y: 10 },
                { x: -10, y: -10 },
                { x: 0, y: 0 },
                level1.rect,
            );
            // level2: left=30, right=770, bottom=30, top=570 => 740x540
            expect(level2.width).toBe(740);
            expect(level2.height).toBe(540);
            expect(level2.rect.left).toBe(30);
            expect(level2.rect.right).toBe(770);
        });

        it('produces consistent results across three nesting levels', () => {
            const l1 = computeUIRectLayout(
                { x: 0.25, y: 0.25 },
                { x: 0.75, y: 0.75 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                PARENT,
            );
            // l1: 200..600 x 150..450 => 400x300
            const l2 = computeUIRectLayout(
                { x: 0.25, y: 0.25 },
                { x: 0.75, y: 0.75 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                l1.rect,
            );
            // l2 parentW=400, parentH=300
            // aLeft=200+0.25*400=300, aRight=200+0.75*400=500
            // aBottom=150+0.25*300=225, aTop=150+0.75*300=375
            // => 300..500 x 225..375 => 200x150
            expect(l2.width).toBe(200);
            expect(l2.height).toBe(150);

            const l3 = computeUIRectLayout(
                { x: 0.25, y: 0.25 },
                { x: 0.75, y: 0.75 },
                noOffset(),
                noOffset(),
                { x: 0, y: 0 },
                l2.rect,
            );
            // l3 parentW=200, parentH=150
            // => 100x75
            expect(l3.width).toBe(100);
            expect(l3.height).toBe(75);
            expect(l3.originX).toBe(400);
            expect(l3.originY).toBe(300);
        });
    });
});
