const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dndSrc = fs.readFileSync(path.join(__dirname, '..', 'dnd-handler.js'), 'utf8');

describe('dnd-handler.js structure', () => {
    it('has DndHandler class', () => {
        assert.ok(dndSrc.includes('class DndHandler'), 'missing DndHandler class');
    });

    it('requires helpers module', () => {
        assert.ok(dndSrc.includes("require('./helpers')"), 'must require helpers');
    });

    it('imports DND_STATE and dndTransition from helpers', () => {
        assert.ok(dndSrc.includes('DND_STATE'), 'must use DND_STATE');
        assert.ok(dndSrc.includes('dndTransition'), 'must use dndTransition');
    });

    it('has DRAG_THRESHOLD constant', () => {
        assert.ok(dndSrc.includes('DRAG_THRESHOLD'), 'must define drag threshold');
    });

    it('has reset method', () => {
        assert.ok(dndSrc.includes('reset()'), 'missing reset method');
    });

    it('has findActorSection method', () => {
        assert.ok(dndSrc.includes('findActorSection('), 'missing findActorSection');
    });

    it('has onButtonPress method', () => {
        assert.ok(dndSrc.includes('onButtonPress('), 'missing onButtonPress');
    });

    it('has onMotion method', () => {
        assert.ok(dndSrc.includes('onMotion('), 'missing onMotion');
    });

    it('has onButtonRelease method', () => {
        assert.ok(dndSrc.includes('onButtonRelease('), 'missing onButtonRelease');
    });

    it('has _handleDrop method', () => {
        assert.ok(dndSrc.includes('_handleDrop('), 'missing _handleDrop');
    });

    it('has getSectionIconBounds method', () => {
        assert.ok(dndSrc.includes('getSectionIconBounds('), 'missing getSectionIconBounds');
    });

    it('has isActive and isDragging accessors', () => {
        assert.ok(dndSrc.includes('isActive()'), 'missing isActive');
        assert.ok(dndSrc.includes('isDragging()'), 'missing isDragging');
    });
});

describe('dnd-handler.js DND state machine', () => {
    it('initializes _dnd with IDLE state', () => {
        assert.ok(dndSrc.includes('DND_STATE.IDLE'), 'must start in IDLE state');
    });

    it('onButtonPress validates IDLE→PRESSED transition', () => {
        let methodStart = dndSrc.indexOf('onButtonPress(actor, event) {');
        assert.ok(methodStart > 0, 'onButtonPress not found');
        let method = dndSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('dndTransition'), 'must use dndTransition');
        assert.ok(method.includes('DND_STATE.PRESSED'), 'must transition to PRESSED');
    });

    it('onMotion validates PRESSED→DRAGGING transition', () => {
        let methodStart = dndSrc.indexOf('onMotion(actor, event) {');
        assert.ok(methodStart > 0, 'onMotion not found');
        let method = dndSrc.substring(methodStart, methodStart + 800);
        assert.ok(method.includes('dndTransition'), 'must use dndTransition');
        assert.ok(method.includes('DND_STATE.DRAGGING'), 'must transition to DRAGGING');
    });

    it('onButtonRelease validates transition via dndTransition', () => {
        let methodStart = dndSrc.indexOf('onButtonRelease(actor, event) {');
        assert.ok(methodStart > 0, 'onButtonRelease not found');
        let method = dndSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('dndTransition'), 'must use dndTransition');
        assert.ok(method.includes('DND_STATE.IDLE'), 'must reset to IDLE');
    });
});

describe('dnd-handler.js inactive DND block', () => {
    it('blocks DND on inactive section icons', () => {
        let methodStart = dndSrc.indexOf('onButtonPress(actor, event) {');
        assert.ok(methodStart > 0, 'onButtonPress not found');
        let method = dndSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes("'inactive'"), 'must check for inactive section');
    });
});

describe('dnd-handler.js drag clone', () => {
    it('creates and destroys drag clone', () => {
        assert.ok(dndSrc.includes('_createDndClone'), 'must have _createDndClone');
        assert.ok(dndSrc.includes('_destroyDndClone'), 'must have _destroyDndClone');
        assert.ok(dndSrc.includes('_dndClone'), 'must track clone reference');
    });

    it('positions drag clone during motion', () => {
        let methodStart = dndSrc.indexOf('onMotion(actor, event) {');
        assert.ok(methodStart > 0, 'onMotion not found');
        let method = dndSrc.substring(methodStart, methodStart + 1100);
        assert.ok(method.includes('_positionDndClone'), 'must position clone during motion');
    });
});

