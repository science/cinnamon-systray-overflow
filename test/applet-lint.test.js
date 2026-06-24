const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appletSrc = fs.readFileSync(path.join(__dirname, '..', 'applet.js'), 'utf8');

describe('applet.js cleanup on removal', () => {
    it('has on_applet_removed_from_panel method', () => {
        assert.ok(appletSrc.includes('on_applet_removed_from_panel'), 'missing cleanup method');
    });

    it('disconnects all signals in cleanup', () => {
        assert.ok(appletSrc.includes('disconnectAllSignals'), 'must disconnect signals on removal');
    });

    it('destroys managed icons in cleanup', () => {
        assert.ok(appletSrc.includes('_registry.clear'), 'must clear managed icons');
    });

    it('destroys recording indicator in cleanup', () => {
        assert.ok(appletSrc.includes('_recording_indicator.destroy'), 'must destroy recorder');
    });

    it('closes popup via _popup.closePanel() in cleanup', () => {
        assert.ok(appletSrc.includes('_popup.closePanel()'), 'must close popup on removal');
    });

    it('destroys overflow UI via _popup.destroyOverflowUI() in cleanup', () => {
        assert.ok(appletSrc.includes('_popup.destroyOverflowUI()'), 'must destroy overflow UI on removal');
    });
});

describe('applet.js XEmbed protocol', () => {
    it('connects to StatusIconDispatcher status-icon-added', () => {
        assert.ok(appletSrc.includes("'status-icon-added'"), 'missing status-icon-added signal');
    });

    it('connects to StatusIconDispatcher status-icon-removed', () => {
        assert.ok(appletSrc.includes("'status-icon-removed'"), 'missing status-icon-removed signal');
    });

    it('connects to StatusIconDispatcher before-redisplay', () => {
        assert.ok(appletSrc.includes("'before-redisplay'"), 'missing before-redisplay signal');
    });

    it('handles global.trayReloading', () => {
        assert.ok(appletSrc.includes('global.trayReloading'), 'must handle tray reloading');
    });

    it('starts StatusIconDispatcher', () => {
        assert.ok(appletSrc.includes('statusIconDispatcher.start'), 'must start dispatcher');
    });

    it('has _onTrayIconAdded handler', () => {
        assert.ok(appletSrc.includes('_onTrayIconAdded'), 'missing XEmbed add handler');
    });

    it('has _onTrayIconRemoved handler', () => {
        assert.ok(appletSrc.includes('_onTrayIconRemoved'), 'missing XEmbed remove handler');
    });

    it('has _onBeforeRedisplay handler', () => {
        assert.ok(appletSrc.includes('_onBeforeRedisplay'), 'missing before-redisplay handler');
    });

    it('handles XEmbed events with begin_modal/end_modal', () => {
        assert.ok(appletSrc.includes('global.begin_modal'), 'missing begin_modal for XEmbed');
        assert.ok(appletSrc.includes('global.end_modal'), 'missing end_modal for XEmbed');
    });

    it('guards begin_modal against nesting with overflow popup', () => {
        assert.ok(appletSrc.includes('_popup.isOpen()'), 'must guard modal nesting via popup');
    });

    it('uses handle_event for XEmbed icons', () => {
        assert.ok(appletSrc.includes('handle_event'), 'must use handle_event for XEmbed');
    });
});

describe('applet.js XApp protocol', () => {
    it('creates XApp.StatusIconMonitor', () => {
        assert.ok(appletSrc.includes('XApp.StatusIconMonitor'), 'missing XApp monitor');
    });

    it('connects to icon-added signal', () => {
        assert.ok(appletSrc.includes("'icon-added'"), 'missing icon-added signal');
    });

    it('connects to icon-removed signal', () => {
        assert.ok(appletSrc.includes("'icon-removed'"), 'missing icon-removed signal');
    });

    it('has XAppStatusIcon class', () => {
        assert.ok(appletSrc.includes('class XAppStatusIcon'), 'missing XAppStatusIcon class');
    });

    it('has RecorderIcon class', () => {
        assert.ok(appletSrc.includes('class RecorderIcon'), 'missing RecorderIcon class');
    });

    it('checks systray manager roles to hide duplicates', () => {
        assert.ok(appletSrc.includes('systrayManager.getRoles'), 'must check hidden roles');
    });

    it('connects to systray manager changed signal', () => {
        assert.ok(appletSrc.includes("'changed'"), 'missing systray manager changed signal');
    });
});

