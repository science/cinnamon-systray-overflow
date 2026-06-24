const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIcons, xappProxyToId, dropTargetSection, calcOverflowPanelPosition,
        exceedsDragThreshold, findClosestIconIndex, reorderIcon,
        calcSectionHeight, calcPopupHeight, DND_STATE, dndTransition, resolveVisibility } = require('../helpers');

describe('classifyIcons', () => {
    it('puts all icons in panel when no prefs and default is panel', () => {
        let icons = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        let result = classifyIcons(icons, {}, 'panel', []);
        assert.equal(result.panel.length, 3);
        assert.equal(result.overflow.length, 0);
    });

    it('puts all icons in overflow when no prefs and default is overflow', () => {
        let icons = [{ id: 'a' }, { id: 'b' }];
        let result = classifyIcons(icons, {}, 'overflow', []);
        assert.equal(result.panel.length, 0);
        assert.equal(result.overflow.length, 2);
    });

    it('respects per-icon preferences', () => {
        let icons = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        let prefs = { a: 'overflow', c: 'panel' };
        let result = classifyIcons(icons, prefs, 'panel', []);
        assert.equal(result.panel.length, 2); // b (default) + c (explicit)
        assert.equal(result.overflow.length, 1); // a
        assert.equal(result.overflow[0].id, 'a');
    });

    it('sorts panel icons by order array', () => {
        let icons = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
        let order = ['b', 'c', 'a'];
        let result = classifyIcons(icons, {}, 'panel', order);
        assert.deepEqual(result.panel.map(i => i.id), ['b', 'c', 'a']);
    });

    it('icons not in order array come after ordered icons, sorted alphabetically', () => {
        let icons = [{ id: 'z' }, { id: 'a' }, { id: 'm' }];
        let order = ['m'];
        let result = classifyIcons(icons, {}, 'panel', order);
        assert.deepEqual(result.panel.map(i => i.id), ['m', 'a', 'z']);
    });

    it('sorts panel icons alphabetically when no order provided', () => {
        let icons = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
        let result = classifyIcons(icons, {}, 'panel', []);
        assert.deepEqual(result.panel.map(i => i.id), ['a', 'b', 'c']);
    });

    it('sorts overflow icons alphabetically', () => {
        let icons = [{ id: 'z' }, { id: 'a' }, { id: 'm' }];
        let result = classifyIcons(icons, {}, 'overflow', []);
        assert.deepEqual(result.overflow.map(i => i.id), ['a', 'm', 'z']);
    });

    it('handles empty icon list', () => {
        let result = classifyIcons([], {}, 'panel', []);
        assert.equal(result.panel.length, 0);
        assert.equal(result.overflow.length, 0);
    });

    it('defaults to panel when defaultVis is undefined', () => {
        let icons = [{ id: 'a' }];
        let result = classifyIcons(icons, {}, undefined, []);
        assert.equal(result.panel.length, 1);
    });

    it('preserves extra fields on icon objects', () => {
        let icons = [{ id: 'a', protocol: 'xapp', actor: 'fake' }];
        let result = classifyIcons(icons, {}, 'panel', []);
        assert.equal(result.panel[0].protocol, 'xapp');
        assert.equal(result.panel[0].actor, 'fake');
    });
});

describe('xappProxyToId', () => {
    it('strips org.x.StatusIcon. prefix and lowercases', () => {
        assert.equal(xappProxyToId('org.x.StatusIcon.blueman'), 'blueman');
    });

    it('handles names without the prefix', () => {
        assert.equal(xappProxyToId('slack'), 'slack');
    });

    it('lowercases the result', () => {
        assert.equal(xappProxyToId('org.x.StatusIcon.Blueman'), 'blueman');
    });

    it('handles multi-segment names', () => {
        assert.equal(xappProxyToId('org.x.StatusIcon.nm-applet'), 'nm-applet');
    });

    it('falls back to object path when name is empty', () => {
        assert.equal(xappProxyToId('', '/org/x/StatusIcon/Icon_1'), 'icon_1');
    });

    it('falls back to object path when name is null', () => {
        assert.equal(xappProxyToId(null, '/org/x/StatusIcon/Icon_2'), 'icon_2');
    });

    it('prefers name over object path when both available', () => {
        assert.equal(xappProxyToId('blueman', '/org/x/StatusIcon/Icon_1'), 'blueman');
    });

    it('returns empty string when both are empty', () => {
        assert.equal(xappProxyToId('', ''), '');
    });
});

