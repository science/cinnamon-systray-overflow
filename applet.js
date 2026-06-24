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
const { DND_STATE } = helpers;
const IconRegistry = require('./icon-registry');
const SystemAppletProxy = require('./system-applet-proxy');
const DndHandler = require('./dnd-handler');
const PopupManager = require('./popup-manager');

const HORIZONTAL_STYLE = 'padding-left: 2px; padding-right: 2px; padding-top: 0; padding-bottom: 0';
const VERTICAL_STYLE = 'padding-left: 0; padding-right: 0; padding-top: 2px; padding-bottom: 2px';
const NO_RESIZE_ROLES = ['shutter', 'filezilla'];

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
        if (this.applet._popup.isOpen()) return;

        let iconId = null;
        for (let [id, managed] of this.applet._registry) {
            if (managed.protocol === 'xapp' && managed.xappIcon === this) {
                iconId = id;
                break;
            }
        }

        this.actor.visible = helpers.resolveVisibility(
            visible, iconId,
            this.applet.iconVisibility,
            this.applet.defaultVisibility
        );
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
        this.settings.bind('icon-visibility', 'iconVisibility', () => this._registry.redistributeIcons());
        this.settings.bind('icon-order', 'iconOrder', () => this._registry.redistributeIcons());
        this.settings.bind('default-visibility', 'defaultVisibility');
        this.settings.bind('disabled-applets', 'disabledApplets');

        // ── Unified icon tracking ──
        this._registry = new IconRegistry(this);

        // ── System applet proxy management ──
        this._sysProxy = new SystemAppletProxy(this);

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

        // ── Popup manager (extracted module) ──
        this._popup = new PopupManager(this);

        // ── DND handler (extracted module) ──
        this._dndHandler = new DndHandler(this);

        // ── Deferred icon removal during popup (Phase 1D) ──
        this._deferredXEmbedClear = false;
        this._pendingIconRemovals = [];

        // Create overflow UI (chevron + popup) — once, at init
        this._popup.ensureOverflowUI();
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

        // Restore hidden system applet state after other applets have loaded
        Mainloop.timeout_add(2000, () => {
            this._sysProxy.restoreHiddenState();
            return GLib.SOURCE_REMOVE;
        });
    }

    on_applet_reloaded() {
        global.trayReloading = true;
    }

    on_applet_removed_from_panel() {
        this._signalManager.disconnectAllSignals();

        // Close overflow popup
        this._popup.closePanel();
        this._popup.destroyOverflowUI();

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

        // Disconnect all visibility guards and periodic scan
        this._sysProxy.disconnectAllGuards();

        // Clear managed icons map
        this._registry.clear();

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
        for (let [id, managed] of this._registry) {
            if (managed.protocol === 'xembed') {
                let parent = managed.actor.get_parent();
                if (parent) {
                    parent.remove_child(managed.actor);
                }
                // The St.Bin button wraps the CinnamonTrayIcon
                managed.actor.destroy();
                this._registry.delete(id);
            }
        }
    }

    _onBeforeRedisplay() {
        // Defer during popup — clone sources would be destroyed mid-display
        if (this._popup.isOpen()) {
            this._deferredXEmbedClear = true;
            return;
        }
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
            this._registry.set(id, {
                id: id,
                protocol: 'xembed',
                actor: button,
                role: role
            });

            // Place in panel box (redistribute will sort later)
            this._panelBox.insert_child_at_index(button, 0);
            this._registry.redistributeIcons();
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
            if (!this._popup.isOpen()) {
                global.begin_modal(Meta.ModalOptions.POINTER_ALREADY_GRABBED, event.time);
            }
        } else if (etype === Clutter.EventType.ENTER) {
            button.add_style_pseudo_class('hover');
        } else if (etype === Clutter.EventType.LEAVE) {
            button.remove_style_pseudo_class('hover');
        }

        let ret = icon.handle_event(etype, event);

        if (etype === Clutter.EventType.BUTTON_PRESS) {
            if (!this._popup.isOpen()) {
                global.end_modal(event.time);
            }
        }

        return ret;
    }

    _onTrayIconRemoved(o, icon) {
        // Defer during popup — destroying clone source would crash
        if (this._popup.isOpen()) {
            this._pendingIconRemovals.push({ type: 'xembed', icon: icon });
            return;
        }

        const parent = icon.get_parent();

        // Remove from managed icons
        for (let [id, managed] of this._registry) {
            if (managed.protocol === 'xembed' && managed.actor.child === icon) {
                this._registry.delete(id);
                break;
            }
        }

        if (parent) {
            parent.remove_actor(icon);
            parent.destroy();
        }

        this._registry.redistributeIcons();
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
        while (this._registry.has(id)) {
            id = baseId + '_' + suffix;
            suffix++;
        }
        this._registry.set(id, {
            id: id,
            protocol: 'xapp',
            actor: statusIcon.actor,
            xappIcon: statusIcon,
            xappKey: key
        });

        this._panelBox.insert_child_at_index(statusIcon.actor, 0);
        this._registry.redistributeIcons();
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
        for (let [oldId, managed] of this._registry) {
            if (managed.protocol === 'xapp' && managed.xappKey === key) {
                if (oldId !== newId) {
                    // Re-key the entry
                    this._registry.delete(oldId);
                    managed.id = newId;
                    this._registry.set(newId, managed);
                    this._registry.redistributeIcons();
                }
                return;
            }
        }
    }

    _removeXAppIcon(icon_proxy) {
        // Defer during popup — destroying clone source would crash
        if (this._popup.isOpen()) {
            this._pendingIconRemovals.push({ type: 'xapp', proxy: icon_proxy });
            return;
        }

        let key = this._getXAppKey(icon_proxy);

        if (!this._xappStatusIcons[key]) {
            return;
        }

        let statusIcon = this._xappStatusIcons[key];

        // Remove from managed icons by finding the entry with matching xappKey
        for (let [id, managed] of this._registry) {
            if (managed.protocol === 'xapp' && managed.xappKey === key) {
                this._registry.delete(id);
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

        this._registry.redistributeIcons();
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

    // Popup methods are in popup-manager.js (this._popup)
}

function main(metadata, orientation, panel_height, instance_id) {
    return new SystrayOverflowApplet(orientation, panel_height, instance_id);
}