describe('applet.js settings', () => {
    it('uses Settings.AppletSettings', () => {
        assert.ok(appletSrc.includes('Settings.AppletSettings'), 'must use AppletSettings');
    });

    it('binds icon-visibility setting', () => {
        assert.ok(appletSrc.includes("'icon-visibility'"), 'must bind icon-visibility');
    });

    it('binds icon-order setting', () => {
        assert.ok(appletSrc.includes("'icon-order'"), 'must bind icon-order');
    });

    it('binds default-visibility setting', () => {
        assert.ok(appletSrc.includes("'default-visibility'"), 'must bind default-visibility');
    });

    it('binds disabled-applets setting', () => {
        assert.ok(appletSrc.includes("'disabled-applets'"), 'must bind disabled-applets');
    });

    it('uses correct UUID for settings', () => {
        assert.ok(appletSrc.includes("'systray-overflow@cinnamon'"), 'must use correct UUID');
    });
});

describe('applet.js module integration', () => {
    it('requires helpers.js', () => {
        assert.ok(appletSrc.includes("require('./helpers')"), 'must require helpers');
    });

    it('requires icon-registry.js', () => {
        assert.ok(appletSrc.includes("require('./icon-registry')"), 'must require icon-registry');
    });

    it('requires system-applet-proxy.js', () => {
        assert.ok(appletSrc.includes("require('./system-applet-proxy')"), 'must require system-applet-proxy');
    });

    it('requires dnd-handler.js', () => {
        assert.ok(appletSrc.includes("require('./dnd-handler')"), 'must require dnd-handler');
    });

    it('requires popup-manager.js', () => {
        assert.ok(appletSrc.includes("require('./popup-manager')"), 'must require popup-manager');
    });

    it('creates IconRegistry instance', () => {
        assert.ok(appletSrc.includes('new IconRegistry('), 'must create IconRegistry');
    });

    it('creates SystemAppletProxy instance', () => {
        assert.ok(appletSrc.includes('new SystemAppletProxy('), 'must create SystemAppletProxy');
    });

    it('creates DndHandler instance', () => {
        assert.ok(appletSrc.includes('new DndHandler('), 'must create DndHandler');
    });

    it('creates PopupManager instance', () => {
        assert.ok(appletSrc.includes('new PopupManager('), 'must create PopupManager');
    });

    it('creates overflow UI at init via ensureOverflowUI', () => {
        assert.ok(appletSrc.includes('_popup.ensureOverflowUI()'), 'must call ensureOverflowUI during init');
    });

    it('uses xappProxyToId from helpers', () => {
        assert.ok(appletSrc.includes('xappProxyToId'), 'must use xappProxyToId');
    });
});

describe('applet.js managed icons', () => {
    it('tracks icon protocol type', () => {
        assert.ok(appletSrc.includes("protocol: 'xembed'"), 'must track xembed protocol');
        assert.ok(appletSrc.includes("protocol: 'xapp'"), 'must track xapp protocol');
    });

    it('redistributes icons when new icon appears', () => {
        assert.ok(appletSrc.includes('this._registry.redistributeIcons()'), 'must redistribute on add');
    });

    it('redistributes icons when icon is removed', () => {
        let methodStart = appletSrc.indexOf('_removeXAppIcon(icon_proxy) {');
        assert.ok(methodStart > 0, '_removeXAppIcon method not found');
        let method = appletSrc.substring(methodStart, methodStart + 1100);
        assert.ok(method.includes('_registry.redistributeIcons'), 'must redistribute on XApp remove');
    });
});

