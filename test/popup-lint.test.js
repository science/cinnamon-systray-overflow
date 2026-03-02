const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const popupSrc = fs.readFileSync(path.join(__dirname, '..', 'popup-manager.js'), 'utf8');

describe('popup-manager.js structure', () => {
    it('has PopupManager class', () => {
        assert.ok(popupSrc.includes('class PopupManager'), 'missing PopupManager class');
    });

    it('requires helpers module', () => {
        assert.ok(popupSrc.includes("require('./helpers')"), 'must require helpers');
    });

    it('has ensureOverflowUI method', () => {
        assert.ok(popupSrc.includes('ensureOverflowUI()'), 'missing ensureOverflowUI');
    });

    it('has destroyOverflowUI method', () => {
        assert.ok(popupSrc.includes('destroyOverflowUI()'), 'missing destroyOverflowUI');
    });

    it('has openPanel method', () => {
        assert.ok(popupSrc.includes('openPanel()'), 'missing openPanel');
    });

    it('has closePanel method', () => {
        assert.ok(popupSrc.includes('closePanel()'), 'missing closePanel');
    });

    it('has togglePanel method', () => {
        assert.ok(popupSrc.includes('togglePanel()'), 'missing togglePanel');
    });

    it('has populatePopup method', () => {
        assert.ok(popupSrc.includes('populatePopup()'), 'missing populatePopup');
    });

    it('has depopulatePopup method', () => {
        assert.ok(popupSrc.includes('depopulatePopup()'), 'missing depopulatePopup');
    });

    it('has resizePopup method', () => {
        assert.ok(popupSrc.includes('resizePopup()'), 'missing resizePopup');
    });

    it('has calcPosition method', () => {
        assert.ok(popupSrc.includes('calcPosition()'), 'missing calcPosition');
    });

    it('has onCapturedEvent method', () => {
        assert.ok(popupSrc.includes('onCapturedEvent('), 'missing onCapturedEvent');
    });

    it('has isOpen accessor', () => {
        assert.ok(popupSrc.includes('isOpen()'), 'missing isOpen');
    });

    it('has section accessors', () => {
        assert.ok(popupSrc.includes('get visibleSection()'), 'missing visibleSection accessor');
        assert.ok(popupSrc.includes('get overflowSection()'), 'missing overflowSection accessor');
        assert.ok(popupSrc.includes('get inactiveSection()'), 'missing inactiveSection accessor');
        assert.ok(popupSrc.includes('get inactiveLabel()'), 'missing inactiveLabel accessor');
        assert.ok(popupSrc.includes('get panel()'), 'missing panel accessor');
    });
});

describe('popup-manager.js overflow UI', () => {
    it('uses FlowLayout for icon sections', () => {
        assert.ok(popupSrc.includes('Clutter.FlowLayout'), 'must use FlowLayout');
    });

    it('places overflow panel on global.stage', () => {
        assert.ok(popupSrc.includes('global.stage.add_child'), 'must use global.stage');
    });

    it('removes overflow panel from global.stage on destroy', () => {
        assert.ok(popupSrc.includes('global.stage.remove_child'), 'must remove from stage');
    });

    it('uses pushModal for input routing', () => {
        assert.ok(popupSrc.includes('Main.pushModal'), 'must use pushModal');
    });

    it('uses popModal on close', () => {
        assert.ok(popupSrc.includes('Main.popModal'), 'must use popModal');
    });

    it('uses captured-event for click-outside and event routing', () => {
        assert.ok(popupSrc.includes("'captured-event'"), 'must use captured-event');
    });

    it('handles Escape key to close', () => {
        assert.ok(popupSrc.includes('KEY_Escape'), 'must handle Escape key');
    });
});

describe('popup-manager.js chevron and positioning', () => {
    it('adds chevron to applet.actor in ensureOverflowUI', () => {
        let methodStart = popupSrc.indexOf('ensureOverflowUI() {');
        assert.ok(methodStart > 0, 'ensureOverflowUI not found');
        let method = popupSrc.substring(methodStart, methodStart + 800);
        assert.ok(method.includes('applet.actor.add_actor'), 'must add chevron to applet.actor');
    });

    it('anchors popup position on chevron', () => {
        let methodStart = popupSrc.indexOf('calcPosition() {');
        assert.ok(methodStart > 0, 'calcPosition not found');
        let method = popupSrc.substring(methodStart, methodStart + 400);
        assert.ok(method.includes('_overflowIndicator'), 'must anchor on chevron indicator');
    });

    it('uses calcOverflowPanelPosition from helpers', () => {
        assert.ok(popupSrc.includes('calcOverflowPanelPosition'), 'must use position calc');
    });
});

