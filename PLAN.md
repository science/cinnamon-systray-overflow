# Systray Overflow — Bug Fixes & System Applet Integration

## Context

User UAT testing revealed multiple issues:
1. **The "two systrays" confusion** — icons to the right of the chevron are separate Cinnamon applets (`sound@cinnamon.org`, `network@cinnamon.org`, etc.), NOT a duplicate systray. But the user wants our popup to manage them too.
2. **Hidden section zero-height** — empty "Hidden" section has no height, making it impossible to drag icons into it.
3. **Popup stale after DND** — dragging icon from Hidden→Shown updates the panel but the popup doesn't refresh, so the icon disappears from the popup entirely.
4. **Duplicate redshift** — two `redshift-gtk` processes running in VM (PID 4088, 4215). VM config issue, not applet bug.
5. **Insufficient test icons** — only 3 XApp icons in VM makes testing difficult.
6. **`pasystray` confusion** — `pasystray` (XApp tray icon we manage) shows a speaker icon identical to `sound@cinnamon.org` (separate Cinnamon applet). Two speaker icons from different sources look like duplication.

## Plan Overview

Three work phases, each with TDD and VM verification:

| Phase | What | Priority |
|-------|------|----------|
| A | Fix hidden section + DND popup refresh | Immediate |
| B | VM test environment fixes | Immediate |
| C | System applet integration in popup | New feature |

---

## Phase A: Fix Hidden Section + DND Popup Refresh

### A1. Both sections need minimum height as drop targets

**File:** `stylesheet.css`

Both "Shown" and "Hidden" sections can be empty (all icons in one section). An empty section has zero height, making it impossible to drag icons into it. Both use the same `.systray-overflow-icon-grid` class, so a single CSS fix covers both:

```css
.systray-overflow-icon-grid {
    spacing: 4px;
    min-height: 28px;
}
```

This ensures whichever section is empty still has visible height as a drag-drop target.

### A2. Popup goes stale after DND drop

**Bug:** Drag icon from Hidden→Shown: icon appears in the panel, but the popup's "Shown" section doesn't update. Root cause: `_handleDrop` calls `_setIconVisibility` → settings callback triggers `_redistributeIcons` → icon actor gets reparented to `_panelBox` (the panel), pulling it OUT of `_overflowVisibleSection` (the popup). The popup is still open but now shows stale state.

**File:** `applet.js`, `_handleDrop()` (line ~1384)

**Fix:** After a cross-section DND drop, re-populate the popup so both sections reflect the new icon assignments:

```js
} else if (targetSection !== sourceSection) {
    this._setIconVisibility(managed.id, targetSection);
    if (targetSection === 'panel') {
        let order = this.iconOrder || [];
        if (!order.includes(managed.id)) {
            order.push(managed.id);
            this._setIconOrder(order);
        }
    }
    // Re-populate the popup to reflect the new state
    // (_redistributeIcons was triggered by settings change, icons are now
    // in their correct containers — re-populate moves them into the popup)
    if (this._overflowPanelOpen) {
        this._depopulateOverflowPopup();
        this._populateOverflowPopup();
    }
}
```

This ensures after every promote/demote DND, the popup refreshes to show the icon in its new section.

**Test (RED→GREEN):** Lint test asserting `_handleDrop` calls `_populateOverflowPopup` after cross-section drop.

### A3. DND reliability audit

Verify the full DND chain in the VM:
1. `_onPopupButtonPress` → sets `_dndSource`
2. `_onPopupMotion` → checks threshold, sets `_dndDragging`
3. `_onPopupButtonRelease` → calls `_handleDrop`
4. `_handleDrop` → calls `_setIconVisibility` → `settings.setValue`
5. Settings change triggers `_redistributeIcons`
6. `_handleDrop` re-populates popup if open

Add debug logging temporarily if DND fails, trace which step breaks.

---

## Phase B: VM Test Environment

### B1. Kill duplicate redshift

```bash
./vm/vm-ctl.sh ssh "pkill -f 'redshift-gtk'; sleep 1; redshift-gtk &"
```

