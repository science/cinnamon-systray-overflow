// applet.js — Unified system tray with overflow support
// Combines systray@cinnamon.org (XEmbed) and xapp-status@cinnamon.org (XApp)
// into a single applet with overflow popup for rarely-used icons.
//
// systray-overflow@cinnamon — GPL-2.0

const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Meta = imports.gi.Meta;
const XApp = imports.gi.XApp;
const Applet = imports.ui.applet;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const SignalManager = imports.misc.signalManager;
const Tooltips = imports.ui.tooltips;
const Settings = imports.ui.settings;

const helpers = require('./helpers');

const HORIZONTAL_STYLE = 'padding-left: 2px; padding-right: 2px; padding-top: 0; padding-bottom: 0';
const VERTICAL_STYLE = 'padding-left: 0; padding-right: 0; padding-top: 2px; padding-bottom: 2px';
const NO_RESIZE_ROLES = ['shutter', 'filezilla'];
const DRAG_THRESHOLD = 8;

// ─── XApp Status Icon Wrapper ───────────────────────────────────────────

class XAppStatusIcon {
    constructor(applet, proxy) {
        this.name = proxy.get_name();
        this.applet = applet;
        this.proxy = proxy;

        this.iconName = null;

        this.actor = new St.BoxLayout({
            style_class: 'applet-box',
            reactive: !global.settings.get_boolean('panel-edit-mode'),
            track_hover: true,
            x_expand: true,
            y_expand: true
        });

        this.icon_holder = new St.Bin();
        this.iconSize = this.applet.getPanelIconSize(St.IconType.FULLCOLOR);

        this.proxy.icon_size = this.iconSize;

        this.label = new St.Label({
            'y-align': St.Align.END,
        });

        this.actor.add_actor(this.icon_holder);
        this.actor.add_actor(this.label);

        this._tooltip = new Tooltips.PanelItemTooltip(this, '', applet.orientation);

        this.actor.connect('button-press-event', Lang.bind(this, this.onButtonPressEvent));
        this.actor.connect('button-release-event', Lang.bind(this, this.onButtonReleaseEvent));
        this.actor.connect('scroll-event', (...args) => this.onScrollEvent(...args));
        this.actor.connect('enter-event', Lang.bind(this, this.onEnterEvent));

        this._proxy_prop_change_id = this.proxy.connect('g-properties-changed', Lang.bind(this, this.on_properties_changed));

        this.refresh();
    }

    on_properties_changed(proxy, changed_props, invalidated_props) {
        let prop_names = changed_props.deep_unpack();

        if ('IconName' in prop_names) {
            this.setIconName(proxy.icon_name);
        }
        if ('TooltipText' in prop_names) {
            this.setTooltipText(proxy.tooltip_text);
        }
        if ('Label' in prop_names) {
            this.setLabel(proxy.label);
        }
        if ('Visible' in prop_names) {
            this.setVisible(proxy.visible);
        }
        if ('Name' in prop_names) {
            this.applet._updateXAppIconId(this.proxy);
            this.applet.sortXAppIcons();
        }
        if ('PrimaryMenuIsOpen' in prop_names) {
            if (!proxy.primary_menu_is_open) {
                this.actor.sync_hover();
            }
        }
        if ('SecondaryMenuIsOpen' in prop_names) {
            if (!proxy.secondary_menu_is_open) {
                this.actor.sync_hover();
            }
        }
    }

    refresh() {
        this.setIconName(this.proxy.icon_name);
        this.setLabel(this.proxy.label);
        this.setTooltipText(this.proxy.tooltip_text);
        this.setVisible(this.proxy.visible);
        this.setOrientation(this.applet.orientation);
        this.actor.queue_relayout();
    }

    setOrientation(orientation) {
        switch (orientation) {
            case St.Side.TOP:
            case St.Side.BOTTOM:
                this.actor.vertical = false;
                this.actor.remove_style_class_name('vertical');
                break;
            case St.Side.LEFT:
            case St.Side.RIGHT:
                this.actor.vertical = true;
                this.actor.add_style_class_name('vertical');
                break;
        }
    }

    setIconName(iconName) {
        if (iconName) {
            let type, icon;

            if (iconName.match(/symbolic/)) {
                type = St.IconType.SYMBOLIC;
            } else {
                type = St.IconType.FULLCOLOR;
            }

            this.iconName = iconName;
            this.iconSize = this.applet.getPanelIconSize(type);
            this.proxy.icon_size = this.iconSize;

            if (iconName.includes('/') && type != St.IconType.SYMBOLIC) {
                this.icon_loader_handle = St.TextureCache.get_default().load_image_from_file_async(
                    iconName,
                    this.actor.vertical ? this.iconSize : -1,
                    this.iconSize,
                    (...args) => this._onImageLoaded(...args)
                );
                return;
            } else {
                icon = new St.Icon({ 'icon-type': type, 'icon-size': this.iconSize, 'icon-name': iconName });
                this.icon_holder.show();
                this.icon_holder.child = icon;
            }
        } else {
            this.iconName = null;
            this.icon_holder.hide();
        }
    }

    _onImageLoaded(cache, handle, actor, data = null) {
        if (handle !== this.icon_loader_handle) {
            global.logError(`systray-overflow: Icon or image seems out of sync (${this.name})`);
            return;
        }
        this.icon_holder.child = actor;
        this.icon_holder.show();
    }

    setTooltipText(tooltipText) {
        if (tooltipText) {
            this._tooltip.preventShow = false;
        } else {
            tooltipText = '';
            this._tooltip.preventShow = true;
        }
        this._tooltip.set_markup(tooltipText);
        if (this._tooltip.visible) {
            this._tooltip.hide();
            this._tooltip.show();
        }
    }

    setLabel(label) {
        if (label) {
            this.label.set_text(label);
        } else {
            this.label.set_text('');
        }

        this.show_label = (this.applet.orientation == St.Side.TOP || this.applet.orientation == St.Side.BOTTOM) &&
                           this.proxy.label.length > 0;
        this.label.visible = this.show_label;
    }