describe('applet.js edge cases', () => {
    it('_onBeforeRedisplay clears XEmbed icons', () => {
        assert.ok(appletSrc.includes('_clearXEmbedIcons'), 'must clear XEmbed on redisplay');
    });

    it('handles orientation changes', () => {
        assert.ok(appletSrc.includes('on_orientation_changed'), 'must handle orientation changes');
    });

    it('updates tray orientation for XEmbed', () => {
        assert.ok(appletSrc.includes('set_tray_orientation'), 'must update tray orientation');
    });

    it('handles UI scale changes with debounce', () => {
        assert.ok(appletSrc.includes('_uiScaleChanged'), 'must handle scale changes');
        assert.ok(appletSrc.includes('scale-changed'), 'must connect to scale-changed');
    });

    it('handles panel edit mode changes', () => {
        assert.ok(appletSrc.includes('panel-edit-mode'), 'must handle edit mode');
    });

    it('listens for icon-size-changed on panel', () => {
        assert.ok(appletSrc.includes('icon-size-changed'), 'must listen for icon size changes');
    });

    it('handles icon theme changes', () => {
        assert.ok(appletSrc.includes('_onIconThemeChanged'), 'must refresh on icon theme change');
    });
});

describe('applet.js DND state machine (Phase 1A)', () => {
    it('imports DND_STATE from helpers', () => {
        assert.ok(appletSrc.includes('DND_STATE'), 'must use DND_STATE from helpers');
    });

    it('delegates DND to DndHandler module', () => {
        assert.ok(appletSrc.includes('_dndHandler'), 'must reference DND handler');
    });
});

describe('applet.js XApp setVisible respects icon classification', () => {
    it('setVisible uses helpers.resolveVisibility', () => {
        let methodStart = appletSrc.indexOf('setVisible(visible) {');
        assert.ok(methodStart > 0, 'setVisible not found');
        let method = appletSrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('resolveVisibility'), 'must use resolveVisibility from helpers');
    });

    it('setVisible checks popup state before modifying visibility', () => {
        let methodStart = appletSrc.indexOf('setVisible(visible) {');
        assert.ok(methodStart > 0, 'setVisible not found');
        let method = appletSrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('_popup.isOpen()'), 'must check popup state');
    });

    it('setVisible looks up iconId from registry', () => {
        let methodStart = appletSrc.indexOf('setVisible(visible) {');
        assert.ok(methodStart > 0, 'setVisible not found');
        let method = appletSrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('_registry'), 'must look up icon in registry');
        assert.ok(method.includes('iconVisibility'), 'must pass iconVisibility prefs');
        assert.ok(method.includes('defaultVisibility'), 'must pass defaultVisibility');
    });
});

describe('applet.js cleanup disconnects visibility guards', () => {
    it('calls disconnectAllGuards on removal', () => {
        let methodStart = appletSrc.indexOf('on_applet_removed_from_panel() {');
        assert.ok(methodStart > 0, 'on_applet_removed_from_panel not found');
        let method = appletSrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('disconnectAllGuards'), 'must disconnect visibility guards on removal');
    });
});

describe('applet.js signal handler guards during popup (Phase 1D)', () => {
    it('_onBeforeRedisplay defers during popup', () => {
        let methodStart = appletSrc.indexOf('_onBeforeRedisplay() {');
        assert.ok(methodStart > 0, '_onBeforeRedisplay not found');
        let method = appletSrc.substring(methodStart, methodStart + 400);
        assert.ok(method.includes('_popup.isOpen()'), 'must check popup state');
        assert.ok(method.includes('_deferredXEmbedClear'), 'must defer XEmbed clear');
    });

    it('_onTrayIconRemoved defers during popup', () => {
        let methodStart = appletSrc.indexOf('_onTrayIconRemoved(o, icon) {');
        assert.ok(methodStart > 0, '_onTrayIconRemoved not found');
        let method = appletSrc.substring(methodStart, methodStart + 500);
        assert.ok(method.includes('_popup.isOpen()'), 'must check popup state');
        assert.ok(method.includes('_pendingIconRemovals'), 'must defer icon removal');
    });

    it('_removeXAppIcon defers during popup', () => {
        let methodStart = appletSrc.indexOf('_removeXAppIcon(icon_proxy) {');
        assert.ok(methodStart > 0, '_removeXAppIcon not found');
        let method = appletSrc.substring(methodStart, methodStart + 400);
        assert.ok(method.includes('_popup.isOpen()'), 'must check popup state');
        assert.ok(method.includes('_pendingIconRemovals'), 'must defer icon removal');
    });
});
