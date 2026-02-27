const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyIcons, xappProxyToId, dropTargetSection, calcOverflowPanelPosition } = require('../helpers');

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
