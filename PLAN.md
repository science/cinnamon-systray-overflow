# Cinnamon System Tray Overflow Applet

## Design

Cinnamon's system tray shows every background application icon in a flat, always-visible row: Slack, Bluetooth, USB devices, Steam, update managers, input methods, and more. On a busy desktop, the tray grows to a dozen or more icons, most of which are rarely interacted with but occasionally needed. Windows 10 solved this with an overflow chevron — infrequently-used icons live behind a single button, accessible on demand. Cinnamon has no equivalent.

This project builds a unified system tray applet with overflow support. It replaces Cinnamon's two stock tray applets — `systray@cinnamon.org` (legacy XEmbed protocol, 223 lines) and `xapp-status@cinnamon.org` (modern XApp/DBus protocol, 654 lines) — with a single applet that handles both protocols and adds an overflow mechanism. The user sees their chosen "promoted" icons in the panel as usual, plus a small chevron. Clicking the chevron opens a popup tray showing all icons in two sections: those visible in the panel and those hidden in overflow. Dragging an icon between sections promotes or demotes it — the preference persists across restarts.

The approach is a direct fork-and-combine of both stock applets, following the same pattern used by `~/dev/cinnamon-multirow-panellauncher` and `~/dev/cinnamon-multirow-windowlist` — projects that forked stock Cinnamon applets to add multirow and overflow features. The combined stock code is only ~877 lines, and the overflow UI pattern (chevron button, popup on `global.stage`, modal input routing) is already proven in the multirow-panellauncher.

### Why not right-click to promote/demote?

Unlike panel launchers (which have an OS-level right-click context menu we control), systray icon right-clicks are **owned by the application**. Right-clicking Slack's tray icon sends a DBus `ButtonPress` to Slack, which draws its own menu. XEmbed icons forward all events via `handle_event()`. We have no hook into these menus. The stock XApp applet has a Ctrl+Right-click escape hatch (line 334 of `xapp-status@cinnamon.org/applet.js`) but it's undiscoverable and XEmbed has no equivalent. DND in the overflow popup is the correct interaction model — we control the popup container and can intercept drag gestures before they reach native handlers.

### Click vs drag in the overflow popup

Icons in the popup must remain clickable (to use them normally) AND draggable (to rearrange). The solution is deferred event forwarding: on `button-press-event`, capture the press and record position but don't forward yet. If movement exceeds the drag threshold (~8px), start DND. If `button-release` arrives first, forward both press and release to the icon's native handler as a normal click.

## Architecture

```
Panel:
  [promoted icon 1] [promoted icon 2] ... [chevron ▲]

Overflow popup (on global.stage, shown on chevron click):
  ┌─────────────────────────────────────────┐
  │ ── Visible in panel ──                  │
  │  [icon A]  [icon B]  [icon C]           │
  │ ── Overflow only ──                     │
  │  [icon D]  [icon E]  [icon F]           │
  └─────────────────────────────────────────┘
  Drag icons between sections to promote/demote.
  Click icons to use them normally.
```

### Unified Icon Model

Both protocols produce a `ManagedIcon` wrapper:
- `id`: WM_CLASS role (XEmbed) or stripped `proxy.name` (XApp) — stable key for persistence
- `protocol`: `'xembed'` or `'xapp'`
- `actor`: the Clutter actor (St.Bin wrapping CinnamonTrayIcon, or XAppStatusIcon.actor)
- Icons classified as `"panel"` or `"overflow"` based on persisted user preferences

### Icon Ordering

The order of icons in the "Visible in panel" section of the overflow popup is the actual display order in the panel. Dragging to reorder icons within that section reorders them in the panel. This gives the user full control over icon arrangement — something the stock systray does not support at all (it uses insertion order for XEmbed and alphabetical sort for XApp).

### Persistence

`settings-schema.json` stores:
- `icon-visibility`: `{ "blueman": "panel", "steam": "overflow", ... }` (generic type)
- `icon-order`: `["blueman", "nm-applet", "slack", ...]` (generic type) — ordered list of icon IDs for the panel; icons not in this list fall back to alphabetical
- `default-visibility`: `"panel"` or `"overflow"` (combobox) — controls where newly-seen icons appear

### Overflow UI

Follows the proven multirow-panellauncher pattern:
- Popup is an `St.Bin` placed on `global.stage` (not `Main.uiGroup` — avoids occlusion by `global.top_window_group`)
- `Main.pushModal()` routes input to the popup for hover/click
- Click-outside and Escape close the popup via `captured-event` on `global.stage`
- Chevron hides when no icons are in overflow
- `_calcOverflowPanelPosition()` places popup relative to applet, clamped to monitor edges

## Key Files

### This project

