// helpers.js — Pure functions for systray-overflow applet
// No GJS dependencies — testable in Node.js
//
// GJS: const helpers = require('./helpers');
// Node: const helpers = require('./helpers');

'use strict';

/**
 * Classify icons into panel vs overflow based on user preferences.
 *
 * @param {Array<{id: string}>} allIcons - All managed icons with at least an `id` field
 * @param {Object} prefs - Map of icon ID -> "panel" | "overflow"
 * @param {string} defaultVis - Default visibility for icons not in prefs: "panel" or "overflow"
 * @param {Array<string>} order - Ordered list of icon IDs for panel display order
 * @returns {{ panel: Array, overflow: Array }} Icons split by classification, panel icons sorted by order
 */
function classifyIcons(allIcons, prefs, defaultVis, order) {
    let panel = [];
    let overflow = [];

    for (let icon of allIcons) {
        let vis = prefs[icon.id] || defaultVis || 'panel';
        if (vis === 'panel') {
            panel.push(icon);
        } else {
            overflow.push(icon);
        }
    }

    // Sort panel icons by the user's preferred order
    if (order && order.length > 0) {
        let orderMap = {};
        for (let i = 0; i < order.length; i++) {
            orderMap[order[i]] = i;
        }
        panel.sort((a, b) => {
            let ai = orderMap[a.id] !== undefined ? orderMap[a.id] : order.length;
            let bi = orderMap[b.id] !== undefined ? orderMap[b.id] : order.length;
            if (ai !== bi) return ai - bi;
            // Fallback: alphabetical by id
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
    } else {
        // No order preference — sort alphabetically
        panel.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    }

    // Sort overflow alphabetically
    overflow.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

    return { panel, overflow };
}

/**
 * Extract a stable icon ID from an XApp status icon proxy name.
 * Strips the "org.x.StatusIcon." prefix and lowercases.
 *
 * @param {string} proxyName - e.g. "org.x.StatusIcon.blueman"
 * @returns {string} e.g. "blueman"
 */
function xappProxyToId(proxyName) {
    return proxyName.replace('org.x.StatusIcon.', '').toLowerCase();
}

/**
 * Determine the drop section ("panel" or "overflow") from a y-coordinate
 * within the popup, given the divider position.
 *
 * @param {number} y - Drop y-coordinate relative to popup
 * @param {number} dividerY - Y position of the section divider
 * @returns {string} "panel" or "overflow"
 */
function dropTargetSection(y, dividerY) {
    return y < dividerY ? 'panel' : 'overflow';
}

/**
 * Calculate overflow panel position relative to an applet.
 * Centers horizontally on the applet, clamps to monitor edges.
 * Vertical placement depends on panel orientation.
 *
 * @param {Object} appletAlloc - { x1, y1, x2, y2 } transformed allocation
 * @param {Object} panelSize - { width, height } of the overflow panel
 * @param {Object} monitor - { x, y, width, height } of the monitor
 * @param {string} orientation - "top" or "bottom"
 * @returns {[number, number]} [x, y] position
 */
function calcOverflowPanelPosition(appletAlloc, panelSize, monitor, orientation) {
    // Center horizontally on the applet, clamp to monitor edges
    let x = Math.round((appletAlloc.x1 + appletAlloc.x2) / 2 - panelSize.width / 2);
    if (monitor) {
        x = Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - panelSize.width));
    }

    // TOP panel -> below applet; BOTTOM panel -> above applet
    let y;
    if (orientation === 'top') {
        y = appletAlloc.y2;
    } else {
        y = appletAlloc.y1 - panelSize.height;
    }

    return [x, y];
}

/**
 * Check if mouse movement exceeds the drag threshold.
 *
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} currentX - Current X coordinate
 * @param {number} currentY - Current Y coordinate
 * @param {number} threshold - Pixel threshold (default 8)
 * @returns {boolean} True if movement exceeds threshold
 */
function exceedsDragThreshold(startX, startY, currentX, currentY, threshold) {
    if (threshold === undefined) threshold = 8;
    let dx = currentX - startX;
    let dy = currentY - startY;
    return Math.sqrt(dx * dx + dy * dy) >= threshold;
}

/**
 * Find the closest icon index in a list based on coordinates.
 * Used for determining drop position in a section.
 *
 * @param {Array<{x: number, y: number, width: number, height: number}>} iconBounds
 *   Array of icon bounding boxes (center-relative coordinates)
 * @param {number} x - Drop x-coordinate
 * @param {number} y - Drop y-coordinate
 * @returns {number} Index of the closest icon, or 0 if empty
 */
function findClosestIconIndex(iconBounds, x, y) {
    if (iconBounds.length === 0) return 0;

    let minDist = Infinity;
    let closest = 0;

    for (let i = 0; i < iconBounds.length; i++) {
        let b = iconBounds[i];
        let cx = b.x + b.width / 2;
        let cy = b.y + b.height / 2;
        let dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (dist < minDist) {
            minDist = dist;
            closest = i;
        }
    }

    // If drop is to the right of the closest icon center, insert after it
    let b = iconBounds[closest];
    let cx = b.x + b.width / 2;
    if (x > cx && closest < iconBounds.length) {
        closest++;
    }

    return closest;
}

/**
 * Compute new icon-order array after moving an icon to a new position
 * within the panel section.
 *
 * @param {Array<string>} currentOrder - Current ordered list of panel icon IDs
 * @param {string} iconId - The icon being moved
 * @param {number} newIndex - Target index in the panel list
 * @returns {Array<string>} Updated order array
 */
function reorderIcon(currentOrder, iconId, newIndex) {
    let order = currentOrder.filter(id => id !== iconId);
    if (newIndex > order.length) newIndex = order.length;
    if (newIndex < 0) newIndex = 0;
    order.splice(newIndex, 0, iconId);
    return order;
}

// Dual-runtime export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        classifyIcons, xappProxyToId, dropTargetSection, calcOverflowPanelPosition,
        exceedsDragThreshold, findClosestIconIndex, reorderIcon
    };
}
