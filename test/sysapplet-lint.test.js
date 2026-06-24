const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sysProxySrc = fs.readFileSync(path.join(__dirname, '..', 'system-applet-proxy.js'), 'utf8');

describe('system-applet-proxy.js structure', () => {
    it('has SystemAppletProxy class', () => {
        assert.ok(sysProxySrc.includes('class SystemAppletProxy'), 'missing class');
    });

    it('defines SYSTEM_APPLET_UUIDS constant (network excluded)', () => {
        assert.ok(sysProxySrc.includes('SYSTEM_APPLET_UUIDS'), 'must define system applet UUIDs');
        assert.ok(sysProxySrc.includes("'sound@cinnamon.org'"), 'must include sound applet');
        let uuidsStart = sysProxySrc.indexOf('SYSTEM_APPLET_UUIDS');
        let uuidsEnd = sysProxySrc.indexOf('];', uuidsStart);
        let uuidsBlock = sysProxySrc.substring(uuidsStart, uuidsEnd);
        assert.ok(!uuidsBlock.includes("'network@cinnamon.org'"), 'network must be excluded');
        assert.ok(sysProxySrc.includes('network@cinnamon.org excluded'), 'must have exclusion comment');
    });

    it('has getSystemApplets method', () => {
        assert.ok(sysProxySrc.includes('getSystemApplets()'), 'missing getSystemApplets');
    });

    it('has getAppletIconName method', () => {
        assert.ok(sysProxySrc.includes('getAppletIconName'), 'missing getAppletIconName');
    });

    it('has populateSystemApplets method', () => {
        assert.ok(sysProxySrc.includes('populateSystemApplets()'), 'missing populateSystemApplets');
    });

    it('has depopulateSystemApplets method', () => {
        assert.ok(sysProxySrc.includes('depopulateSystemApplets()'), 'missing depopulateSystemApplets');
    });

    it('has activateSystemApplet method', () => {
        assert.ok(sysProxySrc.includes('activateSystemApplet('), 'missing activateSystemApplet');
    });

    it('has findSystemAppletAtPos method', () => {
        assert.ok(sysProxySrc.includes('findSystemAppletAtPos('), 'missing findSystemAppletAtPos');
    });

    it('has pendingDisable and pendingEnable methods', () => {
        assert.ok(sysProxySrc.includes('pendingDisable('), 'missing pendingDisable');
        assert.ok(sysProxySrc.includes('pendingEnable('), 'missing pendingEnable');
    });

    it('has applyPendingChanges method', () => {
        assert.ok(sysProxySrc.includes('applyPendingChanges()'), 'missing applyPendingChanges');
    });

    it('has hideSystemApplet and showSystemApplet methods', () => {
        assert.ok(sysProxySrc.includes('hideSystemApplet(uuid)'), 'missing hideSystemApplet');
        assert.ok(sysProxySrc.includes('showSystemApplet(uuid)'), 'missing showSystemApplet');
    });

    it('has forwardScrollToSystemApplet method', () => {
        assert.ok(sysProxySrc.includes('forwardScrollToSystemApplet('), 'missing forwardScrollToSystemApplet');
    });

    it('has restoreHiddenState method', () => {
        assert.ok(sysProxySrc.includes('restoreHiddenState()'), 'missing restoreHiddenState');
    });
});