| File | Purpose |
|------|---------|
| `applet.js` | Main applet: both protocols + overflow UI + DND (~800-1000 lines) |
| `helpers.js` | Pure functions — icon classification, popup positioning (testable in Node.js) |
| `metadata.json` | UUID `systray-overflow@cinnamon`, role `"tray"`, max-instances 1 |
| `settings-schema.json` | icon-visibility map + default-visibility |
| `stylesheet.css` | Overflow popup styling |
| `install.sh` | Symlink installer (warns about removing BOTH stock applets) |
| `uninstall.sh` | Safe removal from dconf + symlink cleanup |
| `package.json` | `npm test` runner (Node.js 18+) |
| `test/helpers.test.js` | Unit tests for pure helper functions |
| `test/schema.test.js` | Settings schema + metadata validation |
| `test/applet-lint.test.js` | Static safety checks on applet.js |
| `test/install-uninstall.test.js` | Sandboxed install/uninstall integration tests |
| `vm/` | Symlink or copy of VM management scripts from sibling projects |
| `CLAUDE.md` | Development guide (architecture, commands, VM workflow, constraints) |
| `LICENSE` | GPL-2.0 (matching Cinnamon's license) |

### Reference files to port from

| Source | What to take |
|--------|-------------|
| `/usr/share/cinnamon/applets/systray@cinnamon.org/applet.js` | XEmbed protocol: `StatusIconDispatcher` signals, `_onTrayIconAdded`, `_onEvent`, `_onBeforeRedisplay`, `global.trayReloading` |
| `/usr/share/cinnamon/applets/xapp-status@cinnamon.org/applet.js` | XApp protocol: `XAppStatusIcon` class, `XApp.StatusIconMonitor`, `RecorderIcon`, sorting, role hiding |
| `~/dev/cinnamon-multirow-panellauncher/applet.js` lines 585-846 | Overflow UI: `_ensureOverflowUI`, `_openOverflowPanel`, `_closeOverflowPanel`, `_calcOverflowPanelPosition`, `pushModal`/`popModal`, `captured-event` |

## Development Methodology

### TDD Red-Green (mandatory)

Every feature follows: write failing test → implement → test passes → verify in VM.

- `helpers.js` contains pure functions testable in Node.js (no GJS deps)
- `applet.js` uses `require('./helpers')` for GJS, `module.exports` for Node — dual runtime
- `npm test` runs all Node.js tests (helpers, schema, lint, install) — must pass before any VM work

### VM Testing (mandatory)

The `cinnamon-dev` libvirt/KVM VM mirrors the host (Ubuntu 24.04 + Cinnamon 6.0.4). Host `~/dev` is mounted read-write at `/mnt/host-dev/` via virtio-fs — code changes are instantly visible.

The VM testing infrastructure is shared with `~/dev/cinnamon-multirow-panellauncher` and `~/dev/cinnamon-multirow-windowlist`. This project will symlink or copy the `vm/` directory (containing `vm-ctl.sh`, `clone-vm.sh`, `create-vm.sh`, `cloud-init/`).

**Required workflow after every behavioral change:**

1. `npm test` — all unit tests pass
2. `./vm/vm-ctl.sh start` (if not running)
3. Restart Cinnamon in VM: `./vm/vm-ctl.sh ssh "DISPLAY=:0 cinnamon --replace &>/dev/null &"`
4. Verify via D-Bus eval — query icon count, overflow state, visibility assignments
5. Verify via xdotool — simulate clicks on tray icons, chevron, popup icons
6. Verify via screenshots — crop the tray region, inspect visually

**D-Bus eval pattern** (query live applet state remotely):
```bash
echo 'try {
  let app = /* find applet instance */;
  String(Object.keys(app._managedIcons).length + " icons, overflow=" + app._overflowPanelOpen);
} catch(e) { String(e) }' | ./vm/vm-ctl.sh ssh "DISPLAY=:0 python3 /tmp/cinnamon-eval.py"
```

**xdotool pattern** (simulate mouse interaction):
```bash
./vm/vm-ctl.sh ssh "export DISPLAY=:0; \
  xdotool mousemove 400 400; sleep 0.3; \
  xdotool mousemove <chevron_x> <chevron_y>; sleep 0.5; \
  xdotool click 1"
```

**Screenshot + crop pattern** (visual verification):
```bash
./vm/vm-ctl.sh ssh "export DISPLAY=:0; import -window root /tmp/screenshot.png; \
  convert /tmp/screenshot.png -crop 300x80+<tray_x>+<tray_y> /tmp/tray-cropped.png"
./vm/vm-ctl.sh ssh "cat /tmp/tray-cropped.png" > test/screenshots/tray-cropped.png
```

## Implementation Phases

### Phase 0: Repository setup

1. Initialize git repo in `~/dev/cinnamon-systray-overflow/`
2. Create `LICENSE` (GPL-2.0)
3. Create `metadata.json`, `settings-schema.json`, `package.json`
4. Create empty `applet.js`, `helpers.js`, `stylesheet.css`
5. Create `install.sh` and `uninstall.sh` (adapted from multirow-panellauncher)
6. Symlink `vm/` from `~/dev/cinnamon-multirow-panellauncher/vm/` (shared infrastructure)
7. Create `CLAUDE.md` with project-specific development guide
8. Write `test/schema.test.js` — RED: validates metadata UUID, role, max-instances, settings schema
9. Write `test/install-uninstall.test.js` — RED: validates install/uninstall scripts
10. Push to `github.com/science/cinnamon-systray-overflow`

### Phase 1: Combined tray — both protocols, no overflow

Port both stock applets into one, all icons visible in panel (identical to stock behavior).

1. Write `test/applet-lint.test.js` — RED: checks for `StatusIconDispatcher` signals, `XApp.StatusIconMonitor`, `on_applet_removed_from_panel` cleanup, `global.trayReloading` handling
2. Port XEmbed handling into `applet.js`: `_onTrayIconAdded`, `_onTrayIconRemoved`, `_onBeforeRedisplay`, `_onEvent`, `resizeIcons`
3. Port XApp handling into `applet.js`: `XAppStatusIcon` class, `RecorderIcon` class, `XApp.StatusIconMonitor`, sorting, role hiding via `Main.systrayManager`
4. All icons go into `this._panelBox` (St.BoxLayout) — identical behavior to stock
5. Track icons via `this._managedIcons` Map keyed by icon ID
6. `npm test` — GREEN
7. **VM test**: install applet, remove both stock applets, restart Cinnamon — all tray icons appear and work identically (click opens app menus, tooltips work)

### Phase 2: Overflow UI

Chevron button + popup container, icons classified by persisted preferences.

1. Add helpers to `helpers.js` — RED: `classifyIcons(allIcons, prefs, defaultVis)` returns `{ panel: [...], overflow: [...] }`
2. Implement helpers — GREEN
3. Add lint tests — RED: checks for `_ensureOverflowUI`, `_closeOverflowPanel`, `_redistributeIcons`, `global.stage` usage, `pushModal`/`popModal`
4. Implement overflow UI in `applet.js`:
   - `_ensureOverflowUI()`: lazy-create chevron `St.Button` + overflow `St.Bin` on `global.stage`
   - `_redistributeIcons()`: classify icons → re-parent actors to panel vs overflow container
   - `_toggleOverflowPanel()`, `_openOverflowPanel()`, `_closeOverflowPanel()`
   - Modal input routing via `pushModal`/`popModal` + `captured-event` for click-outside/Escape
   - `_calcOverflowPanelPosition()` (from multirow-panellauncher)
   - Chevron hidden when no icons in overflow
5. Add `icon-visibility` and `default-visibility` settings bindings
6. `npm test` — GREEN
7. **VM test**: set some icons to overflow via settings JSON, restart Cinnamon, verify popup opens/closes, icons appear in correct sections, clicking overflow icons works

### Phase 3: DND promote/demote

Drag icons between "Visible" and "Overflow" sections in the popup.

1. Add helpers — RED: drop target detection for two-section layout
2. Implement helpers — GREEN
3. Implement DND in `applet.js`:
   - Wrapper delegates intercept `button-press-event` at container level
   - Deferred forwarding: press → wait for motion threshold → drag or forward click
   - Each section is a drop target with visual feedback (highlight on drag-over)
   - On drop in other section: `_setIconVisibility(id, newVis)` + `_redistributeIcons()`
   - On reorder within "Visible" section: update `icon-order` and re-parent panel icons to match
   - Persist via `this.settings.setValue("icon-visibility", ...)` and `this.settings.setValue("icon-order", ...)`
4. `npm test` — GREEN
5. **VM test**: drag icons between sections for both XEmbed and XApp, verify clicks still work, verify panel updates, restart Cinnamon and confirm persistence

### Phase 4: Polish

1. Handle `_onBeforeRedisplay` — re-classify XEmbed icons after redisplay cycle (XEmbed icons get destroyed and recreated on resize/scale changes)
2. Panel orientation changes (top/bottom/left/right)
3. Icon size and UI scale changes
4. Panel edit mode toggling
5. Test edge cases: 0 overflow icons (no chevron), all icons overflow (panel shows only chevron), icon appears/disappears while popup is open

## Constraints

- Our applet and stock `systray@cinnamon.org` CANNOT coexist — `StatusIconDispatcher.start()` is singleton (creates the X11 tray selection owner)
- Our applet and stock `xapp-status@cinnamon.org` should not coexist — duplicate XApp icons
- `install.sh` must warn about removing both stock applets
- `uninstall.sh` must warn about re-enabling them
- XEmbed event handling uses `global.begin_modal`/`end_modal` around button presses — must guard against nesting when overflow popup's `pushModal` is already active

## Verification Checklist

1. `npm test` — all Node.js tests pass
2. Install applet in VM, remove both stock applets, restart Cinnamon
3. All tray icons appear in panel — clicking each opens its native menu/action
4. Set some icons to overflow → they disappear from panel, chevron appears
5. Click chevron → popup shows both sections with all icons
6. Click an icon in the popup → its native menu/action fires normally
7. Drag an icon from "Visible" to "Overflow" → icon removed from panel
8. Drag an icon from "Overflow" to "Visible" → icon appears in panel
9. Reorder icons within "Visible" section → panel icon order updates to match
10. Restart Cinnamon → preferences persist, same icons in panel vs overflow in same order
10. Test both XEmbed icons (if any present) and XApp icons (Blueman, etc.)
11. Crop and visually inspect tray region screenshots at each stage