    setVisible(visible) {
        if (visible) {
            this.actor.show();
        } else {
            this.actor.hide();
        }
    }

    onEnterEvent(actor, event) {
        this._tooltip.preventShow = false;
    }

    getEventPositionInfo(actor) {
        let allocation = Cinnamon.util_get_transformed_allocation(actor);

        let x = Math.round(allocation.x1 / global.ui_scale);
        let y = Math.round(allocation.y1 / global.ui_scale);
        let w = Math.round((allocation.x2 - allocation.x1) / global.ui_scale);
        let h = Math.round((allocation.y2 - allocation.y1) / global.ui_scale);

        let final_x, final_y, final_o;

        switch (this.applet.orientation) {
            case St.Side.TOP:
                final_x = x;
                final_y = y + h;
                final_o = Gtk.PositionType.TOP;
                break;
            case St.Side.BOTTOM:
            default:
                final_x = x;
                final_y = y;
                final_o = Gtk.PositionType.BOTTOM;
                break;
            case St.Side.LEFT:
                final_x = x + w;
                final_y = y;
                final_o = Gtk.PositionType.LEFT;
                break;
            case St.Side.RIGHT:
                final_x = x;
                final_y = y;
                final_o = Gtk.PositionType.RIGHT;
                break;
        }

        return [final_x, final_y, final_o];
    }

    onButtonPressEvent(actor, event) {
        this._tooltip.hide();
        this._tooltip.preventShow = true;

        // Ctrl+right-click passes through to applet context menu
        if (event.get_button() == Clutter.BUTTON_SECONDARY && event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
            return Clutter.EVENT_PROPAGATE;
        }

        let [x, y, o] = this.getEventPositionInfo(actor);
        this.proxy.call_button_press(x, y, event.get_button(), event.get_time(), o, null, null);
        return Clutter.EVENT_STOP;
    }

    onButtonReleaseEvent(actor, event) {
        let [x, y, o] = this.getEventPositionInfo(actor);
        this.proxy.call_button_release(x, y, event.get_button(), event.get_time(), o, null, null);
        return Clutter.EVENT_STOP;
    }

    onScrollEvent(actor, event) {
        let direction = event.get_scroll_direction();

        if (direction != Clutter.ScrollDirection.SMOOTH) {
            let x_dir = XApp.ScrollDirection.UP;
            let delta = 0;

            if (direction == Clutter.ScrollDirection.UP) {
                x_dir = XApp.ScrollDirection.UP;
                delta = -1;
            } else if (direction == Clutter.ScrollDirection.DOWN) {
                x_dir = XApp.ScrollDirection.DOWN;
                delta = 1;
            } else if (direction == Clutter.ScrollDirection.LEFT) {
                x_dir = XApp.ScrollDirection.LEFT;
                delta = -1;
            } else if (direction == Clutter.ScrollDirection.RIGHT) {
                x_dir = XApp.ScrollDirection.RIGHT;
                delta = 1;
            }

            this.proxy.call_scroll(delta, x_dir, event.get_time(), null, null);
        }

        return Clutter.EVENT_STOP;
    }

    destroy() {
        this.proxy.disconnect(this._proxy_prop_change_id);
        this._proxy_prop_change_id = 0;
        this._tooltip.destroy();
    }
}

// ─── Screen Recorder Icon ───────────────────────────────────────────────

class RecorderIcon {
    constructor(applet) {
        this.applet = applet;
        this.actor = new St.BoxLayout({
            style_class: 'applet-box',
            reactive: false,
            visible: false,
            x_expand: true,
            y_expand: true
        });

        this.icon_holder = new St.Bin();
        this.iconSize = this.applet.getPanelIconSize(St.IconType.FULLCOLOR);
        this.actor.add_actor(this.icon_holder);

        this._indicator = new St.DrawingArea();
        this._indicator.connect('repaint', (area) => this._paint(area));
        this.icon_holder.add_actor(this._indicator);

        this._recordListenerId = Main.screenRecorder.connect('recording', () => this._recordingStateChanged());
        this._recordingStateChanged();
    }

    _recordingStateChanged() {
        this.actor.visible = Main.screenRecorder.recording;
        this._indicator.queue_repaint();
    }

    _paint(area) {
        let [width, height] = area.get_surface_size();
        let size = Math.max(width, height);
        let node = area.get_theme_node();
        let border = node.get_foreground_color();

        let cr = area.get_context();
        let color = new Clutter.Color({ red: 255, green: 0, blue: 0, alpha: 255 });
        Clutter.cairo_set_source_color(cr, color);

        cr.arc(width / 2, height / 2, size / 4.0, 0.0, 2.0 * Math.PI);
        cr.fillPreserve();
        Clutter.cairo_set_source_color(cr, border);
        cr.stroke();
        cr.$dispose();
    }

    refresh() {
        this.setOrientation(this.applet.orientation);
        this._indicator.set_size(this.iconSize, this.iconSize);
        this._indicator.queue_repaint();
    }

    setOrientation(orientation) {
        switch (orientation) {
            case St.Side.TOP:
            case St.Side.BOTTOM:
                this.actor.vertical = false;
                this.actor.remove_style_class_name('vertical');
                break;
            case St.Side.LEFT:
            case St.Side.RIGHT:
                this.actor.vertical = true;
                this.actor.add_style_class_name('vertical');
                break;
        }
    }

    destroy() {
        if (this._recordListenerId > 0) {
            Main.screenRecorder.disconnect(this._recordListenerId);
            this._recordListenerId = 0;
        }
    }
}

// ─── Main Applet ────────────────────────────────────────────────────────

