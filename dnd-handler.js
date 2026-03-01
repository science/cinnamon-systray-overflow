// dnd-handler.js — Manages drag-and-drop within the overflow popup
// Extracted from SystrayOverflowApplet for modularity.
//
// systray-overflow@cinnamon — GPL-2.0

var Clutter = imports.gi.Clutter;

var helpers = require('./helpers');
var DND_STATE = helpers.DND_STATE;
var dndTransition = helpers.dndTransition;

var DRAG_THRESHOLD = 8;

var DndHandler = class DndHandler {
    constructor(applet) {
        this.applet = applet;
        this._dnd = { state: DND_STATE.IDLE };
        this._dndClone = null;
    }

    /**
     * Current DND state.
     */
    get state() {
        return this._dnd.state;
    }

    /**
     * Whether a drag is in progress.
     */
    isDragging() {
        return this._dnd.state === DND_STATE.DRAGGING;
    }

    /**
     * Whether a press/drag is active (not idle).
     */
    isActive() {
        return this._dnd.state !== DND_STATE.IDLE;
    }

    /**
     * The source section of the current DND operation.
     */
    get sourceSection() {
        return this._dnd.sourceSection || null;
    }

    /**
     * Reset DND to IDLE state. Restores opacity, destroys clone, clears highlights.
     */
    reset() {
        if (this._dnd.popupActor) {
            this._dnd.popupActor.opacity = 255;
        }
        this._destroyDndClone();
        this._clearDropHighlight();
        this._dnd = { state: DND_STATE.IDLE };
    }

    /**
     * Find which section an actor belongs to: "panel", "overflow", "inactive", or null.
     */
    findActorSection(actor) {
        if (this.applet._popup.visibleSection && this.applet._popup.visibleSection.contains(actor)) {
            return 'panel';
        }
        if (this.applet._popup.overflowSection && this.applet._popup.overflowSection.contains(actor)) {
            return 'overflow';
        }
        if (this.applet._popup.inactiveSection && this.applet._popup.inactiveSection.contains(actor)) {
            return 'inactive';
        }
        return null;
    }

    /**
     * Handle button-press in the overflow popup.
     * Records the press position and source icon for deferred forwarding.
     */
    onButtonPress(actor, event) {
        // Validate state transition: must be in IDLE
        let transition = dndTransition(this._dnd.state, 'press');
        if (!transition.valid) return Clutter.EVENT_PROPAGATE;

        let [x, y] = event.get_coords();

        // Check for system applet proxy first
        let sysButton = this.applet._sysProxy.findSystemAppletAtPos(x, y);
        if (sysButton) {
            // Block DND on inactive section icons (Phase 1B)
            let sysSection = this.findActorSection(sysButton);
            if (sysSection === 'inactive') return Clutter.EVENT_STOP;

            this._dnd = {
                state: DND_STATE.PRESSED,
                startX: x,
                startY: y,
                source: {
                    actor: sysButton,
                    id: 'sysapplet:' + sysButton._systrayOverflowUuid,
                    protocol: 'system-applet',
                    _systrayOverflowType: 'system-applet',
                    _systrayOverflowUuid: sysButton._systrayOverflowUuid
                },
                popupActor: sysButton,
                sourceSection: sysSection,
                pressEvent: event
            };
            return Clutter.EVENT_STOP;
        }

        let source = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        let managed = this.applet._registry.findManagedIconForActor(source);

        if (!managed) return Clutter.EVENT_PROPAGATE;

        // Find the popup actor (may be a clone or the actual actor)
        let popupActor = source;
        while (popupActor && popupActor !== global.stage) {
            if (popupActor._managedIconRef || popupActor === managed.actor) break;
            popupActor = popupActor.get_parent();
        }

        this._dnd = {
            state: DND_STATE.PRESSED,
            startX: x,
            startY: y,
            source: managed,
            popupActor: popupActor,
            sourceSection: this.findActorSection(popupActor),
            pressEvent: event
        };

        // Don't forward yet — wait to see if this becomes a drag
        return Clutter.EVENT_STOP;
    }

    /**
     * Handle motion in the overflow popup during a potential drag.
     * If movement exceeds threshold, start visual drag feedback.
     */
    onMotion(actor, event) {
        if (this._dnd.state !== DND_STATE.PRESSED && this._dnd.state !== DND_STATE.DRAGGING) {
            return Clutter.EVENT_PROPAGATE;
        }

        let [x, y] = event.get_coords();

        if (this._dnd.state === DND_STATE.PRESSED) {
            if (helpers.exceedsDragThreshold(this._dnd.startX, this._dnd.startY, x, y, DRAG_THRESHOLD)) {
                let transition = dndTransition(this._dnd.state, 'threshold-exceeded');
                if (transition.valid) {
                    this._dnd.state = DND_STATE.DRAGGING;
                    // Visual feedback: dim the popup actor and create drag clone
                    let popupActor = this._dnd.popupActor || this._dnd.source.actor;
                    popupActor.opacity = 128;
                    this._createDndClone(popupActor, x, y);
                }
            }
        }

        if (this._dnd.state === DND_STATE.DRAGGING) {
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
    onButtonRelease(actor, event) {
        let transition = dndTransition(this._dnd.state, 'release');
        if (!transition.valid) return Clutter.EVENT_PROPAGATE;

        let managed = this._dnd.source;
        let popupActor = this._dnd.popupActor || managed.actor;
        let pressEvent = this._dnd.pressEvent;
        let sourceSection = this._dnd.sourceSection;  // capture before reset
        let isClone = !!popupActor._managedIconRef; // true for Shown section clones

        // Reset to IDLE
        popupActor.opacity = 255;
        this._destroyDndClone();
        this._clearDropHighlight();
        let wasAction = transition.action; // 'drop' or 'click'
        this._dnd = { state: DND_STATE.IDLE };

        if (wasAction === 'drop') {
            // Handle the drop
            let [x, y] = event.get_coords();
            this._handleDrop(managed, x, y, sourceSection);
            return Clutter.EVENT_STOP;
        } else {
            // System applet proxy: close popup, open native applet menu
            if (managed.protocol === 'system-applet') {
                this.applet._sysProxy.activateSystemApplet(managed._systrayOverflowUuid);
                return Clutter.EVENT_STOP;
            }

            // Determine section from clone's parent container
            let isShownSection = isClone && popupActor.get_parent() === this.applet._popup.visibleSection;

            // Shown section clone click: just close popup — icon is accessible in the panel
            if (isShownSection) {
                this.applet._popup.closePanel();
                return Clutter.EVENT_STOP;
            }

            // Hidden section clone click: close popup, forward click to managed.actor
            this.applet._popup.closePanel();

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
                    icon.handle_event(Clutter.EventType.BUTTON_PRESS, pressEvent || event);
                    icon.handle_event(etype, event);
                }
            }
            return Clutter.EVENT_STOP;
        }
    }

    /**
     * Process a drop after DND: promote, demote, or reorder.
     */
    _handleDrop(managed, dropX, dropY, sourceSection) {
        let targetSection = this._getDropSection(dropX, dropY);

        // System applet DND: record pending change (apply on popup close)
        // Deferring avoids cascading effects: dconf change → applet unload →
        // systray role change → XEmbed clear/readd → clone source destroyed
        if (managed.protocol === 'system-applet') {
            let uuid = managed._systrayOverflowUuid;
            if (targetSection !== sourceSection) {
                if (targetSection === 'overflow') {
                    // Dragged to Hidden: disable (works from Shown or Inactive)
                    this.applet._sysProxy.pendingDisable(uuid);
                } else if (targetSection === 'panel' && sourceSection === 'overflow') {
                    // Dragged from Hidden to Shown: re-enable
                    this.applet._sysProxy.pendingEnable(uuid);
                }
                // Dragged from Inactive to Shown: no-op (already enabled, just self-hidden)
                // Refresh popup to reflect the visual change
                if (this.applet._popup.isOpen()) {
                    this.applet._popup.depopulatePopup();
                    this.applet._popup.populatePopup();
                    this.applet._popup.resizePopup();
                }
            }
            return;
        }

        if (targetSection === sourceSection && targetSection === 'panel') {
            // Reorder within panel section
            let panelIcons = this.applet._registry.getPanelIconOrder();
            let bounds = this.getSectionIconBounds(this.applet._popup.visibleSection);
            // Convert drop coords to section-relative
            let [sx, sy] = this.applet._popup.visibleSection.get_transformed_position();
            let relX = dropX - sx;
            let relY = dropY - sy;
            let newIndex = helpers.findClosestIconIndex(bounds, relX, relY);
            let newOrder = helpers.reorderIcon(panelIcons, managed.id, newIndex);
            this.applet._registry.setIconOrder(newOrder);
        } else if (targetSection !== sourceSection) {
            // Move between sections: promote or demote
            this.applet._registry.setIconVisibility(managed.id, targetSection);

            // If promoting to panel, add to icon-order
            if (targetSection === 'panel') {
                let order = this.applet.iconOrder || [];
                if (!order.includes(managed.id)) {
                    order.push(managed.id);
                    this.applet._registry.setIconOrder(order);
                }
            }

            // Re-populate the popup to reflect the new state
            // (_redistributeIcons was triggered by settings change, icons are now
            // in their correct containers — re-populate moves them into the popup)
            if (this.applet._popup.isOpen()) {
                this.applet._popup.depopulatePopup();
                this.applet._popup.populatePopup();
                this.applet._popup.resizePopup();
            }
        }
        // _redistributeIcons will be triggered by settings change callback
    }

    /**
     * Determine which section a drop coordinate falls in.
     */
    _getDropSection(x, y) {
        if (!this.applet._popup.overflowSection) return 'panel';

        let [, oy] = this.applet._popup.overflowSection.get_transformed_position();
        return y >= oy ? 'overflow' : 'panel';
    }

    /**
     * Get bounding boxes of icons in a section container (section-relative coords).
     */
    getSectionIconBounds(section) {
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
        // If source is a Clutter.Clone, clone the original actor instead
        let cloneSource = sourceActor.source || sourceActor;
        this._dndClone = new Clutter.Clone({ source: cloneSource });
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
        if (section === 'panel' && this.applet._popup.visibleSection) {
            this.applet._popup.visibleSection.add_style_class_name('systray-overflow-drop-highlight');
        } else if (section === 'overflow' && this.applet._popup.overflowSection) {
            this.applet._popup.overflowSection.add_style_class_name('systray-overflow-drop-highlight');
        }
    }

    /**
     * Remove drop highlight from both sections.
     */
    _clearDropHighlight() {
        if (this.applet._popup.visibleSection) {
            this.applet._popup.visibleSection.remove_style_class_name('systray-overflow-drop-highlight');
        }
        if (this.applet._popup.overflowSection) {
            this.applet._popup.overflowSection.remove_style_class_name('systray-overflow-drop-highlight');
        }
        if (this.applet._popup.inactiveSection) {
            this.applet._popup.inactiveSection.remove_style_class_name('systray-overflow-drop-highlight');
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DndHandler;
}
