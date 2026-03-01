// system-applet-proxy.js — Manages system applet proxy icons in the overflow popup
// Extracted from SystrayOverflowApplet for modularity.
//
// systray-overflow@cinnamon — GPL-2.0

var St = imports.gi.St;
var Main = imports.ui.main;
var Clutter = imports.gi.Clutter;

// System applet UUIDs we can manage via proxy icons in the overflow popup
// network@cinnamon.org excluded: it auto-repairs when disabled, creating phantom icons
var SYSTEM_APPLET_UUIDS = [
    'sound@cinnamon.org',
    'power@cinnamon.org',
    'printers@cinnamon.org',
    'removable-drives@cinnamon.org',
    'keyboard@cinnamon.org',
    'notifications@cinnamon.org',
    'favorites@cinnamon.org'
];

var SystemAppletProxy = class SystemAppletProxy {
    constructor(applet) {
        this.applet = applet;
        this._pendingDisables = {};
        this._pendingEnables = {};
    }

    /**
     * Discover system applets and classify as shown, inactive, or hidden.
     * - shown: enabled, has instance, actor visible, NOT in our hidden tracking
     * - inactive: enabled, has instance, actor not visible, NOT in our hidden tracking (self-hidden)
     * - hidden: enabled, has instance, in our hidden tracking (we hid it via actor.visible=false)
     */
    getSystemApplets() {
        let enabled = global.settings.get_strv('enabled-applets');
        let hidden = this.applet.disabledApplets || {};
        let pendingDisables = this._pendingDisables || {};
        let pendingEnables = this._pendingEnables || {};
        let result = { shown: [], inactive: [], hidden: [] };

        for (let uuid of SYSTEM_APPLET_UUIDS) {
            let isEnabled = enabled.some(e => e.includes(uuid));
            let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
            let instance = instances.length > 0 ? instances[0] : null;

            if (!isEnabled || !instance) continue;

            let entry = {
                uuid: uuid,
                name: uuid.split('@')[0],
                type: 'system-applet',
                instance: instance,
                iconName: this.getAppletIconName(instance)
            };

            // Pending changes override actual state while popup is open
            if (pendingDisables[uuid]) {
                entry.iconName = pendingDisables[uuid].iconName || entry.iconName;
                result.hidden.push(entry);
            } else if (pendingEnables[uuid]) {
                result.shown.push(entry);
            } else if (hidden[uuid]) {
                let saved = hidden[uuid];
                if (typeof saved === 'object' && saved.iconName) {
                    entry.iconName = saved.iconName;
                }
                result.hidden.push(entry);
            } else {
                let actorVisible = instance.actor && instance.actor.visible;
                if (actorVisible) {
                    result.shown.push(entry);
                } else {
                    result.inactive.push(entry);
                }
            }
        }
        return result;
    }

    /**
     * Get the icon name for a running applet instance.
     */
    getAppletIconName(appletInstance) {
        try {
            if (appletInstance._applet_icon && appletInstance._applet_icon.icon_name) {
                return appletInstance._applet_icon.icon_name;
            }
            let meta = appletInstance._meta || {};
            return meta.icon || 'application-x-executable';
        } catch(e) {
            return 'application-x-executable';
        }
    }

    /**
     * Create proxy icon buttons for system applets and add to popup sections.
     */
    populateSystemApplets() {
        let sysApplets = this.getSystemApplets();
        let cellSize = this.applet.icon_size + 8;

        for (let entry of sysApplets.shown) {
            let icon = new St.Icon({
                icon_name: entry.iconName,
                icon_size: this.applet.icon_size,
                icon_type: St.IconType.SYMBOLIC
            });
            let button = new St.Button({
                style_class: 'applet-box',
                child: icon,
                reactive: true,
                track_hover: true,
                width: cellSize,
                height: cellSize
            });
            button._systrayOverflowType = 'system-applet';
            button._systrayOverflowUuid = entry.uuid;
            this.applet._popup.visibleSection.add_child(button);
        }

        for (let entry of sysApplets.hidden) {
            let icon = new St.Icon({
                icon_name: entry.iconName,
                icon_size: this.applet.icon_size,
                icon_type: St.IconType.SYMBOLIC
            });
            let button = new St.Button({
                style_class: 'applet-box',
                child: icon,
                reactive: true,
                track_hover: true,
                width: cellSize,
                height: cellSize
            });
            button._systrayOverflowType = 'system-applet';
            button._systrayOverflowUuid = entry.uuid;
            this.applet._popup.overflowSection.add_child(button);
        }

        // Inactive system applets: enabled but self-hidden (nothing to report)
        for (let entry of sysApplets.inactive) {
            let icon = new St.Icon({
                icon_name: entry.iconName,
                icon_size: this.applet.icon_size,
                icon_type: St.IconType.SYMBOLIC
            });
            let button = new St.Button({
                style_class: 'applet-box',
                child: icon,
                reactive: true,
                track_hover: true,
                width: cellSize,
                height: cellSize,
                opacity: 128
            });
            button._systrayOverflowType = 'system-applet';
            button._systrayOverflowUuid = entry.uuid;
            this.applet._popup.inactiveSection.add_child(button);
        }

        // Show/hide the inactive section based on whether there are inactive applets
        if (this.applet._popup.inactiveLabel) {
            let hasInactive = sysApplets.inactive.length > 0;
            this.applet._popup.inactiveLabel.visible = hasInactive;
            this.applet._popup.inactiveSection.visible = hasInactive;
        }
    }

    /**
     * Remove system applet proxy icons from the popup sections.
     */
    depopulateSystemApplets() {
        for (let section of [this.applet._popup.visibleSection, this.applet._popup.overflowSection, this.applet._popup.inactiveSection]) {
            if (!section) continue;
            let children = section.get_children().slice();
            for (let child of children) {
                if (child._systrayOverflowType === 'system-applet') {
                    try {
                        section.remove_child(child);
                        child.destroy();
                    } catch (e) {
                        global.logWarning('systray-overflow: system applet destroy failed: ' + e);
                    }
                }
            }
        }
    }

    /**
     * Handle click on a system applet proxy icon: close popup, open native menu.
     */
    activateSystemApplet(uuid) {
        this.applet._popup.closePanel();
        let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
        if (instances.length > 0 && instances[0].menu) {
            instances[0].menu.open(true);
        }
    }

    /**
     * Find a system applet proxy button at the given stage coordinates.
     */
    findSystemAppletAtPos(x, y) {
        let source = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        while (source && source !== global.stage) {
            if (source._systrayOverflowType === 'system-applet') return source;
            source = source.get_parent();
        }
        return null;
    }

    /**
     * Record a pending hide for a system applet (applied on popup close).
     */
    pendingDisable(uuid) {
        let iconName = 'application-x-executable';
        let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
        if (instances.length > 0) {
            iconName = this.getAppletIconName(instances[0]);
        }

        this._pendingDisables[uuid] = { iconName: iconName };
        delete this._pendingEnables[uuid];
    }

    /**
     * Record a pending enable for a system applet (applied on popup close).
     */
    pendingEnable(uuid) {
        this._pendingEnables[uuid] = true;
        delete this._pendingDisables[uuid];
    }

    /**
     * Apply all pending system applet changes (visibility toggle).
     */
    applyPendingChanges() {
        let disables = this._pendingDisables || {};
        let enables = this._pendingEnables || {};
        this._pendingDisables = {};
        this._pendingEnables = {};

        for (let uuid in disables) {
            this.hideSystemApplet(uuid);
        }
        for (let uuid in enables) {
            this.showSystemApplet(uuid);
        }
    }

    /**
     * Hide a system applet by setting actor.visible = false.
     * The applet stays enabled and running — just invisible in the panel.
     */
    hideSystemApplet(uuid) {
        let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
        let iconName = 'application-x-executable';
        if (instances.length > 0) {
            iconName = this.getAppletIconName(instances[0]);
            instances[0].actor.visible = false;
        }
        let hidden = this.applet.disabledApplets || {};
        hidden[uuid] = { iconName: iconName };
        this.applet.settings.setValue('disabled-applets', hidden);
    }

    /**
     * Show a previously hidden system applet by restoring actor.visible = true.
     */
    showSystemApplet(uuid) {
        let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
        if (instances.length > 0) {
            instances[0].actor.visible = true;
        }
        let hidden = this.applet.disabledApplets || {};
        delete hidden[uuid];
        this.applet.settings.setValue('disabled-applets', hidden);
    }

    /**
     * Forward a scroll event to a system applet's scroll handler.
     */
    forwardScrollToSystemApplet(uuid, event) {
        let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
        if (instances.length > 0 && instances[0]._onScrollEvent) {
            instances[0]._onScrollEvent(instances[0].actor, event);
        }
    }

    /**
     * Restore hidden state on startup: hide any system applets tracked in settings.
     * Also migrates old dconf-disable format (entries with `entry` field) by
     * re-enabling via dconf first, then hiding via visibility.
     */
    restoreHiddenState() {
        let hidden = this.applet.disabledApplets || {};
        for (let uuid in hidden) {
            let saved = hidden[uuid];
            // Migrate old dconf-disable format: re-enable via dconf first
            if (typeof saved === 'object' && saved.entry) {
                let current = global.settings.get_strv('enabled-applets');
                if (!current.some(e => e.includes(uuid))) {
                    current.push(saved.entry);
                    global.settings.set_strv('enabled-applets', current);
                }
                // Update setting to new format (no entry field)
                hidden[uuid] = { iconName: saved.iconName || 'application-x-executable' };
            }
            let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
            if (instances.length > 0) {
                instances[0].actor.visible = false;
            }
        }
        this.applet.settings.setValue('disabled-applets', hidden);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SystemAppletProxy;
}