Fix autostart to prevent two instances.

### B2. Install more tray apps

Install apps that provide XApp/XEmbed tray icons for testing diversity:

```bash
./vm/vm-ctl.sh ssh "sudo apt-get install -y clipit flameshot"
```

- `clipit` — clipboard manager with tray icon
- `flameshot` — screenshot tool with tray icon
- `blueman` — already installed, just needs to be started (`blueman-applet`)

---

## Phase C: System Applet Integration

### Architecture

System applets (`sound@cinnamon.org`, `network@cinnamon.org`, etc.) are standalone Cinnamon applets. They CANNOT be reparented into our popup — their popup menus position relative to the panel and would break.

**Approach:** Show proxy icons in our popup that trigger the real applet's native popup.

- **Click system applet icon in popup** → close our popup → `applet.menu.open(true)` on the real applet → native popup appears at the panel position. Seamless UX.
- **DND system applet to Hidden** → manipulate `dconf org.cinnamon enabled-applets` to remove the applet → Cinnamon hot-unloads it → icon disappears from panel.
- **DND hidden system applet to Shown** → add back to `enabled-applets` dconf → Cinnamon hot-loads it → icon reappears in panel.

### Popup layout (updated)

```
┌───────────────────────────────────────────┐
│ ── Shown ──                               │
│  [tray icon A] [tray icon B]              │  ← XApp/XEmbed tray icons (in panel)
│  [sound♪] [network🌐] [power🔋]          │  ← System applet proxies (in panel)
│ ── Hidden ──                              │
│  [tray icon C]                            │  ← Hidden tray icons
│  [printers🖨]                             │  ← Disabled system applets
└───────────────────────────────────────────┘
```

Tray icons and system applet icons share the same sections (Shown/Hidden). They look similar to the user but behave differently internally:
- **Tray icons** (XApp/XEmbed): Actors reparented between panel and popup. Click forwards to native handler.
- **System applets**: Static proxy icons we create. Click closes popup + triggers real applet popup. DND manipulates dconf.

### Implementation details

**File:** `applet.js`

#### C1. Discover system applets

New method `_getSystemApplets()`:
```js
_getSystemApplets() {
    // Known system applet UUIDs we can manage
    const SYSTEM_APPLET_UUIDS = [
        'sound@cinnamon.org',
        'network@cinnamon.org',
        'power@cinnamon.org',
        'printers@cinnamon.org',
        'removable-drives@cinnamon.org',
        'keyboard@cinnamon.org',
        'notifications@cinnamon.org',
        'favorites@cinnamon.org'
    ];

    let enabled = global.settings.get_strv('enabled-applets');
    let result = { shown: [], hidden: [] };

    for (let uuid of SYSTEM_APPLET_UUIDS) {
        let isEnabled = enabled.some(e => e.includes(uuid));
        let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
        let instance = instances.length > 0 ? instances[0] : null;

        let entry = {
            uuid: uuid,
            name: uuid.split('@')[0],  // "sound", "network", etc.
            type: 'system-applet',
            instance: instance,
            iconName: instance ? this._getAppletIconName(instance) : 'application-x-executable'
        };

        if (isEnabled) result.shown.push(entry);
        else result.hidden.push(entry);
    }
    return result;
}
```

#### C2. Get applet icon name

```js
_getAppletIconName(appletInstance) {
    // Most applets store their icon in _applet_icon or similar
    // Fall back to metadata icon
    try {
        let meta = appletInstance._meta || {};
        return meta.icon || 'application-x-executable';
    } catch(e) {
        return 'application-x-executable';
    }
}
```

#### C3. Populate popup with system applets

In `_populateOverflowPopup()`, after populating tray icons:

```js
// Add system applet proxy icons
let sysApplets = this._getSystemApplets();

for (let entry of sysApplets.shown) {
    let icon = new St.Icon({ icon_name: entry.iconName, icon_size: this.icon_size });
    let button = new St.Button({ style_class: 'applet-box', child: icon, reactive: true });
    button._systrayOverflowType = 'system-applet';
    button._systrayOverflowUuid = entry.uuid;
    this._overflowVisibleSection.add_actor(button);
}

for (let entry of sysApplets.hidden) {
    let icon = new St.Icon({ icon_name: entry.iconName, icon_size: this.icon_size });
    let button = new St.Button({ style_class: 'applet-box', child: icon, reactive: true });
    button._systrayOverflowType = 'system-applet';
    button._systrayOverflowUuid = entry.uuid;
    this._overflowOverflowSection.add_actor(button);
}
```

#### C4. Click handling for system applet proxies

In `_onPopupButtonRelease`, when `!wasDragging` (click, not drag):

```js
// Check if clicked actor is a system applet proxy
let source = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
if (source._systrayOverflowType === 'system-applet') {
    let uuid = source._systrayOverflowUuid;
    this._closeOverflowPanel();
    let instances = Main.AppletManager.getRunningInstancesForUuid(uuid);
    if (instances.length > 0 && instances[0].menu) {
        instances[0].menu.open(true);
    }
    return Clutter.EVENT_STOP;
}
```

#### C5. DND for system applets

In `_handleDrop`, detect system applet drops:

```js
if (managed._systrayOverflowType === 'system-applet') {
    let uuid = managed._systrayOverflowUuid;
    if (targetSection === 'overflow') {
        this._disableSystemApplet(uuid);
    } else if (targetSection === 'panel') {
        this._enableSystemApplet(uuid);
    }
    return;
}
```

```js
_disableSystemApplet(uuid) {
    let current = global.settings.get_strv('enabled-applets');
    let filtered = current.filter(e => !e.includes(uuid));
    global.settings.set_strv('enabled-applets', filtered);
    // Store in our settings so we can re-enable with correct position
}

_enableSystemApplet(uuid) {
    let current = global.settings.get_strv('enabled-applets');
    if (current.some(e => e.includes(uuid))) return;
    // Restore with saved position, or default to right zone
    let newEntry = this._getSavedAppletEntry(uuid) || 'panel1:right:0:' + uuid + ':' + Date.now();
    current.push(newEntry);
    global.settings.set_strv('enabled-applets', current);
}
```

#### C6. Persist disabled applet entries

**File:** `settings-schema.json`

Add new setting:
```json
"disabled-applets": {
    "type": "generic",
    "default": {},
    "description": "Saved enabled-applets entries for system applets moved to overflow"
}
```

When an applet is hidden, save its full dconf entry string so we can restore it at the same position later.

---

## Files to modify

| File | Changes |
|------|---------|
| `applet.js` | A1: chevron in `_panelBox`; A3: DND audit; C1-C6: system applet integration |
| `stylesheet.css` | A2: min-height on `.systray-overflow-icon-grid` |
| `settings-schema.json` | C6: `disabled-applets` setting |
| `test/applet-lint.test.js` | New tests for each phase |
| `helpers.js` | Potentially new helpers for system applet classification |

## Verification
Use the VM and xdotools and other resources specified in claude.md to conduct thorough UAT tests via Claude Code agent work (not user testing). Screenshot aggressively and crop the shots to focus your analysis on whether the system is working at the moment of the screenshot.

### After Phase A
1. `npm test` — all pass
2. Restart Cinnamon in VM
3. Screenshot: chevron appears inline with tray icons (not as separate element)
4. Open popup: "Hidden" section has visible height even when empty
5. DND from Shown→Hidden and back works reliably

### After Phase B
1. Only one redshift-gtk in `ps aux`
2. Multiple tray apps visible (clipit, flameshot, blueman)

### After Phase C
1. Open popup: shows both tray icons AND system applet icons
2. Click system applet icon in popup → our popup closes → system applet's native popup opens at the panel
3. DND system applet icon to Hidden → applet disappears from panel
4. DND hidden system applet to Shown → applet reappears in panel
5. Persist across restart: disabled applets stay disabled, re-enabled ones come back at saved position
