// popup-manager.js — Manages the overflow popup panel UI
// Extracted from SystrayOverflowApplet for modularity.
//
// systray-overflow@cinnamon — GPL-2.0

var St = imports.gi.St;
var Clutter = imports.gi.Clutter;
var Cinnamon = imports.gi.Cinnamon;
var Main = imports.ui.main;
var Mainloop = imports.mainloop;

var helpers = require('./helpers');

var PopupManager = class PopupManager {
    constructor(applet) {
        this.applet = applet;
        this._overflowPanel = null;
        this._overflowPanelOpen = false;
        this._overflowIndicator = null;
        this._overflowVisibleSection = null;
        this._overflowOverflowSection = null;
        this._overflowInactiveSection = null;
        this._overflowInactiveLabel = null;
        this._overflowModalPushed = false;
        this._capturedEventId = 0;
        this._popupClones = [];
        this._cloneSourceBox = null;
    }

    /**
     * Whether the popup panel is currently open.
     */
    isOpen() {
        return this._overflowPanelOpen;
    }

    /**
     * Accessors for popup sections and indicator.
     */
    get visibleSection() { return this._overflowVisibleSection; }
    get overflowSection() { return this._overflowOverflowSection; }
    get inactiveSection() { return this._overflowInactiveSection; }
    get inactiveLabel() { return this._overflowInactiveLabel; }
    get panel() { return this._overflowPanel; }
    /**
     * Create the overflow UI: chevron button + popup panel with sections.
     */
    ensureOverflowUI() {
        if (this._overflowPanel) return;

        // Chevron button
        this._overflowIndicator = new St.Button({
            style_class: 'systray-overflow-chevron applet-box',
            important: true,
            reactive: true,
            can_focus: true,
            track_hover: true
        });
        let chevronIcon = new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: Math.round(this.applet.icon_size * 0.75),
            icon_type: St.IconType.SYMBOLIC
        });
        this._overflowIndicator.set_child(chevronIcon);
        this._overflowIndicator.connect('clicked', () => this.togglePanel());
        this.applet.actor.add_actor(this._overflowIndicator);

        // Overflow popup panel on global.stage
        this._overflowPanel = new St.Bin({
            style_class: 'menu systray-overflow-panel',
            important: true,
            reactive: true,
            visible: false
        });

        // Inner container with two sections
        let innerBox = new St.BoxLayout({ vertical: true, style: 'spacing: 6px;' });

        // "Shown" section
        let visibleLabel = new St.Label({
            text: 'Shown',
            style_class: 'systray-overflow-section-label'
        });
        let visibleLayout = new Clutter.FlowLayout({
            orientation: Clutter.FlowOrientation.HORIZONTAL,
            homogeneous: true,
            column_spacing: 4,
            row_spacing: 4
        });
        this._overflowVisibleSection = new St.Widget({
            layout_manager: visibleLayout,
            x_expand: true,
            style_class: 'systray-overflow-icon-grid'
        });

        // "Hidden" section
        let overflowLabel = new St.Label({
            text: 'Hidden',
            style_class: 'systray-overflow-section-label'
        });
        let overflowLayout = new Clutter.FlowLayout({
            orientation: Clutter.FlowOrientation.HORIZONTAL,
            homogeneous: true,
            column_spacing: 4,
            row_spacing: 4
        });
        this._overflowOverflowSection = new St.Widget({
            layout_manager: overflowLayout,
            x_expand: true,
            style_class: 'systray-overflow-icon-grid'
        });

        // "Inactive" section
        let inactiveLabel = new St.Label({
            text: 'Inactive',
            style_class: 'systray-overflow-section-label'
        });
        let inactiveLayout = new Clutter.FlowLayout({
            orientation: Clutter.FlowOrientation.HORIZONTAL,
            homogeneous: true,
            column_spacing: 4,
            row_spacing: 4
        });
        this._overflowInactiveSection = new St.Widget({
            layout_manager: inactiveLayout,
            x_expand: true,
            style_class: 'systray-overflow-icon-grid'
        });
        this._overflowInactiveLabel = inactiveLabel;

        innerBox.add_actor(visibleLabel);
        innerBox.add_actor(this._overflowVisibleSection);
        innerBox.add_actor(overflowLabel);
        innerBox.add_actor(this._overflowOverflowSection);
        innerBox.add_actor(inactiveLabel);
        innerBox.add_actor(this._overflowInactiveSection);

        this._overflowPanel.set_child(innerBox);
        this._overflowPanel._delegate = this.applet;

        global.stage.add_child(this._overflowPanel);
    }

    /**
     * Tear down the overflow UI completely.
     */
    destroyOverflowUI() {
        if (this._overflowPanelOpen) this.closePanel();
        if (this._overflowPanel) {
            global.stage.remove_child(this._overflowPanel);
            this._overflowPanel.destroy();
            this._overflowPanel = null;
        }
        this._overflowVisibleSection = null;
        this._overflowOverflowSection = null;
        this._overflowInactiveSection = null;
        this._overflowInactiveLabel = null;
        if (this._cloneSourceBox) {
            global.stage.remove_child(this._cloneSourceBox);
            this._cloneSourceBox.destroy();
            this._cloneSourceBox = null;
        }
        if (this._overflowIndicator) {
            let parent = this._overflowIndicator.get_parent();
            if (parent) parent.remove_child(this._overflowIndicator);
            this._overflowIndicator.destroy();
            this._overflowIndicator = null;
        }
        this._overflowPanelOpen = false;
    }

    /**
     * Toggle the popup panel open/closed.
     */
    togglePanel() {
        if (this._overflowPanelOpen)
            this.closePanel();
        else
            this.openPanel();
    }

    /**
     * Open the popup panel.
     */
    openPanel() {
        if (!this._overflowPanel || this._overflowPanelOpen) return;

        this._overflowPanelOpen = true;

        this.populatePopup();
        this.resizePopup();

        let [x, y] = this.calcPosition();
        this._overflowPanel.set_position(x, y);
        this._overflowPanel.show();
        this._overflowPanel.raise_top();

        // Update chevron direction
        if (this._overflowIndicator) {
            let icon = this._overflowIndicator.get_child();
            if (icon) icon.icon_name = 'pan-up-symbolic';
        }

        // Modal input routing
        this._overflowModalPushed = Main.pushModal(this._overflowPanel);
        if (!this._overflowModalPushed) {
            global.log('systray-overflow: pushModal failed (SPICE/VNC grab?), using captured-event only');
        }

        // Defer captured-event connection by one frame
        Mainloop.idle_add(() => {
            if (this._overflowPanelOpen && !this._capturedEventId) {
                this._capturedEventId = global.stage.connect('captured-event',
                    (stage, event) => this.onCapturedEvent(event));
            }
            return false; // GLib.SOURCE_REMOVE
        });
    }

    /**
     * Close the popup panel and apply pending changes.
     */
    closePanel() {
        if (!this._overflowPanel || !this._overflowPanelOpen) return;
        this._overflowPanelOpen = false;

        // Reset DND state machine
        this.applet._dndHandler.reset();

        // Disconnect captured-event BEFORE popModal
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }

        if (this._overflowModalPushed) {
            Main.popModal(this._overflowPanel);
            this._overflowModalPushed = false;
        }

        this.depopulatePopup();
        this._overflowPanel.hide();

        // Update chevron direction
        if (this._overflowIndicator) {
            let icon = this._overflowIndicator.get_child();
            if (icon) icon.icon_name = 'pan-down-symbolic';
        }

        // Process deferred icon removals (Phase 1D)
        if (this.applet._deferredXEmbedClear) {
            this.applet._deferredXEmbedClear = false;
            this.applet._clearXEmbedIcons();
        }
        for (let pending of this.applet._pendingIconRemovals) {
            if (pending.type === 'xembed') this.applet._onTrayIconRemoved(null, pending.icon);
            else if (pending.type === 'xapp') this.applet._removeXAppIcon(pending.proxy);
        }
        this.applet._pendingIconRemovals = [];

        // Apply deferred system applet changes
        this.applet._sysProxy.applyPendingChanges();

        // Redistribute icons to their correct containers
        this.applet._registry.redistributeIcons();
    }

    /**
     * Populate the popup with clones of managed icons and system applet proxies.
     */
    populatePopup() {
        let allIcons = Array.from(this.applet._registry.values());
        let { panel, overflow } = helpers.classifyIcons(
            allIcons,
            this.applet.iconVisibility || {},
            this.applet.defaultVisibility || 'panel',
            this.applet.iconOrder || []
        );

        // Move overflow icons to off-screen container — mapped for clone painting
        // but not in _panelBox, so they don't flash visible in the panel
        this._cloneSourceBox = new St.BoxLayout({ visible: true });
        this._cloneSourceBox.set_position(-10000, -10000);
        global.stage.add_child(this._cloneSourceBox);
        for (let managed of overflow) {
            let parent = managed.actor.get_parent();
            if (parent) parent.remove_child(managed.actor);
            this._cloneSourceBox.add_actor(managed.actor);
            managed.actor.visible = true;
        }

        this._popupClones = [];
        let cellSize = this.applet.icon_size + 8;

        for (let managed of panel) {
            if (managed.actor.is_finalized && managed.actor.is_finalized()) continue;
            try {
                let clone = new Clutter.Clone({ source: managed.actor });
                clone.reactive = true;
                clone._managedIconRef = managed;
                clone.set_size(cellSize, cellSize);
                this._overflowVisibleSection.add_child(clone);
                this._popupClones.push(clone);
            } catch (e) {
                global.logWarning('systray-overflow: clone failed for ' + managed.id + ': ' + e);
            }
        }

        for (let managed of overflow) {
            if (managed.actor.is_finalized && managed.actor.is_finalized()) continue;
            try {
                let clone = new Clutter.Clone({ source: managed.actor });
                clone.reactive = true;
                clone._managedIconRef = managed;
                clone.set_size(cellSize, cellSize);
                this._overflowOverflowSection.add_child(clone);
                this._popupClones.push(clone);
            } catch (e) {
                global.logWarning('systray-overflow: clone failed for ' + managed.id + ': ' + e);
            }
        }

        // Add system applet proxy icons
        this.applet._sysProxy.populateSystemApplets();
    }

    /**
     * Remove all clones and system applet proxies from the popup.
     */
    depopulatePopup() {
        this.applet._sysProxy.depopulateSystemApplets();

        // Return overflow icons from off-screen container to panelBox
        if (this._cloneSourceBox) {
            let children = [...this._cloneSourceBox.get_children()];
            for (let child of children) {
                this._cloneSourceBox.remove_child(child);
                child.visible = false;
                this.applet._panelBox.add_actor(child);
            }
            global.stage.remove_child(this._cloneSourceBox);
            this._cloneSourceBox.destroy();
            this._cloneSourceBox = null;
        }

        if (this._popupClones) {
            for (let clone of this._popupClones) {
                try {
                    if (clone.get_parent()) clone.get_parent().remove_child(clone);
                    clone.destroy();
                } catch (e) {
                    global.logWarning('systray-overflow: clone destroy failed: ' + e);
                }
            }
            this._popupClones = [];
        }
    }

    /**
     * Size the overflow popup based on icon count.
     */
    resizePopup() {
        if (!this._overflowPanel) return;

        let maxIcons = Math.max(
            this._overflowVisibleSection ? this._overflowVisibleSection.get_n_children() : 0,
            this._overflowOverflowSection ? this._overflowOverflowSection.get_n_children() : 0,
            this._overflowInactiveSection ? this._overflowInactiveSection.get_n_children() : 0
        );
        let iconsPerRow = Math.min(8, Math.max(4, maxIcons));
        let iconCell = this.applet.icon_size + 8;
        let spacing = 4;
        let padding = 12;
        let sectionWidth = iconsPerRow * iconCell + (iconsPerRow - 1) * spacing;

        // Set explicit width AND height on each section — bypasses FlowLayout's
        // stale preferred-height cache that causes 0-height on close→reopen
        this._overflowVisibleSection.set_width(sectionWidth);
        let visH = Math.max(iconCell, helpers.calcSectionHeight(this._overflowVisibleSection.get_n_children(), iconsPerRow, iconCell, spacing));
        this._overflowVisibleSection.set_height(visH);
        this._overflowOverflowSection.set_width(sectionWidth);
        let ovH = Math.max(iconCell, helpers.calcSectionHeight(this._overflowOverflowSection.get_n_children(), iconsPerRow, iconCell, spacing));
        this._overflowOverflowSection.set_height(ovH);
        let inH = 0;
        if (this._overflowInactiveSection) {
            this._overflowInactiveSection.set_width(sectionWidth);
            inH = helpers.calcSectionHeight(this._overflowInactiveSection.get_n_children(), iconsPerRow, iconCell, spacing);
            this._overflowInactiveSection.set_height(inH);
        }

        let popupWidth = sectionWidth + padding;
        this._overflowPanel.set_width(popupWidth);

        // Compute panel height from known CSS constants — bypasses
        // stale preferred-height data that Clutter returns on first open
        let labelCount = 2;  // Shown + Hidden always visible
        let heights = [visH, ovH];
        if (this._overflowInactiveSection && this._overflowInactiveSection.visible) {
            labelCount = 3;
            heights.push(inH);
        }
        let ph = helpers.calcPopupHeight(heights, labelCount, 18, 6, 16);
        this._overflowPanel.set_height(ph);

        let [x, y] = this.calcPosition();
        this._overflowPanel.set_position(x, y);
    }

    /**
     * Calculate popup position anchored on the chevron.
     */
    calcPosition() {
        let anchor = this._overflowIndicator || this.applet.actor;
        let alloc = Cinnamon.util_get_transformed_allocation(anchor);
        let monitor = Main.layoutManager.findMonitorForActor(anchor);

        let [, pw] = this._overflowPanel.get_preferred_width(-1);
        let [, ph] = this._overflowPanel.get_preferred_height(pw);

        let orientStr = (this.applet.orientation === St.Side.TOP) ? 'top' : 'bottom';
        return helpers.calcOverflowPanelPosition(
            { x1: alloc.x1, y1: alloc.y1, x2: alloc.x2, y2: alloc.y2 },
            { width: pw, height: ph },
            monitor,
            orientStr
        );
    }

    /**
     * Check if a point is inside an actor's bounds.
     */
    _isInsideActor(x, y, actor) {
        if (!actor) return false;
        let [ax, ay] = actor.get_transformed_position();
        let [aw, ah] = actor.get_transformed_size();
        return (x >= ax && x <= ax + aw && y >= ay && y <= ay + ah);
    }

    /**
     * Handle captured events for the popup (click-outside, Escape, DND routing).
     */
    onCapturedEvent(event) {
        let type = event.type();

        // Escape key closes
        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.closePanel();
                return Clutter.EVENT_STOP;
            }
        }

        // Route button and motion events through the DND handler.
        if (type === Clutter.EventType.BUTTON_PRESS) {
            let [ex, ey] = event.get_coords();

            let insidePanel = this._isInsideActor(ex, ey, this._overflowPanel);
            let insideChevron = this._isInsideActor(ex, ey, this._overflowIndicator);

            if (insideChevron) {
                this.closePanel();
                return Clutter.EVENT_STOP;
            }

            if (insidePanel) {
                return this.applet._dndHandler.onButtonPress(this._overflowPanel, event);
            }

            // Click outside closes
            this.closePanel();
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_RELEASE) {
            let [ex, ey] = event.get_coords();
            let insidePanel = this._isInsideActor(ex, ey, this._overflowPanel);
            if (insidePanel || this.applet._dndHandler.isActive()) {
                return this.applet._dndHandler.onButtonRelease(this._overflowPanel, event);
            }
        }

        if (type === Clutter.EventType.MOTION) {
            if (this.applet._dndHandler.isActive()) {
                return this.applet._dndHandler.onMotion(this._overflowPanel, event);
            }
        }

        if (type === Clutter.EventType.SCROLL) {
            let [ex, ey] = event.get_coords();
            let sysBtn = this.applet._sysProxy.findSystemAppletAtPos(ex, ey);
            if (sysBtn && sysBtn._systrayOverflowUuid) {
                this.applet._sysProxy.forwardScrollToSystemApplet(
                    sysBtn._systrayOverflowUuid, event);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        return Clutter.EVENT_PROPAGATE;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupManager;
}
