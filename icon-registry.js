// icon-registry.js — Manages the unified icon tracking map
// Extracted from SystrayOverflowApplet for modularity.
//
// systray-overflow@cinnamon — GPL-2.0

var helpers = require('./helpers');

var IconRegistry = class IconRegistry {
    constructor(applet) {
        this.applet = applet;
        this._managedIcons = new Map(); // id -> { id, protocol, actor, xappIcon?, role?, xappKey? }
    }

    // ── Map delegation ──

    get(id) { return this._managedIcons.get(id); }
    set(id, entry) { this._managedIcons.set(id, entry); }
    delete(id) { this._managedIcons.delete(id); }
    has(id) { return this._managedIcons.has(id); }
    values() { return this._managedIcons.values(); }
    entries() { return this._managedIcons.entries(); }
    [Symbol.iterator]() { return this._managedIcons.entries(); }
    clear() { this._managedIcons.clear(); }
    get size() { return this._managedIcons.size; }

    // ── Icon classification & redistribution ──

    /**
     * Redistribute icons between panel (visible) and overflow (hidden).
     * While the popup is open, icons are shown as clones — don't move originals.
     */
    redistributeIcons() {
        // Guard: don't move icons while popup is open (clones reference them)
        if (this.applet._popup.isOpen()) return;

        let allIcons = Array.from(this._managedIcons.values());
        let { panel, overflow } = helpers.classifyIcons(
            allIcons,
            this.applet.iconVisibility || {},
            this.applet.defaultVisibility || 'panel',
            this.applet.iconOrder || []
        );

        // Move panel icons into _panelBox in order, set visible
        for (let i = 0; i < panel.length; i++) {
            let managed = panel[i];
            let parent = managed.actor.get_parent();
            if (parent && parent !== this.applet._panelBox) {
                parent.remove_child(managed.actor);
            }
            if (!managed.actor.get_parent()) {
                this.applet._panelBox.add_actor(managed.actor);
            }
            managed.actor.visible = true;
            this.applet._panelBox.set_child_at_index(managed.actor, i);
        }

        // Keep overflow icons in _panelBox but hidden (visible=false).
        for (let managed of overflow) {
            let parent = managed.actor.get_parent();
            if (parent && parent !== this.applet._panelBox) {
                parent.remove_child(managed.actor);
            }
            if (!managed.actor.get_parent()) {
                this.applet._panelBox.add_actor(managed.actor);
            }
            managed.actor.visible = false;
        }

        // Keep recording indicator at the end
        if (this.applet._recording_indicator) {
            this.applet._panelBox.set_child_at_index(this.applet._recording_indicator.actor, -1);
        }
    }

    /**
     * Update icon visibility preference and persist via settings.
     */
    setIconVisibility(iconId, visibility) {
        let prefs = this.applet.iconVisibility || {};
        prefs[iconId] = visibility;
        this.applet.settings.setValue('icon-visibility', prefs);
    }

    /**
     * Update icon order and persist via settings.
     */
    setIconOrder(orderArray) {
        this.applet.settings.setValue('icon-order', orderArray);
    }

    /**
     * Find which managed icon owns the given actor (or is an ancestor of it).
     * Also checks popup clones tagged with _managedIconRef.
     */
    findManagedIconForActor(actor) {
        for (let [id, managed] of this._managedIcons) {
            if (managed.actor === actor || managed.actor.contains(actor)) {
                return managed;
            }
        }
        // Check if actor is a popup clone (Clutter.Clone with _managedIconRef)
        let current = actor;
        while (current && current !== global.stage) {
            if (current._managedIconRef) return current._managedIconRef;
            current = current.get_parent();
        }
        return null;
    }

    /**
     * Get current panel icon IDs in order.
     */
    getPanelIconOrder() {
        let allIcons = Array.from(this._managedIcons.values());
        let { panel } = helpers.classifyIcons(
            allIcons,
            this.applet.iconVisibility || {},
            this.applet.defaultVisibility || 'panel',
            this.applet.iconOrder || []
        );
        return panel.map(i => i.id);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = IconRegistry;
}