describe('dnd-handler.js drop handling', () => {
    it('re-populates popup after cross-section drop', () => {
        let methodStart = dndSrc.indexOf('_handleDrop(managed, dropX, dropY, sourceSection) {');
        assert.ok(methodStart > 0, '_handleDrop not found');
        let method = dndSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('_popup.populatePopup'), 'must re-populate after drop');
        assert.ok(method.includes('_popup.depopulatePopup'), 'must depopulate before re-populating');
        assert.ok(method.includes('_popup.isOpen()'), 'must check if popup is open');
    });

    it('handles system applet DND with deferred changes', () => {
        let methodStart = dndSrc.indexOf('_handleDrop(managed, dropX, dropY, sourceSection) {');
        assert.ok(methodStart > 0, '_handleDrop not found');
        let method = dndSrc.substring(methodStart, methodStart + 2400);
        assert.ok(method.includes('system-applet'), 'must detect system applet');
        assert.ok(method.includes('_sysProxy.pendingDisable'), 'must record pending disable');
        assert.ok(method.includes('_sysProxy.pendingEnable'), 'must record pending enable');
    });

    it('uses exceedsDragThreshold from helpers', () => {
        assert.ok(dndSrc.includes('exceedsDragThreshold'), 'must use threshold helper');
    });

    it('delegates to registry for icon visibility and order', () => {
        assert.ok(dndSrc.includes('_registry.setIconVisibility'), 'must delegate visibility');
        assert.ok(dndSrc.includes('_registry.setIconOrder'), 'must delegate order');
        assert.ok(dndSrc.includes('_registry.getPanelIconOrder'), 'must get panel icon order');
    });
});

describe('dnd-handler.js sourceSection capture', () => {
    it('captures sourceSection before resetting to IDLE', () => {
        let methodStart = dndSrc.indexOf('onButtonRelease(actor, event) {');
        assert.ok(methodStart > 0, 'onButtonRelease not found');
        let method = dndSrc.substring(methodStart, methodStart + 800);
        let captureIdx = method.indexOf('sourceSection = this._dnd.sourceSection');
        let resetIdx = method.indexOf('{ state: DND_STATE.IDLE }');
        assert.ok(captureIdx > 0, 'must capture sourceSection from _dnd');
        assert.ok(resetIdx > 0, 'must reset to IDLE');
        assert.ok(captureIdx < resetIdx, 'sourceSection capture must come BEFORE IDLE reset');
    });

    it('passes sourceSection as 4th argument to _handleDrop', () => {
        let methodStart = dndSrc.indexOf('onButtonRelease(actor, event) {');
        assert.ok(methodStart > 0, 'onButtonRelease not found');
        let method = dndSrc.substring(methodStart, methodStart + 1200);
        assert.ok(method.includes('_handleDrop(managed, x, y, sourceSection)'),
            '_handleDrop call must include sourceSection as 4th arg');
    });

    it('_handleDrop receives sourceSection as parameter, does not read from _dnd', () => {
        let methodStart = dndSrc.indexOf('_handleDrop(managed, dropX, dropY, sourceSection) {');
        assert.ok(methodStart > 0, '_handleDrop must have sourceSection parameter');
        let method = dndSrc.substring(methodStart, methodStart + 2000);
        assert.ok(!method.includes('this._dnd.sourceSection'),
            '_handleDrop must NOT read this._dnd.sourceSection (state already reset)');
    });
});

describe('dnd-handler.js drop highlight', () => {
    it('has _updateDropHighlight and _clearDropHighlight', () => {
        assert.ok(dndSrc.includes('_updateDropHighlight'), 'must have update highlight');
        assert.ok(dndSrc.includes('_clearDropHighlight'), 'must have clear highlight');
        assert.ok(dndSrc.includes('systray-overflow-drop-highlight'), 'must use highlight CSS class');
    });
});