describe('dropTargetSection', () => {
    it('returns panel when y is above divider', () => {
        assert.equal(dropTargetSection(10, 50), 'panel');
    });

    it('returns overflow when y is below divider', () => {
        assert.equal(dropTargetSection(60, 50), 'overflow');
    });

    it('returns overflow when y equals divider', () => {
        assert.equal(dropTargetSection(50, 50), 'overflow');
    });
});

describe('calcOverflowPanelPosition', () => {
    const monitor = { x: 0, y: 0, width: 1920, height: 1080 };

    it('centers horizontally on applet for bottom panel', () => {
        let alloc = { x1: 900, y1: 1040, x2: 940, y2: 1080 };
        let panelSize = { width: 200, height: 100 };
        let [x, y] = calcOverflowPanelPosition(alloc, panelSize, monitor, 'bottom');
        assert.equal(x, 820); // (900+940)/2 - 200/2 = 920 - 100 = 820
        assert.equal(y, 940); // alloc.y1 - 100
    });

    it('places below applet for top panel', () => {
        let alloc = { x1: 900, y1: 0, x2: 940, y2: 40 };
        let panelSize = { width: 200, height: 100 };
        let [x, y] = calcOverflowPanelPosition(alloc, panelSize, monitor, 'top');
        assert.equal(y, 40); // alloc.y2
    });

    it('clamps to left monitor edge', () => {
        let alloc = { x1: 10, y1: 1040, x2: 50, y2: 1080 };
        let panelSize = { width: 200, height: 100 };
        let [x, y] = calcOverflowPanelPosition(alloc, panelSize, monitor, 'bottom');
        assert.equal(x, 0); // clamped to monitor.x
    });

    it('clamps to right monitor edge', () => {
        let alloc = { x1: 1880, y1: 1040, x2: 1920, y2: 1080 };
        let panelSize = { width: 200, height: 100 };
        let [x, y] = calcOverflowPanelPosition(alloc, panelSize, monitor, 'bottom');
        assert.equal(x, 1720); // 1920 - 200
    });

    it('handles null monitor gracefully', () => {
        let alloc = { x1: 900, y1: 1040, x2: 940, y2: 1080 };
        let panelSize = { width: 200, height: 100 };
        let [x, y] = calcOverflowPanelPosition(alloc, panelSize, null, 'bottom');
        assert.equal(x, 820); // no clamping
    });

    it('handles non-zero monitor offset', () => {
        let mon = { x: 1920, y: 0, width: 1920, height: 1080 };
        let alloc = { x1: 1930, y1: 1040, x2: 1970, y2: 1080 };
        let panelSize = { width: 200, height: 100 };
        let [x, y] = calcOverflowPanelPosition(alloc, panelSize, mon, 'bottom');
        assert.equal(x, 1920); // clamped to monitor.x
    });
});

describe('exceedsDragThreshold', () => {
    it('returns false when movement is below threshold', () => {
        assert.equal(exceedsDragThreshold(100, 100, 105, 103, 8), false);
    });

    it('returns true when movement exceeds threshold', () => {
        assert.equal(exceedsDragThreshold(100, 100, 110, 100, 8), true);
    });

    it('returns true when movement equals threshold', () => {
        assert.equal(exceedsDragThreshold(0, 0, 8, 0, 8), true);
    });

    it('uses Euclidean distance (diagonal)', () => {
        // sqrt(6^2 + 6^2) = sqrt(72) ~= 8.49 > 8
        assert.equal(exceedsDragThreshold(0, 0, 6, 6, 8), true);
        // sqrt(5^2 + 5^2) = sqrt(50) ~= 7.07 < 8
        assert.equal(exceedsDragThreshold(0, 0, 5, 5, 8), false);
    });

    it('defaults to threshold of 8', () => {
        assert.equal(exceedsDragThreshold(0, 0, 7, 0), false);
        assert.equal(exceedsDragThreshold(0, 0, 8, 0), true);
    });

    it('handles negative movement', () => {
        assert.equal(exceedsDragThreshold(100, 100, 92, 100, 8), true);
    });
});