class SystrayOverflowApplet extends Applet.Applet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        this.actor.remove_style_class_name('applet-box');
        this.actor.set_style_class_name('systray');
        this.actor.set_important(true);

        this._signalManager = new SignalManager.SignalManager(null);
        this._scaleUpdateId = 0;

        this.orientation = orientation;
        this.icon_size = this.getPanelIconSize(St.IconType.FULLCOLOR) * global.ui_scale;

        // ── Settings ──
        this.settings = new Settings.AppletSettings(this, 'systray-overflow@cinnamon', instance_id);
        this.settings.bind('icon-visibility', 'iconVisibility', () => this._redistributeIcons());
        this.settings.bind('icon-order', 'iconOrder', () => this._redistributeIcons());
        this.settings.bind('default-visibility', 'defaultVisibility');

        // ── Unified icon tracking ──
        this._managedIcons = new Map(); // id -> { id, protocol, actor, xappIcon?, role? }

        // ── Panel box for visible icons ──
        let isVertical = [St.Side.LEFT, St.Side.RIGHT].includes(this.orientation);
        this._panelBox = new St.BoxLayout({
            vertical: isVertical,
            style: isVertical ? VERTICAL_STYLE : HORIZONTAL_STYLE
        });
        this.actor.add_actor(this._panelBox);

        // ── XApp protocol ──
        this._xappStatusIcons = {};
        this._ignoredProxies = {};
        this._xappMonitor = new XApp.StatusIconMonitor();
        this._recording_indicator = new RecorderIcon(this);
        this._panelBox.add_actor(this._recording_indicator.actor);

        // ── Overflow UI (lazy-created in Phase 2) ──
        this._overflowPanel = null;
        this._overflowPanelOpen = false;
        this._overflowIndicator = null;
        this._overflowGrid = null;
        this._overflowVisibleSection = null;
        this._overflowOverflowSection = null;
        this._capturedEventId = 0;
        this._overflowModalPushed = false;

        // ── DND state (Phase 3) ──
        this._dndActive = false;
        this._dndStartX = 0;
        this._dndStartY = 0;
        this._dndSource = null;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    on_applet_added_to_panel() {
        // XEmbed protocol — StatusIconDispatcher is singleton
        if (!global.trayReloading) {
            Main.statusIconDispatcher.start(this.actor.get_parent().get_parent());
        }
        this._updateTrayOrientation();

        // XEmbed signals
        this._signalManager.connect(Main.statusIconDispatcher, 'status-icon-added', this._onTrayIconAdded, this);
        this._signalManager.connect(Main.statusIconDispatcher, 'status-icon-removed', this._onTrayIconRemoved, this);
        this._signalManager.connect(Main.statusIconDispatcher, 'before-redisplay', this._onBeforeRedisplay, this);

        // XApp signals
        this._signalManager.connect(this._xappMonitor, 'icon-added', this._onXAppIconAdded, this);
        this._signalManager.connect(this._xappMonitor, 'icon-removed', this._onXAppIconRemoved, this);
        this._signalManager.connect(Gtk.IconTheme.get_default(), 'changed', this._onIconThemeChanged, this);

        // Shared signals
        this._signalManager.connect(Main.systrayManager, 'changed', this._onSystrayRolesChanged, this);
        this._signalManager.connect(global, 'scale-changed', this._uiScaleChanged, this);
        this._signalManager.connect(global.settings, 'changed::panel-edit-mode', this._onPanelEditModeChanged, this);
        this._signalManager.connect(this.panel, 'icon-size-changed', this._onIconSizeChanged, this);

        if (global.trayReloading) {
            global.trayReloading = false;
            Main.statusIconDispatcher.redisplay();
        }
    }

    on_applet_reloaded() {
        global.trayReloading = true;
    }

    on_applet_removed_from_panel() {
        this._signalManager.disconnectAllSignals();

        // Close overflow popup
        this._closeOverflowPanel();
        this._destroyOverflowUI();

        // Destroy XEmbed icons
        this._clearXEmbedIcons();

        // Destroy XApp icons
        for (let key in this._xappStatusIcons) {
            this._xappStatusIcons[key].destroy();
            delete this._xappStatusIcons[key];
        }
        for (let key in this._ignoredProxies) {
            delete this._ignoredProxies[key];
        }

        // Destroy recorder indicator
        if (this._recording_indicator) {
            this._recording_indicator.destroy();
            this._recording_indicator.actor.destroy();
            this._recording_indicator = null;
        }

        // Clear managed icons map
        this._managedIcons.clear();

        if (this._scaleUpdateId > 0) {
            Mainloop.source_remove(this._scaleUpdateId);
            this._scaleUpdateId = 0;
        }
    }

    on_applet_clicked(event) {
        // No-op — individual icons handle their own clicks
    }

    // ── Orientation & Size ──────────────────────────────────────────────

    on_orientation_changed(newOrientation) {
        this.orientation = newOrientation;

        let isVertical = (newOrientation == St.Side.LEFT || newOrientation == St.Side.RIGHT);
        this._panelBox.set_vertical(isVertical);
        this._panelBox.style = isVertical ? VERTICAL_STYLE : HORIZONTAL_STYLE;

        this._updateTrayOrientation();
        this._refreshXAppIcons();
    }

    _updateTrayOrientation() {
        switch (this.orientation) {
            case St.Side.LEFT:
            case St.Side.RIGHT:
                Main.statusIconDispatcher.set_tray_orientation(Clutter.Orientation.VERTICAL);
                break;
            case St.Side.TOP:
            case St.Side.BOTTOM:
            default:
                Main.statusIconDispatcher.set_tray_orientation(Clutter.Orientation.HORIZONTAL);
                break;
        }
    }

    _resizeXEmbedIcons() {
        this.icon_size = this.getPanelIconSize() * global.ui_scale;
        Main.statusIconDispatcher.redisplay();
    }

    on_panel_icon_size_changed(size) {
        this._resizeXEmbedIcons();
    }

    _onIconSizeChanged() {
        this._refreshXAppIcons();
    }

    _onIconThemeChanged() {
        this._refreshXAppIcons();
    }

    _onPanelEditModeChanged() {
        this._resizeXEmbedIcons();
        let reactive = !global.settings.get_boolean('panel-edit-mode');
        for (let key in this._xappStatusIcons) {
            this._xappStatusIcons[key].actor.reactive = reactive;
        }
    }

    _uiScaleChanged() {
        if (this._scaleUpdateId > 0) {
            Mainloop.source_remove(this._scaleUpdateId);
        }
        this._scaleUpdateId = Mainloop.timeout_add(1500, () => {
            this._resizeXEmbedIcons();
            this._refreshXAppIcons();
            this._scaleUpdateId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── XEmbed Protocol ─────────────────────────────────────────────────

    _clearXEmbedIcons() {
        // Remove XEmbed icons from managed set and destroy their buttons
        for (let [id, managed] of this._managedIcons) {
            if (managed.protocol === 'xembed') {
                let parent = managed.actor.get_parent();
                if (parent) {
                    parent.remove_child(managed.actor);
                }
                // The St.Bin button wraps the CinnamonTrayIcon
                managed.actor.destroy();
                this._managedIcons.delete(id);
            }
        }
    }

    _onBeforeRedisplay() {
        // XEmbed icons get destroyed and recreated on redisplay
        this._clearXEmbedIcons();
    }

    _onTrayIconAdded(o, icon, role) {
        try {
            let hiddenIcons = Main.systrayManager.getRoles();

            if (hiddenIcons.indexOf(role.toLowerCase()) != -1) {
                global.log('systray-overflow: Hiding systray: ' + role);
                return;
            }

            global.log('systray-overflow: Adding XEmbed icon: ' + role + ' (' + icon.get_width() + 'x' + icon.get_height() + 'px)');

            let button = new St.Bin({
                style_class: 'applet-box',
                child: icon
            });

            icon.set_x_align(Clutter.ActorAlign.CENTER);
            icon.set_y_align(Clutter.ActorAlign.FILL);
            button.set_y_align(Clutter.ActorAlign.FILL);

            icon.visible = false;
            icon.opacity = 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                if (icon.is_finalized()) {
                    button.destroy();
                    return GLib.SOURCE_REMOVE;
                }

                icon.reactive = true;
                icon.visible = true;
                icon.set_size(this.icon_size, this.icon_size);
                icon.ease({
                    opacity: 255,
                    duration: 400,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                icon.connect('event', (actor, event) => this._onXEmbedEvent(actor, event));
                return GLib.SOURCE_REMOVE;
            });

            // Register in managed icons map
            let id = role.toLowerCase();
            this._managedIcons.set(id, {
                id: id,
                protocol: 'xembed',
                actor: button,
                role: role
            });

            // Place in panel box (redistribute will sort later)
            this._panelBox.insert_child_at_index(button, 0);
            this._redistributeIcons();
        } catch (e) {
            global.logError(e);
        }
    }

    _onXEmbedEvent(icon, event) {
        let etype = event.type();
        const button = icon.get_parent();

        if (button == null) {
            return GLib.SOURCE_REMOVE;
        }

        if (etype === Clutter.EventType.BUTTON_PRESS) {
            // Guard against nesting with overflow popup's pushModal
            if (!this._overflowPanelOpen) {
                global.begin_modal(Meta.ModalOptions.POINTER_ALREADY_GRABBED, event.time);
            }
        } else if (etype === Clutter.EventType.ENTER) {
            button.add_style_pseudo_class('hover');
        } else if (etype === Clutter.EventType.LEAVE) {
            button.remove_style_pseudo_class('hover');
        }

        let ret = icon.handle_event(etype, event);

        if (etype === Clutter.EventType.BUTTON_PRESS) {
            if (!this._overflowPanelOpen) {
                global.end_modal(event.time);
            }
        }

        return ret;
    }

    _onTrayIconRemoved(o, icon) {
        const parent = icon.get_parent();

        // Remove from managed icons
        for (let [id, managed] of this._managedIcons) {
            if (managed.protocol === 'xembed' && managed.actor.child === icon) {
                this._managedIcons.delete(id);
                break;
            }
        }

        if (parent) {
            parent.remove_actor(icon);
            parent.destroy();
        }

        this._redistributeIcons();
    }

    // ── XApp Protocol ───────────────────────────────────────────────────

    _getXAppKey(icon_proxy) {
        let proxy_name = icon_proxy.get_name();
        let proxy_path = icon_proxy.get_object_path();
        return proxy_name + proxy_path;
    }

    _onXAppIconAdded(monitor, icon_proxy) {
        let key = this._getXAppKey(icon_proxy);

        if (this._xappStatusIcons[key]) {
            return;
        }

        if (this._shouldIgnoreStatusIcon(icon_proxy)) {
            global.log(`systray-overflow: Hiding XApp icon (applet exists): ${icon_proxy.name}`);
            this._ignoreStatusIcon(icon_proxy);
            return;
        }

        global.log(`systray-overflow: Adding XApp icon: ${icon_proxy.name} (${key})`);
        this._addXAppIcon(icon_proxy);
    }

    _onXAppIconRemoved(monitor, icon_proxy) {
        let key = this._getXAppKey(icon_proxy);

        if (!this._xappStatusIcons[key]) {
            if (this._ignoredProxies[key]) {
                delete this._ignoredProxies[key];
            }
            return;
        }

        global.log(`systray-overflow: Removing XApp icon: ${icon_proxy.name} (${key})`);
        this._removeXAppIcon(icon_proxy);
    }

    _addXAppIcon(icon_proxy) {
        let key = this._getXAppKey(icon_proxy);
        let statusIcon = new XAppStatusIcon(this, icon_proxy);

        this._xappStatusIcons[key] = statusIcon;

        // Register in managed icons map using name (with object path fallback).
        // If the base ID already exists, append a suffix to make it unique.
        let baseId = helpers.xappProxyToId(icon_proxy.name, icon_proxy.get_object_path());
        let id = baseId;
        let suffix = 2;
        while (this._managedIcons.has(id)) {
            id = baseId + '_' + suffix;
            suffix++;
        }
        this._managedIcons.set(id, {
            id: id,
            protocol: 'xapp',
            actor: statusIcon.actor,
            xappIcon: statusIcon,
            xappKey: key
        });

        this._panelBox.insert_child_at_index(statusIcon.actor, 0);
        this._redistributeIcons();
    }

    /**
     * Update a managed icon's ID when the XApp Name property changes.
     * Moves the entry in _managedIcons from old key to new key.
     */
    _updateXAppIconId(icon_proxy) {
        let newId = helpers.xappProxyToId(icon_proxy.name, icon_proxy.get_object_path());
        if (!newId) return;

        // Find the existing entry with matching xappKey
        let key = this._getXAppKey(icon_proxy);
        for (let [oldId, managed] of this._managedIcons) {
            if (managed.protocol === 'xapp' && managed.xappKey === key) {
                if (oldId !== newId) {
                    // Re-key the entry
                    this._managedIcons.delete(oldId);
                    managed.id = newId;
                    this._managedIcons.set(newId, managed);
                    this._redistributeIcons();
                }
                return;
            }
        }
    }

    _removeXAppIcon(icon_proxy) {
        let key = this._getXAppKey(icon_proxy);

        if (!this._xappStatusIcons[key]) {
            return;
        }

        let statusIcon = this._xappStatusIcons[key];

        // Remove from managed icons by finding the entry with matching xappKey
        for (let [id, managed] of this._managedIcons) {
            if (managed.protocol === 'xapp' && managed.xappKey === key) {
                this._managedIcons.delete(id);
                break;
            }
        }

        // Remove actor from wherever it is (panel box or overflow)
        let parent = statusIcon.actor.get_parent();
        if (parent) {
            parent.remove_child(statusIcon.actor);
        }

        statusIcon.destroy();
        delete this._xappStatusIcons[key];

        this._redistributeIcons();
    }

    _ignoreStatusIcon(icon_proxy) {
        let key = this._getXAppKey(icon_proxy);
        if (!this._ignoredProxies[key]) {
            this._ignoredProxies[key] = icon_proxy;
        }
    }

    _shouldIgnoreStatusIcon(icon_proxy) {
        let hiddenIcons = Main.systrayManager.getRoles();
        let name = icon_proxy.name.toLowerCase();
        return hiddenIcons.indexOf(name) != -1;
    }

    _onSystrayRolesChanged() {
        // Re-check XApp icons against systray manager roles
        for (let key in this._xappStatusIcons) {
            let icon_proxy = this._xappStatusIcons[key].proxy;
            if (this._shouldIgnoreStatusIcon(icon_proxy)) {
                global.log(`systray-overflow: Hiding XApp icon (applet added): ${icon_proxy.name}`);
                this._removeXAppIcon(icon_proxy);
                this._ignoreStatusIcon(icon_proxy);
            }
        }

        for (let key in this._ignoredProxies) {
            let icon_proxy = this._ignoredProxies[key];
            if (!this._shouldIgnoreStatusIcon(icon_proxy)) {
                delete this._ignoredProxies[key];
                global.log(`systray-overflow: Restoring XApp icon: ${icon_proxy.name}`);
                this._addXAppIcon(icon_proxy);
            }
        }

        // Also trigger XEmbed redisplay for role changes
        Main.statusIconDispatcher.redisplay();
    }

    sortXAppIcons() {
        // Sort XApp icons within the panel box
        let icon_list = [];
        for (let key in this._xappStatusIcons) {
            icon_list.push(this._xappStatusIcons[key]);
        }

        icon_list.sort((a, b) => {
            let asym = a.proxy.icon_name && a.proxy.icon_name.includes('-symbolic');
            let bsym = b.proxy.icon_name && b.proxy.icon_name.includes('-symbolic');

            if (asym && !bsym) return 1;
            if (bsym && !asym) return -1;

            return GLib.utf8_collate(
                a.proxy.name.replace('org.x.StatusIcon.', '').toLowerCase(),
                b.proxy.name.replace('org.x.StatusIcon.', '').toLowerCase()
            );
        });

        icon_list.reverse();

        for (let icon of icon_list) {
            let parent = icon.actor.get_parent();
            if (parent === this._panelBox) {
                this._panelBox.set_child_at_index(icon.actor, 0);
            }
        }

        if (this._recording_indicator) {
            this._panelBox.set_child_at_index(this._recording_indicator.actor, -1);
        }
    }

    _refreshXAppIcons() {
        for (let key in this._xappStatusIcons) {
            this._xappStatusIcons[key].refresh();
        }
        if (this._recording_indicator) {
            this._recording_indicator.refresh();
        }
    }

    // ── Icon Classification & Redistribution ────────────────────────────

    _redistributeIcons() {
        let allIcons = Array.from(this._managedIcons.values());
        let { panel, overflow } = helpers.classifyIcons(
            allIcons,
            this.iconVisibility || {},
            this.defaultVisibility || 'panel',
            this.iconOrder || []
        );

        // Move panel icons into _panelBox in order
        for (let i = 0; i < panel.length; i++) {
            let managed = panel[i];
            let parent = managed.actor.get_parent();
            if (parent && parent !== this._panelBox) {
                parent.remove_child(managed.actor);
            }
            if (!managed.actor.get_parent()) {
                this._panelBox.add_actor(managed.actor);
            }
            this._panelBox.set_child_at_index(managed.actor, i);
        }

        // Remove overflow icons from panel box (they should not be visible there).
        // If the overflow container exists, move them there; otherwise just remove.
        for (let managed of overflow) {
            let parent = managed.actor.get_parent();
            if (parent === this._panelBox) {
                this._panelBox.remove_child(managed.actor);
            }
            if (this._overflowOverflowSection) {
                if (managed.actor.get_parent() && managed.actor.get_parent() !== this._overflowOverflowSection) {
                    managed.actor.get_parent().remove_child(managed.actor);
                }
                if (!managed.actor.get_parent()) {
                    this._overflowOverflowSection.add_actor(managed.actor);
                }
            }
        }

        // Keep recording indicator at the end
        if (this._recording_indicator) {
            this._panelBox.set_child_at_index(this._recording_indicator.actor, -1);
        }

        // Always show chevron so users can open popup and drag icons to overflow
        this._ensureOverflowUI();
        if (this._overflowIndicator) {
            this._overflowIndicator.show();
        }
    }

    // ── Overflow UI ─────────────────────────────────────────────────────

    _ensureOverflowUI() {
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
            icon_size: Math.round(this.icon_size * 0.75),
            icon_type: St.IconType.SYMBOLIC
        });
        this._overflowIndicator.set_child(chevronIcon);
        this._overflowIndicator.connect('clicked', () => this._toggleOverflowPanel());
        this.actor.add(this._overflowIndicator);

        // Overflow popup panel on global.stage
        this._overflowPanel = new St.Bin({
            style_class: 'menu systray-overflow-panel',
            important: true,
            reactive: true,
            visible: false
        });

        // Inner container with two sections
        let innerBox = new St.BoxLayout({ vertical: true, style: 'spacing: 6px;' });

        // "Shown" section — tray icons visible in the panel
        let visibleLabel = new St.Label({
            text: 'Shown',
            style_class: 'systray-overflow-section-label'
        });
        this._overflowVisibleSection = new St.BoxLayout({
            style_class: 'systray-overflow-icon-grid',
            style: 'spacing: 4px;'
        });

        // "Hidden" section — tray icons in overflow (click chevron to access)
        let overflowLabel = new St.Label({
            text: 'Hidden',
            style_class: 'systray-overflow-section-label'
        });
        this._overflowOverflowSection = new St.BoxLayout({
            style_class: 'systray-overflow-icon-grid',
            style: 'spacing: 4px;'
        });

        innerBox.add_actor(visibleLabel);
        innerBox.add_actor(this._overflowVisibleSection);
        innerBox.add_actor(overflowLabel);
        innerBox.add_actor(this._overflowOverflowSection);

        this._overflowPanel.set_child(innerBox);
        this._overflowPanel._delegate = this;

        // Note: button/motion events are routed from _onOverflowCapturedEvent
        // because pushModal prevents events from reaching the panel's own
        // signal handlers.

        global.stage.add_child(this._overflowPanel);
    }

    _destroyOverflowUI() {
        if (this._overflowPanelOpen) this._closeOverflowPanel();
        if (this._overflowPanel) {
            global.stage.remove_child(this._overflowPanel);
            this._overflowPanel.destroy();
            this._overflowPanel = null;
        }
        this._overflowVisibleSection = null;
        this._overflowOverflowSection = null;
        if (this._overflowIndicator) {
            this.actor.remove_child(this._overflowIndicator);
            this._overflowIndicator.destroy();
            this._overflowIndicator = null;
        }
        this._overflowPanelOpen = false;
    }

    _toggleOverflowPanel() {
        if (this._overflowPanelOpen)
            this._closeOverflowPanel();
        else
            this._openOverflowPanel();
    }

    _openOverflowPanel() {
        if (!this._overflowPanel || this._overflowPanelOpen) return;

        this._overflowPanelOpen = true;

        // Populate overflow popup with clones/references of icons
        this._populateOverflowPopup();

        // Constrain panel to preferred size
        let [, pw] = this._overflowPanel.get_preferred_width(-1);
        let [, ph] = this._overflowPanel.get_preferred_height(pw);
        this._overflowPanel.set_width(pw);
        this._overflowPanel.set_height(ph);

        let [x, y] = this._calcOverflowPanelPosition();
        this._overflowPanel.set_position(x, y);
        this._overflowPanel.show();
        this._overflowPanel.raise_top();

        // Update chevron direction
        if (this._overflowIndicator) {
            let icon = this._overflowIndicator.get_child();
            if (icon) icon.icon_name = 'pan-up-symbolic';
        }

        // Modal input routing — may fail in SPICE/VNC viewers due to
        // X-level grab. The popup still works via captured-event routing.
        this._overflowModalPushed = Main.pushModal(this._overflowPanel);
        if (!this._overflowModalPushed) {
            global.log('systray-overflow: pushModal failed (SPICE/VNC grab?), using captured-event only');
        }

        // Click-outside / Escape detection
        this._capturedEventId = global.stage.connect('captured-event',
            (stage, event) => this._onOverflowCapturedEvent(event));
    }

    _closeOverflowPanel() {
        if (!this._overflowPanel || !this._overflowPanelOpen) return;

        // Mark closed immediately to prevent re-entrant calls
        this._overflowPanelOpen = false;

        // Reset DND state
        if (this._dndSource) {
            this._dndSource.actor.opacity = 255;
            this._dndSource = null;
        }
        this._dndDragging = false;
        this._destroyDndClone();
        this._clearDropHighlight();

        // Disconnect captured-event BEFORE popModal
        if (this._capturedEventId) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }

        if (this._overflowModalPushed) {
            Main.popModal(this._overflowPanel);
            this._overflowModalPushed = false;
        }

        // Move icons back to their proper containers before hiding
        this._depopulateOverflowPopup();

        this._overflowPanel.hide();

        // Update chevron direction
        if (this._overflowIndicator) {
            let icon = this._overflowIndicator.get_child();
            if (icon) icon.icon_name = 'pan-down-symbolic';
        }
    }

    _populateOverflowPopup() {
        // Show all icons in the popup organized by section
        // Panel icons go in the visible section, overflow icons in the overflow section
        let allIcons = Array.from(this._managedIcons.values());
        let { panel, overflow } = helpers.classifyIcons(
            allIcons,
            this.iconVisibility || {},
            this.defaultVisibility || 'panel',
            this.iconOrder || []
        );

        // Reparent panel icons into visible section
        for (let managed of panel) {
            let parent = managed.actor.get_parent();
            if (parent) parent.remove_child(managed.actor);
            this._overflowVisibleSection.add_actor(managed.actor);
        }

        // Overflow icons should already be in overflow section from _redistributeIcons,
        // but ensure they are
        for (let managed of overflow) {
            let parent = managed.actor.get_parent();
            if (parent && parent !== this._overflowOverflowSection) {
                parent.remove_child(managed.actor);
            }
            if (!managed.actor.get_parent()) {
                this._overflowOverflowSection.add_actor(managed.actor);
            }
        }
    }

    _depopulateOverflowPopup() {
        // Move icons back to their proper homes
        this._redistributeIcons();
    }

    _calcOverflowPanelPosition() {
        let alloc = Cinnamon.util_get_transformed_allocation(this.actor);
        let monitor = Main.layoutManager.findMonitorForActor(this.actor);

        let [, pw] = this._overflowPanel.get_preferred_width(-1);
        let [, ph] = this._overflowPanel.get_preferred_height(pw);

        let orientStr = (this.orientation === St.Side.TOP) ? 'top' : 'bottom';
        return helpers.calcOverflowPanelPosition(
            { x1: alloc.x1, y1: alloc.y1, x2: alloc.x2, y2: alloc.y2 },
            { width: pw, height: ph },
            monitor,
            orientStr
        );
    }

    _isInsideActor(x, y, actor) {
        if (!actor) return false;
        let [ax, ay] = actor.get_transformed_position();
        let [aw, ah] = actor.get_transformed_size();
        return (x >= ax && x <= ax + aw && y >= ay && y <= ay + ah);
    }

    _onOverflowCapturedEvent(event) {
        let type = event.type();

        // Escape key closes
        if (type === Clutter.EventType.KEY_PRESS) {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._closeOverflowPanel();
                return Clutter.EVENT_STOP;
            }
        }

        // Route button and motion events through the popup handlers.
        // pushModal prevents events from reaching the panel's own signal
        // handlers, so we dispatch directly from captured-event.
        if (type === Clutter.EventType.BUTTON_PRESS) {
            let [ex, ey] = event.get_coords();

            let insidePanel = this._isInsideActor(ex, ey, this._overflowPanel);
            let insideChevron = this._isInsideActor(ex, ey, this._overflowIndicator);

            if (insideChevron) {
                this._closeOverflowPanel();
                return Clutter.EVENT_STOP;
            }

            if (insidePanel) {
                return this._onPopupButtonPress(this._overflowPanel, event);
            }

            // Click outside closes
            this._closeOverflowPanel();
            return Clutter.EVENT_STOP;
        }

        if (type === Clutter.EventType.BUTTON_RELEASE) {
            let [ex, ey] = event.get_coords();
            let insidePanel = this._isInsideActor(ex, ey, this._overflowPanel);
            if (insidePanel || this._dndSource) {
                return this._onPopupButtonRelease(this._overflowPanel, event);
            }
        }

        if (type === Clutter.EventType.MOTION) {
            if (this._dndSource) {
                return this._onPopupMotion(this._overflowPanel, event);
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }

    // ── DND (Phase 3) ───────────────────────────────────────────────────

    _setIconVisibility(iconId, visibility) {
        let prefs = this.iconVisibility || {};
        prefs[iconId] = visibility;
        this.settings.setValue('icon-visibility', prefs);
    }

    _setIconOrder(orderArray) {
        this.settings.setValue('icon-order', orderArray);
    }

    /**
     * Find which managed icon owns the given actor (or is an ancestor of it).
     * Returns the managed icon entry or null.
     */
    _findManagedIconForActor(actor) {
        for (let [id, managed] of this._managedIcons) {
            if (managed.actor === actor || managed.actor.contains(actor)) {
                return managed;
            }
        }
        return null;
    }

    /**
     * Find which section an actor belongs to: "panel" or "overflow" or null.
     */
    _findActorSection(actor) {
        if (this._overflowVisibleSection && this._overflowVisibleSection.contains(actor)) {
            return 'panel';
        }
        if (this._overflowOverflowSection && this._overflowOverflowSection.contains(actor)) {
            return 'overflow';
        }
        return null;
    }

    /**
     * Handle button-press in the overflow popup.
     * Records the press position and source icon for deferred forwarding.
     */
    _onPopupButtonPress(actor, event) {
        let [x, y] = event.get_coords();
        let source = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        let managed = this._findManagedIconForActor(source);

        if (!managed) return Clutter.EVENT_PROPAGATE;

        this._dndActive = false;
        this._dndStartX = x;
        this._dndStartY = y;
        this._dndSource = managed;
        this._dndSourceSection = this._findActorSection(managed.actor);
        this._dndPressEvent = event;
        this._dndDragging = false;

        // Don't forward yet — wait to see if this becomes a drag
        return Clutter.EVENT_STOP;
    }

    /**
     * Handle motion in the overflow popup during a potential drag.
     * If movement exceeds threshold, start visual drag feedback.
     */
    _onPopupMotion(actor, event) {
        if (!this._dndSource) return Clutter.EVENT_PROPAGATE;

        let [x, y] = event.get_coords();

        if (!this._dndDragging) {
            if (helpers.exceedsDragThreshold(this._dndStartX, this._dndStartY, x, y, DRAG_THRESHOLD)) {
                this._dndDragging = true;
                // Visual feedback: make source semi-transparent and create drag clone
                this._dndSource.actor.opacity = 128;
                this._createDndClone(this._dndSource.actor, x, y);
            }
        }

        if (this._dndDragging) {
            this._updateDropHighlight(x, y);
            this._positionDndClone(x, y);
        }

        return Clutter.EVENT_STOP;
    }

    /**
     * Handle button-release in the overflow popup.
     * If drag was active: handle the drop (promote/demote/reorder).
     * If no drag: forward as a normal click to the icon.
     */
    _onPopupButtonRelease(actor, event) {
        if (!this._dndSource) return Clutter.EVENT_PROPAGATE;

        let managed = this._dndSource;
        let wasDragging = this._dndDragging;

        // Reset drag state
        managed.actor.opacity = 255;
        this._destroyDndClone();
        this._clearDropHighlight();
        this._dndSource = null;
        this._dndDragging = false;

        if (wasDragging) {
            // Handle the drop
            let [x, y] = event.get_coords();
            this._handleDrop(managed, x, y);
            return Clutter.EVENT_STOP;
        } else {
            // Forward as normal click — close the popup first, then let the
            // icon handle the event naturally. For XApp icons, we call
            // the proxy methods directly. For XEmbed, we use handle_event.
            this._closeOverflowPanel();

            if (managed.protocol === 'xapp' && managed.xappIcon) {
                let xappIcon = managed.xappIcon;
                let [px, py, po] = xappIcon.getEventPositionInfo(managed.actor);
                let button = event.get_button();
                let time = event.get_time();
                xappIcon.proxy.call_button_press(px, py, button, time, po, null, null);
                xappIcon.proxy.call_button_release(px, py, button, time, po, null, null);
            } else if (managed.protocol === 'xembed') {
                // For XEmbed, forward the original press + this release
                let icon = managed.actor.child;
                if (icon && !icon.is_finalized()) {
                    let etype = event.type();
                    icon.handle_event(Clutter.EventType.BUTTON_PRESS, this._dndPressEvent || event);
                    icon.handle_event(etype, event);
                }
            }
            this._dndPressEvent = null;
            return Clutter.EVENT_STOP;
        }
    }

    /**
     * Process a drop after DND: promote, demote, or reorder.
     */
    _handleDrop(managed, dropX, dropY) {
        let targetSection = this._getDropSection(dropX, dropY);
        let sourceSection = this._dndSourceSection || 'panel';

        if (targetSection === sourceSection && targetSection === 'panel') {
            // Reorder within panel section
            let panelIcons = this._getPanelIconOrder();
            let bounds = this._getSectionIconBounds(this._overflowVisibleSection);
            // Convert drop coords to section-relative
            let [sx, sy] = this._overflowVisibleSection.get_transformed_position();
            let relX = dropX - sx;
            let relY = dropY - sy;
            let newIndex = helpers.findClosestIconIndex(bounds, relX, relY);
            let newOrder = helpers.reorderIcon(panelIcons, managed.id, newIndex);
            this._setIconOrder(newOrder);
        } else if (targetSection !== sourceSection) {
            // Move between sections: promote or demote
            this._setIconVisibility(managed.id, targetSection);

            // If promoting to panel, add to icon-order
            if (targetSection === 'panel') {
                let order = this.iconOrder || [];
                if (!order.includes(managed.id)) {
                    order.push(managed.id);
                    this._setIconOrder(order);
                }
            }
        }
        // _redistributeIcons will be triggered by settings change callback
    }

    /**
     * Determine which section a drop coordinate falls in.
     */
    _getDropSection(x, y) {
        if (!this._overflowOverflowSection) return 'panel';

        let [, oy] = this._overflowOverflowSection.get_transformed_position();
        return y >= oy ? 'overflow' : 'panel';
    }

    /**
     * Get current panel icon IDs in order.
     */
    _getPanelIconOrder() {
        let allIcons = Array.from(this._managedIcons.values());
        let { panel } = helpers.classifyIcons(
            allIcons,
            this.iconVisibility || {},
            this.defaultVisibility || 'panel',
            this.iconOrder || []
        );
        return panel.map(i => i.id);
    }

    /**
     * Get bounding boxes of icons in a section container (section-relative coords).
     */
    _getSectionIconBounds(section) {
        if (!section) return [];
        let children = section.get_children();
        let bounds = [];
        for (let child of children) {
            if (!child.visible) continue;
            let alloc = child.get_allocation_box();
            bounds.push({
                x: alloc.x1,
                y: alloc.y1,
                width: alloc.x2 - alloc.x1,
                height: alloc.y2 - alloc.y1
            });
        }
        return bounds;
    }

    /**
     * Create a clone of the dragged icon that follows the cursor.
     */
    _createDndClone(sourceActor, x, y) {
        this._destroyDndClone();
        this._dndClone = new Clutter.Clone({ source: sourceActor });
        this._dndClone.set_opacity(200);
        global.stage.add_child(this._dndClone);
        this._dndClone.raise_top();
        this._positionDndClone(x, y);
    }

    /**
     * Position the drag clone centered on the cursor.
     */
    _positionDndClone(x, y) {
        if (!this._dndClone) return;
        let [w, h] = this._dndClone.get_size();
        this._dndClone.set_position(Math.round(x - w / 2), Math.round(y - h / 2));
    }

    /**
     * Remove the drag clone from the stage.
     */
    _destroyDndClone() {
        if (this._dndClone) {
            if (this._dndClone.get_parent()) {
                this._dndClone.get_parent().remove_child(this._dndClone);
            }
            this._dndClone.destroy();
            this._dndClone = null;
        }
    }

    /**
     * Update visual highlight to indicate which section is the drop target.
     */
    _updateDropHighlight(x, y) {
        this._clearDropHighlight();
        let section = this._getDropSection(x, y);
        if (section === 'panel' && this._overflowVisibleSection) {
            this._overflowVisibleSection.add_style_class_name('systray-overflow-drop-highlight');
        } else if (section === 'overflow' && this._overflowOverflowSection) {
            this._overflowOverflowSection.add_style_class_name('systray-overflow-drop-highlight');
        }
    }

    /**
     * Remove drop highlight from both sections.
     */
    _clearDropHighlight() {
        if (this._overflowVisibleSection) {
            this._overflowVisibleSection.remove_style_class_name('systray-overflow-drop-highlight');
        }
        if (this._overflowOverflowSection) {
            this._overflowOverflowSection.remove_style_class_name('systray-overflow-drop-highlight');
        }
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new SystrayOverflowApplet(orientation, panel_height, instance_id);
}