describe('system-applet-proxy.js getSystemApplets', () => {
    it('considers pending changes', () => {
        let methodStart = sysProxySrc.indexOf('getSystemApplets() {');
        assert.ok(methodStart > 0, 'getSystemApplets not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('_pendingDisables'), 'must check pending disables');
        assert.ok(method.includes('_pendingEnables'), 'must check pending enables');
        assert.ok(method.includes('.iconName'), 'must use saved icon name');
    });

    it('classifies hidden applets via tracking before checking actor visibility', () => {
        let methodStart = sysProxySrc.indexOf('getSystemApplets() {');
        assert.ok(methodStart > 0, 'getSystemApplets not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('hidden[uuid]'), 'must check hidden tracking');
        assert.ok(method.includes('actor.visible'), 'must check instance actor visibility');
        assert.ok(method.includes('result.inactive'), 'must populate result.inactive array');
    });
});

describe('system-applet-proxy.js populateSystemApplets', () => {
    it('marks proxy buttons with _systrayOverflowType', () => {
        assert.ok(sysProxySrc.includes("_systrayOverflowType = 'system-applet'"), 'must tag proxy buttons');
    });

    it('populates inactive section with dimmed opacity', () => {
        let methodStart = sysProxySrc.indexOf('populateSystemApplets() {');
        assert.ok(methodStart > 0, 'populateSystemApplets not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 2500);
        assert.ok(method.includes('sysApplets.inactive'), 'must handle inactive applets');
        assert.ok(method.includes('_popup.inactiveSection.add_child'), 'must add to inactive section');
        assert.ok(method.includes('opacity: 128'), 'inactive must be dimmed');
    });

    it('uses cellSize for consistent sizing', () => {
        let methodStart = sysProxySrc.indexOf('populateSystemApplets() {');
        assert.ok(methodStart > 0, 'populateSystemApplets not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 1200);
        assert.ok(method.includes('cellSize'), 'must use cellSize');
    });
});

describe('system-applet-proxy.js depopulateSystemApplets', () => {
    it('has try/catch for safe cleanup', () => {
        let methodStart = sysProxySrc.indexOf('depopulateSystemApplets() {');
        assert.ok(methodStart > 0, 'depopulateSystemApplets not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 500);
        assert.ok(method.includes('try'), 'must have try/catch');
    });

    it('cleans up inactive section', () => {
        let methodStart = sysProxySrc.indexOf('depopulateSystemApplets() {');
        assert.ok(methodStart > 0, 'depopulateSystemApplets not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 500);
        assert.ok(method.includes('_popup.inactiveSection'), 'must clean up inactive section');
    });
});

describe('system-applet-proxy.js hideSystemApplet', () => {
    it('sets actor.visible = false and persists to disabled-applets', () => {
        let methodStart = sysProxySrc.indexOf('hideSystemApplet(uuid) {');
        assert.ok(methodStart > 0, 'hideSystemApplet not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('actor.visible = false'), 'must set actor.visible = false');
        assert.ok(method.includes('disabled-applets'), 'must persist to disabled-applets');
        assert.ok(method.includes('iconName'), 'must save icon name');
    });
});

describe('system-applet-proxy.js showSystemApplet', () => {
    it('sets actor.visible = true and removes from disabled-applets', () => {
        let methodStart = sysProxySrc.indexOf('showSystemApplet(uuid) {');
        assert.ok(methodStart > 0, 'showSystemApplet not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('actor.visible = true'), 'must set actor.visible = true');
        assert.ok(method.includes('disabled-applets'), 'must update disabled-applets');
    });
});

describe('system-applet-proxy.js restoreHiddenState', () => {
    it('migrates old dconf-disable format', () => {
        let methodStart = sysProxySrc.indexOf('restoreHiddenState() {');
        assert.ok(methodStart > 0, 'restoreHiddenState not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 1200);
        assert.ok(method.includes('saved.entry'), 'must check for old format with entry field');
        assert.ok(method.includes('enabled-applets'), 'must re-enable via dconf for migration');
        assert.ok(method.includes('actor.visible = false'), 'must hide via visibility');
    });
});

describe('system-applet-proxy.js forwardScrollToSystemApplet', () => {
    it('calls _onScrollEvent on the applet instance', () => {
        let methodStart = sysProxySrc.indexOf('forwardScrollToSystemApplet(');
        assert.ok(methodStart > 0, 'forwardScrollToSystemApplet not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 400);
        assert.ok(method.includes('_onScrollEvent'), 'must call _onScrollEvent');
    });
});

describe('system-applet-proxy.js visibility guards', () => {
    it('initializes _visibilityGuards in constructor', () => {
        let ctorStart = sysProxySrc.indexOf('constructor(applet) {');
        assert.ok(ctorStart > 0, 'constructor not found');
        let ctor = sysProxySrc.substring(ctorStart, ctorStart + 400);
        assert.ok(ctor.includes('_visibilityGuards'), 'must initialize _visibilityGuards');
    });

    it('has _connectVisibilityGuard method with notify::visible signal', () => {
        let methodStart = sysProxySrc.indexOf('_connectVisibilityGuard(uuid, instance) {');
        assert.ok(methodStart > 0, '_connectVisibilityGuard not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 800);
        assert.ok(method.includes("'notify::visible'"), 'must connect notify::visible signal');
        assert.ok(method.includes('actor.visible = false'), 'must re-hide when guard fires');
        assert.ok(method.includes('cooldownId'), 'must have cooldown to prevent slap fights');
    });

    it('has _disconnectVisibilityGuard method that cleans up cooldown', () => {
        let methodStart = sysProxySrc.indexOf('_disconnectVisibilityGuard(uuid) {');
        assert.ok(methodStart > 0, '_disconnectVisibilityGuard not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 400);
        assert.ok(method.includes('source_remove'), 'must clean up cooldown timer');
        assert.ok(method.includes('disconnect'), 'must disconnect signal');
    });

    it('has disconnectAllGuards method', () => {
        assert.ok(sysProxySrc.includes('disconnectAllGuards()'), 'must have disconnectAllGuards');
        let methodStart = sysProxySrc.indexOf('disconnectAllGuards() {');
        let method = sysProxySrc.substring(methodStart, methodStart + 300);
        assert.ok(method.includes('_disconnectVisibilityGuard'), 'must disconnect each guard');
        assert.ok(method.includes('stopPeriodicScan'), 'must stop periodic scan');
    });

    it('hideSystemApplet connects visibility guard', () => {
        let methodStart = sysProxySrc.indexOf('hideSystemApplet(uuid) {');
        assert.ok(methodStart > 0, 'hideSystemApplet not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('_connectVisibilityGuard'), 'must connect guard after hiding');
    });

    it('showSystemApplet disconnects visibility guard', () => {
        let methodStart = sysProxySrc.indexOf('showSystemApplet(uuid) {');
        assert.ok(methodStart > 0, 'showSystemApplet not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('_disconnectVisibilityGuard'), 'must disconnect guard when showing');
    });

    it('restoreHiddenState connects guards for each hidden applet', () => {
        let methodStart = sysProxySrc.indexOf('restoreHiddenState() {');
        assert.ok(methodStart > 0, 'restoreHiddenState not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 1400);
        assert.ok(method.includes('_connectVisibilityGuard'), 'must connect guards during restore');
        assert.ok(method.includes('startPeriodicScan'), 'must start periodic scan after restore');
    });
});

describe('system-applet-proxy.js periodic scan', () => {
    it('has enforceHiddenState method', () => {
        let methodStart = sysProxySrc.indexOf('enforceHiddenState() {');
        assert.ok(methodStart > 0, 'enforceHiddenState not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('disabledApplets'), 'must check disabled applets');
        assert.ok(method.includes('actor.visible'), 'must enforce actor visibility');
        assert.ok(method.includes('_connectVisibilityGuard'), 'must reconnect stale guards');
    });

    it('has startPeriodicScan method', () => {
        let methodStart = sysProxySrc.indexOf('startPeriodicScan() {');
        assert.ok(methodStart > 0, 'startPeriodicScan not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 300);
        assert.ok(method.includes('timeout_add_seconds'), 'must use timeout_add_seconds');
        assert.ok(method.includes('enforceHiddenState'), 'must call enforceHiddenState');
        assert.ok(method.includes('SOURCE_CONTINUE'), 'must repeat');
    });

    it('has stopPeriodicScan method', () => {
        let methodStart = sysProxySrc.indexOf('stopPeriodicScan() {');
        assert.ok(methodStart > 0, 'stopPeriodicScan not found');
        let method = sysProxySrc.substring(methodStart, methodStart + 200);
        assert.ok(method.includes('source_remove'), 'must remove interval');
    });
});