describe('findClosestIconIndex', () => {
    it('returns 0 for empty list', () => {
        assert.equal(findClosestIconIndex([], 50, 50), 0);
    });

    it('finds closest icon by Euclidean distance', () => {
        let bounds = [
            { x: 0, y: 0, width: 30, height: 30 },   // center: 15, 15
            { x: 40, y: 0, width: 30, height: 30 },   // center: 55, 15
            { x: 80, y: 0, width: 30, height: 30 }    // center: 95, 15
        ];
        // Drop at (60, 15) — closest to icon 1 (center 55,15), right of center -> after it
        assert.equal(findClosestIconIndex(bounds, 60, 15), 2);
    });

    it('inserts before icon when drop is left of center', () => {
        let bounds = [
            { x: 0, y: 0, width: 30, height: 30 },   // center: 15, 15
            { x: 40, y: 0, width: 30, height: 30 },   // center: 55, 15
        ];
        // Drop at (50, 15) — closest to icon 1 (center 55,15), left of center -> at index 1
        assert.equal(findClosestIconIndex(bounds, 50, 15), 1);
    });

    it('handles single icon', () => {
        let bounds = [{ x: 0, y: 0, width: 30, height: 30 }];
        // Left of center
        assert.equal(findClosestIconIndex(bounds, 10, 15), 0);
        // Right of center
        assert.equal(findClosestIconIndex(bounds, 20, 15), 1);
    });
});

