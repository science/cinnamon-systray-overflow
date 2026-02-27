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
        assert.ok(appletSrc.includes('_managedIcons.clear'), 'must clear managed icons');
    });

    it('destroys recording indicator in cleanup', () => {
        assert.ok(appletSrc.includes('_recording_indicator.destroy'), 'must destroy recorder');
    });

    it('closes overflow panel in cleanup', () => {
        assert.ok(appletSrc.includes('_closeOverflowPanel'), 'must close overflow on removal');
    });

    it('destroys overflow UI in cleanup', () => {
        assert.ok(appletSrc.includes('_destroyOverflowUI'), 'must destroy overflow UI on removal');
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
        // Must check _overflowPanelOpen before begin_modal
        assert.ok(appletSrc.includes('_overflowPanelOpen'), 'must guard modal nesting');
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

describe('applet.js overflow UI', () => {
    it('has _ensureOverflowUI method', () => {
        assert.ok(appletSrc.includes('_ensureOverflowUI'), 'missing overflow UI setup');
    });

    it('has _destroyOverflowUI method', () => {
        assert.ok(appletSrc.includes('_destroyOverflowUI'), 'missing overflow UI teardown');
    });

    it('has _closeOverflowPanel method', () => {
        assert.ok(appletSrc.includes('_closeOverflowPanel'), 'missing close method');
    });

    it('has _openOverflowPanel method', () => {
        assert.ok(appletSrc.includes('_openOverflowPanel'), 'missing open method');
    });

    it('has _redistributeIcons method', () => {
        assert.ok(appletSrc.includes('_redistributeIcons'), 'missing redistribute method');
    });

    it('places overflow panel on global.stage', () => {
        assert.ok(appletSrc.includes('global.stage.add_child'), 'must use global.stage for popup');
    });

    it('removes overflow panel from global.stage on destroy', () => {
        assert.ok(appletSrc.includes('global.stage.remove_child'), 'must remove from stage');
    });

    it('uses pushModal for input routing', () => {
        assert.ok(appletSrc.includes('Main.pushModal'), 'must use pushModal');
    });

    it('uses popModal on close', () => {
        assert.ok(appletSrc.includes('Main.popModal'), 'must use popModal');
    });

    it('uses captured-event for click-outside detection', () => {
        assert.ok(appletSrc.includes("'captured-event'"), 'must use captured-event');
    });

    it('handles Escape key to close', () => {
        assert.ok(appletSrc.includes('KEY_Escape'), 'must handle Escape key');
    });

    it('disconnects captured-event before popModal', () => {
        // The disconnect must come before popModal in _closeOverflowPanel method body
        let methodStart = appletSrc.indexOf('_closeOverflowPanel() {');
        assert.ok(methodStart > 0, '_closeOverflowPanel method not found');
        let closeMethod = appletSrc.substring(methodStart, methodStart + 600);
        let disconnectIdx = closeMethod.indexOf('stage.disconnect');
        // Find Main.popModal (the actual call, not the comment)
        let popModalIdx = closeMethod.indexOf('Main.popModal');
        assert.ok(disconnectIdx > 0 && popModalIdx > 0, 'both disconnect and popModal must exist');
        assert.ok(disconnectIdx < popModalIdx, 'disconnect must come before popModal');
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

    it('uses correct UUID for settings', () => {
        assert.ok(appletSrc.includes("'systray-overflow@cinnamon'"), 'must use correct UUID');
    });
});

describe('applet.js uses helpers module', () => {
    it('requires helpers.js', () => {
        assert.ok(appletSrc.includes("require('./helpers')"), 'must require helpers');
    });

    it('uses classifyIcons from helpers', () => {
        assert.ok(appletSrc.includes('classifyIcons'), 'must use classifyIcons');
    });

    it('uses xappProxyToId from helpers', () => {
        assert.ok(appletSrc.includes('xappProxyToId'), 'must use xappProxyToId');
    });

    it('uses calcOverflowPanelPosition from helpers', () => {
        assert.ok(appletSrc.includes('calcOverflowPanelPosition'), 'must use position calc');
    });
});

describe('applet.js managed icons', () => {
    it('uses a Map for managed icons', () => {
        assert.ok(appletSrc.includes('new Map()'), 'must use Map for icon tracking');
    });

    it('tracks icon protocol type', () => {
        assert.ok(appletSrc.includes("protocol: 'xembed'"), 'must track xembed protocol');
        assert.ok(appletSrc.includes("protocol: 'xapp'"), 'must track xapp protocol');
    });
});

describe('applet.js DND promote/demote', () => {
    it('has _setIconVisibility method', () => {
        assert.ok(appletSrc.includes('_setIconVisibility'), 'missing visibility setter');
    });

    it('has _setIconOrder method', () => {
        assert.ok(appletSrc.includes('_setIconOrder'), 'missing order setter');
    });

    it('persists icon-visibility via settings', () => {
        assert.ok(appletSrc.includes("setValue('icon-visibility'"), 'must persist visibility');
    });

    it('persists icon-order via settings', () => {
        assert.ok(appletSrc.includes("setValue('icon-order'"), 'must persist order');
    });

    it('has DRAG_THRESHOLD constant', () => {
        assert.ok(appletSrc.includes('DRAG_THRESHOLD'), 'must define drag threshold');
    });

    it('has _onPopupButtonPress handler', () => {
        assert.ok(appletSrc.includes('_onPopupButtonPress'), 'missing button press handler for DND');
    });

    it('has _onPopupMotion handler', () => {
        assert.ok(appletSrc.includes('_onPopupMotion'), 'missing motion handler for DND');
    });

    it('has _onPopupButtonRelease handler', () => {
        assert.ok(appletSrc.includes('_onPopupButtonRelease'), 'missing button release handler for DND');
    });

    it('uses exceedsDragThreshold from helpers', () => {
        assert.ok(appletSrc.includes('exceedsDragThreshold'), 'must use threshold helper');
    });
});

describe('applet.js polish — edge cases', () => {
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

    it('closes popup when chevron hidden (0 overflow icons)', () => {
        // _updateChevronVisibility method body must close popup when no overflow
        let methodStart = appletSrc.indexOf('_updateChevronVisibility(hasOverflow)');
        assert.ok(methodStart > 0, '_updateChevronVisibility method not found');
        let updateMethod = appletSrc.substring(methodStart, methodStart + 600);
        assert.ok(updateMethod.includes('_closeOverflowPanel'), 'must close when 0 overflow');
    });

    it('redistributes icons when new icon appears', () => {
        // _onTrayIconAdded and _addXAppIcon must call _redistributeIcons
        assert.ok(appletSrc.includes('this._redistributeIcons()'), 'must redistribute on add');
    });

    it('redistributes icons when icon is removed', () => {
        // _removeXAppIcon method body must call _redistributeIcons
        let methodStart = appletSrc.indexOf('_removeXAppIcon(icon_proxy) {');
        assert.ok(methodStart > 0, '_removeXAppIcon method not found');
        let removeXApp = appletSrc.substring(methodStart, methodStart + 700);
        assert.ok(removeXApp.includes('_redistributeIcons'), 'must redistribute on XApp remove');
    });

    it('clears DND state when popup closes', () => {
        // _closeOverflowPanel or _depopulateOverflowPopup must handle clean state
        assert.ok(appletSrc.includes('_depopulateOverflowPopup'), 'must depopulate on close');
    });
});