describe('popup-manager.js populate/depopulate', () => {
    it('uses clones for all icons (both sections)', () => {
        let methodStart = popupSrc.indexOf('populatePopup() {');
        assert.ok(methodStart > 0, 'populatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('Clutter.Clone'), 'must use Clutter.Clone');
        assert.ok(method.includes('_managedIconRef'), 'clones must be tagged');
        assert.ok(method.includes('_popupClones'), 'must track clones');
    });

    it('moves overflow icons to off-screen container for cloning', () => {
        let methodStart = popupSrc.indexOf('populatePopup() {');
        assert.ok(methodStart > 0, 'populatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('_cloneSourceBox'), 'must use off-screen clone source box');
        assert.ok(method.includes('set_position(-10000'), 'must position off-screen');
        assert.ok(method.includes('visible = true'), 'must set overflow icons visible for clone painting');
    });

    it('has try/catch for clone creation (Phase 1C)', () => {
        let methodStart = popupSrc.indexOf('populatePopup() {');
        assert.ok(methodStart > 0, 'populatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('try {') || method.includes('try{'), 'must have try/catch');
    });

    it('checks is_finalized before cloning (Phase 1C)', () => {
        let methodStart = popupSrc.indexOf('populatePopup() {');
        assert.ok(methodStart > 0, 'populatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('is_finalized'), 'must check is_finalized');
    });

    it('has explicit cellSize for consistent FlowLayout', () => {
        let methodStart = popupSrc.indexOf('populatePopup() {');
        assert.ok(methodStart > 0, 'populatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('cellSize'), 'must use cellSize');
        assert.ok(method.includes('set_size'), 'must set explicit size on clones');
    });

    it('depopulate returns overflow icons from off-screen container', () => {
        let methodStart = popupSrc.indexOf('depopulatePopup() {');
        assert.ok(methodStart > 0, 'depopulatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1000);
        assert.ok(method.includes('_cloneSourceBox'), 'must clean up off-screen container');
    });

    it('depopulate has try/catch for clone destroy (Phase 1C)', () => {
        let methodStart = popupSrc.indexOf('depopulatePopup() {');
        assert.ok(methodStart > 0, 'depopulatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1000);
        assert.ok(method.includes('try') || method.includes('catch'), 'must have try/catch');
    });

    it('depopulate destroys clones', () => {
        let methodStart = popupSrc.indexOf('depopulatePopup() {');
        assert.ok(methodStart > 0, 'depopulatePopup not found');
        let method = popupSrc.substring(methodStart, methodStart + 1000);
        assert.ok(method.includes('_popupClones'), 'must clean up popup clones');
        assert.ok(method.includes('.destroy()'), 'must destroy clones');
    });

    it('delegates system applet populate/depopulate to _sysProxy', () => {
        assert.ok(popupSrc.includes('_sysProxy.populateSystemApplets'), 'must call populate');
        assert.ok(popupSrc.includes('_sysProxy.depopulateSystemApplets'), 'must call depopulate');
    });
});

describe('popup-manager.js closePanel orchestration', () => {
    it('disconnects captured-event before popModal', () => {
        let methodStart = popupSrc.indexOf('closePanel() {');
        assert.ok(methodStart > 0, 'closePanel not found');
        let method = popupSrc.substring(methodStart, methodStart + 1200);
        let disconnectIdx = method.indexOf('stage.disconnect');
        let popModalIdx = method.indexOf('Main.popModal');
        assert.ok(disconnectIdx > 0 && popModalIdx > 0, 'both must exist');
        assert.ok(disconnectIdx < popModalIdx, 'disconnect must come before popModal');
    });

    it('resets DND via _dndHandler.reset()', () => {
        let methodStart = popupSrc.indexOf('closePanel() {');
        assert.ok(methodStart > 0, 'closePanel not found');
        let method = popupSrc.substring(methodStart, methodStart + 500);
        assert.ok(method.includes('_dndHandler.reset()'), 'must reset DND on close');
    });

    it('processes deferred icon removals (Phase 1D)', () => {
        let methodStart = popupSrc.indexOf('closePanel() {');
        assert.ok(methodStart > 0, 'closePanel not found');
        let method = popupSrc.substring(methodStart, methodStart + 1200);
        assert.ok(method.includes('_deferredXEmbedClear'), 'must process deferred XEmbed clear');
        assert.ok(method.includes('_pendingIconRemovals'), 'must process pending removals');
    });

    it('applies pending system applet changes', () => {
        let methodStart = popupSrc.indexOf('closePanel() {');
        assert.ok(methodStart > 0, 'closePanel not found');
        let method = popupSrc.substring(methodStart, methodStart + 1600);
        assert.ok(method.includes('_sysProxy.applyPendingChanges'), 'must apply pending changes');
    });

    it('redistributes icons after pending changes', () => {
        let methodStart = popupSrc.indexOf('closePanel() {');
        assert.ok(methodStart > 0, 'closePanel not found');
        let method = popupSrc.substring(methodStart, methodStart + 1600);
        let applyIdx = method.indexOf('_sysProxy.applyPendingChanges');
        let redistIdx = method.indexOf('_registry.redistributeIcons()');
        assert.ok(applyIdx > 0, 'must apply pending changes');
        assert.ok(redistIdx > 0, 'must redistribute icons');
        assert.ok(redistIdx > applyIdx, 'redistribute must come after apply');
    });
});

describe('popup-manager.js event routing', () => {
    it('routes button press to DND handler', () => {
        let methodStart = popupSrc.indexOf('onCapturedEvent(event) {');
        assert.ok(methodStart > 0, 'onCapturedEvent method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2000);
        assert.ok(method.includes('_dndHandler.onButtonPress'), 'must route press');
    });

    it('routes button release to DND handler', () => {
        let methodStart = popupSrc.indexOf('onCapturedEvent(event) {');
        assert.ok(methodStart > 0, 'onCapturedEvent method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2000);
        assert.ok(method.includes('_dndHandler.onButtonRelease'), 'must route release');
    });

    it('routes motion to DND handler', () => {
        let methodStart = popupSrc.indexOf('onCapturedEvent(event) {');
        assert.ok(methodStart > 0, 'onCapturedEvent method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2000);
        assert.ok(method.includes('_dndHandler.onMotion'), 'must route motion');
    });

    it('checks _dndHandler.isActive() for routing', () => {
        let methodStart = popupSrc.indexOf('onCapturedEvent(event) {');
        assert.ok(methodStart > 0, 'onCapturedEvent method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2000);
        assert.ok(method.includes('_dndHandler.isActive()'), 'must check isActive');
    });

    it('routes scroll events to system applet proxy', () => {
        let methodStart = popupSrc.indexOf('onCapturedEvent(event) {');
        assert.ok(methodStart > 0, 'onCapturedEvent method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2500);
        assert.ok(method.includes('SCROLL'), 'must handle SCROLL event type');
        assert.ok(method.includes('forwardScrollToSystemApplet'), 'must forward scroll to system applet');
    });
});

describe('resizePopup height fixes', () => {
    it('sets explicit section heights via calcSectionHeight', () => {
        let methodStart = popupSrc.indexOf('resizePopup() {');
        assert.ok(methodStart > 0, 'resizePopup method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2000);
        assert.ok(method.includes('set_height('), 'must call set_height on sections');
        assert.ok(method.includes('calcSectionHeight('), 'must use calcSectionHeight helper');
    });

    it('uses calcPopupHeight for panel height instead of get_preferred_height', () => {
        let methodStart = popupSrc.indexOf('resizePopup() {');
        assert.ok(methodStart > 0, 'resizePopup method not found');
        // Use 2300 chars to cover resizePopup only, not calcPosition which follows
        let method = popupSrc.substring(methodStart, methodStart + 2300);
        assert.ok(method.includes('calcPopupHeight('), 'must use calcPopupHeight helper');
        assert.ok(!method.includes('get_preferred_height'), 'must NOT use get_preferred_height (stale on first open)');
    });

    it('clamps Shown and Hidden section heights to minimum one-row height', () => {
        let methodStart = popupSrc.indexOf('resizePopup() {');
        assert.ok(methodStart > 0, 'resizePopup method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2000);
        let visHMatch = method.match(/let visH\s*=\s*Math\.max\(iconCell/);
        assert.ok(visHMatch, 'visH must be clamped with Math.max(iconCell, ...)');
        let ovHMatch = method.match(/let ovH\s*=\s*Math\.max\(iconCell/);
        assert.ok(ovHMatch, 'ovH must be clamped with Math.max(iconCell, ...)');
    });

    it('height helper uses get_n_children and iconsPerRow', () => {
        let methodStart = popupSrc.indexOf('resizePopup() {');
        assert.ok(methodStart > 0, 'resizePopup method not found');
        let method = popupSrc.substring(methodStart, methodStart + 2000);
        assert.ok(method.includes('get_n_children()'), 'must use get_n_children for child count');
        assert.ok(method.includes('iconsPerRow'), 'must use iconsPerRow for grid calculation');
    });
});