describe('reorderIcon', () => {
    it('moves icon to beginning', () => {
        assert.deepEqual(reorderIcon(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
    });

    it('moves icon to end', () => {
        assert.deepEqual(reorderIcon(['a', 'b', 'c'], 'a', 2), ['b', 'c', 'a']);
    });

    it('moves icon to middle', () => {
        assert.deepEqual(reorderIcon(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
    });

    it('handles icon not in current order', () => {
        assert.deepEqual(reorderIcon(['a', 'b'], 'c', 1), ['a', 'c', 'b']);
    });

    it('clamps negative index to 0', () => {
        assert.deepEqual(reorderIcon(['a', 'b', 'c'], 'c', -1), ['c', 'a', 'b']);
    });

    it('clamps beyond-end index to end', () => {
        assert.deepEqual(reorderIcon(['a', 'b'], 'a', 99), ['b', 'a']);
    });

    it('handles empty order', () => {
        assert.deepEqual(reorderIcon([], 'a', 0), ['a']);
    });

    it('no-op when icon is already at target position', () => {
        assert.deepEqual(reorderIcon(['a', 'b', 'c'], 'b', 1), ['a', 'b', 'c']);
    });
});

describe('DND_STATE', () => {
    it('exports IDLE, PRESSED, DRAGGING states', () => {
        assert.equal(DND_STATE.IDLE, 'idle');
        assert.equal(DND_STATE.PRESSED, 'pressed');
        assert.equal(DND_STATE.DRAGGING, 'dragging');
    });
});

describe('dndTransition', () => {
    it('IDLE + press → PRESSED', () => {
        let result = dndTransition(DND_STATE.IDLE, 'press');
        assert.equal(result.valid, true);
        assert.equal(result.state, DND_STATE.PRESSED);
    });

    it('PRESSED + threshold-exceeded → DRAGGING', () => {
        let result = dndTransition(DND_STATE.PRESSED, 'threshold-exceeded');
        assert.equal(result.valid, true);
        assert.equal(result.state, DND_STATE.DRAGGING);
    });

    it('PRESSED + release → IDLE (click)', () => {
        let result = dndTransition(DND_STATE.PRESSED, 'release');
        assert.equal(result.valid, true);
        assert.equal(result.state, DND_STATE.IDLE);
        assert.equal(result.action, 'click');
    });

    it('DRAGGING + release → IDLE (drop)', () => {
        let result = dndTransition(DND_STATE.DRAGGING, 'release');
        assert.equal(result.valid, true);
        assert.equal(result.state, DND_STATE.IDLE);
        assert.equal(result.action, 'drop');
    });

    it('any state + close → IDLE (reset)', () => {
        for (let s of [DND_STATE.IDLE, DND_STATE.PRESSED, DND_STATE.DRAGGING]) {
            let result = dndTransition(s, 'close');
            assert.equal(result.valid, true, `close from ${s} should be valid`);
            assert.equal(result.state, DND_STATE.IDLE, `close from ${s} should go to IDLE`);
            assert.equal(result.action, 'reset', `close from ${s} should produce reset`);
        }
    });

    it('returns invalid for IDLE + release', () => {
        let result = dndTransition(DND_STATE.IDLE, 'release');
        assert.equal(result.valid, false);
    });

    it('returns invalid for IDLE + threshold-exceeded', () => {
        let result = dndTransition(DND_STATE.IDLE, 'threshold-exceeded');
        assert.equal(result.valid, false);
    });

    it('returns invalid for DRAGGING + press', () => {
        let result = dndTransition(DND_STATE.DRAGGING, 'press');
        assert.equal(result.valid, false);
    });

    it('returns invalid for unknown action', () => {
        let result = dndTransition(DND_STATE.IDLE, 'fly');
        assert.equal(result.valid, false);
    });
});

describe('calcSectionHeight', () => {
    it('returns 0 for no children', () => {
        assert.equal(calcSectionHeight(0, 4, 32, 4), 0);
    });

    it('returns 0 for negative children', () => {
        assert.equal(calcSectionHeight(-1, 4, 32, 4), 0);
    });

    it('computes single row correctly', () => {
        // 3 icons, 4 per row → 1 row → 1*32 + 0*4 = 32
        assert.equal(calcSectionHeight(3, 4, 32, 4), 32);
    });

    it('computes exact full row correctly', () => {
        // 4 icons, 4 per row → 1 row → 32
        assert.equal(calcSectionHeight(4, 4, 32, 4), 32);
    });

    it('computes multiple rows correctly', () => {
        // 5 icons, 4 per row → 2 rows → 2*32 + 1*4 = 68
        assert.equal(calcSectionHeight(5, 4, 32, 4), 68);
    });

    it('computes three rows correctly', () => {
        // 9 icons, 4 per row → 3 rows → 3*32 + 2*4 = 104
        assert.equal(calcSectionHeight(9, 4, 32, 4), 104);
    });

    it('works with real icon_size + padding values', () => {
        // icon_size=24, cell=24+8=32, spacing=4, 6 icons, 4 per row
        // 2 rows → 2*32 + 1*4 = 68
        assert.equal(calcSectionHeight(6, 4, 32, 4), 68);
    });
});

describe('calcPopupHeight', () => {
    it('computes 3-section popup height (196 = 16 + 54 + 96 + 30)', () => {
        // 3 sections each 32px, 3 labels, label=18, spacing=6, padding=16
        // 16 + 3*18 + 32+32+32 + (6-1)*6 = 16 + 54 + 96 + 30 = 196
        assert.equal(calcPopupHeight([32, 32, 32], 3, 18, 6, 16), 196);
    });

    it('computes 2-section popup height (inactive hidden)', () => {
        // 2 sections each 32px, 2 labels
        // 16 + 2*18 + 32+32 + (4-1)*6 = 16 + 36 + 64 + 18 = 134
        assert.equal(calcPopupHeight([32, 32], 2, 18, 6, 16), 134);
    });

    it('computes multi-row overflow section', () => {
        // sections: 32, 68, 32 — overflow has 2 rows
        // 16 + 3*18 + 32+68+32 + (6-1)*6 = 16 + 54 + 132 + 30 = 232
        assert.equal(calcPopupHeight([32, 68, 32], 3, 18, 6, 16), 232);
    });

    it('returns just padding for empty popup', () => {
        assert.equal(calcPopupHeight([], 0, 18, 6, 16), 16);
    });
});

describe('resolveVisibility', () => {
    it('returns false when proxy is not visible', () => {
        assert.equal(resolveVisibility(false, 'blueman', { blueman: 'panel' }, 'panel'), false);
    });

    it('returns true when proxy is visible and classified as panel', () => {
        assert.equal(resolveVisibility(true, 'blueman', { blueman: 'panel' }, 'panel'), true);
    });

    it('returns false when proxy is visible but classified as overflow', () => {
        assert.equal(resolveVisibility(true, 'blueman', { blueman: 'overflow' }, 'panel'), false);
    });

    it('falls back to defaultVis when iconId not in prefs', () => {
        assert.equal(resolveVisibility(true, 'unknown', {}, 'panel'), true);
        assert.equal(resolveVisibility(true, 'unknown', {}, 'overflow'), false);
    });

    it('falls back to panel when defaultVis is undefined', () => {
        assert.equal(resolveVisibility(true, 'test', {}, undefined), true);
    });

    it('handles null iconId (not yet registered)', () => {
        assert.equal(resolveVisibility(true, null, { blueman: 'overflow' }, 'panel'), true);
    });

    it('handles null prefs', () => {
        assert.equal(resolveVisibility(true, 'test', null, 'panel'), true);
    });

    it('returns false when proxy not visible even if classified as panel', () => {
        assert.equal(resolveVisibility(false, 'test', {}, 'panel'), false);
    });
});
