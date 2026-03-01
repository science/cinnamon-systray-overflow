# Defects — VM QA Session (2026-02-28)

Post-deployment testing of the `resizePopup()` height fix (calcSectionHeight + set_height(-1) reset).

## Test Environment
- VM: `cinnamon-dev` (Ubuntu 24.04 + Cinnamon 6.0.4)
- Icons present: diodon, pasystray (XApp managed), sound/network/display (system applet proxies)
- Testing via D-Bus Eval + python-xlib XTest

---

## Defect 1: First-open panel height underestimated (Cosmetic)

**Severity:** Low
**Component:** `popup-manager.js` → `resizePopup()`
**Status:** New (introduced by partial Bug 2 fix)

### Symptom
On the very first popup open after Cinnamon restart, the StBin panel height is 175px instead of the correct 196px. The Inactive section icons at the bottom are clipped by ~21px. All subsequent opens are correctly sized at 196px.

### Reproduction
1. Restart Cinnamon (`cinnamon --replace`)
2. Open popup (chevron click or `openPanel()`)
3. Observe: panel height = 175, bottom icons clipped
4. Close and reopen → panel height = 196, all icons visible

### Root Cause
`set_height(-1)` followed by `get_preferred_height(popupWidth)` queries the panel's BoxLayout child. On first open, the section labels (StLabel, h=18 each) and spacing haven't been allocated yet, so `get_preferred_height` returns a stale/incomplete value (175 instead of 196). On subsequent opens, the BoxLayout's allocation data is warm and returns the correct value.

### Measurements
| Open # | Panel Height | Box Height | Expected | Visual |
|--------|-------------|-----------|----------|--------|
| 1st    | 175         | 180       | 196      | Bottom icons clipped |
| 2nd+   | 196         | 180       | 196      | All icons visible |

---

## Defect 2: DND promote (Hidden→Shown) silently fails

**Severity:** Medium
**Component:** `dnd-handler.js` → `onButtonPress()` / `_handleDrop()`
**Status:** Pre-existing (not caused by height fix)

### Symptom
Dragging an XApp icon from the Hidden (overflow) section to the Shown (visible) section has no effect — icon counts remain unchanged. The reverse direction (Shown→Hidden demote) works correctly every time.

### Reproduction
1. Open popup
2. Drag any XApp clone icon from Hidden section upward to Shown section
3. Release — nothing happens (icon stays in Hidden)
4. Drag a Shown icon downward to Hidden — works (icon moves)

### Measurements
| Direction | Start Counts | End Counts | Result |
|-----------|-------------|-----------|--------|
| Shown→Hidden (demote) | vis=3, ov=4 | vis=2, ov=5 | Works |
| Hidden→Shown (promote) | vis=2, ov=5 | vis=2, ov=5 | No change |
| Repeated promote attempts | vis=1, ov=6 | vis=1, ov=6 | No change |

### Observations
- `get_actor_at_pos(REACTIVE)` at the Hidden icon position correctly returns the ClutterClone and `findManagedIconForActor` resolves it to the right managed icon (e.g., "diodon")
- Drag distance exceeds threshold (62-94px vertical, threshold is 8px)
- XTest motion events are generated (20-25 steps)
- No errors in Cinnamon log
- System applet icons (sound, network, display) in Hidden section were not tested for promote — they use a separate DND path (`pendingEnable`)

### Likely Causes (to investigate)
1. **captured-event not routing MOTION_NOTIFY** — the `onButtonPress` registers the press, but subsequent motion events from XTest may not reach `onCapturedEvent` (pushModal may filter XTest synthetic events differently for motion vs press/release)
2. **`findActorSection` returning wrong section** — the source clone is in the overflow section but `findActorSection` may walk up to the wrong parent
3. **Threshold never exceeded** — the motion events may be swallowed or the startX/Y may be reset, so `exceedsDragThreshold` never transitions from PRESSED→DRAGGING
4. **State stays PRESSED** — if DRAGGING state is never reached, the release is treated as a "click" (which just closes the popup for overflow icons) rather than a "drop"

---

## What's Working (Verified)

| Feature | Status | Notes |
|---------|--------|-------|
| Bug 1 fix (FlowLayout 0-height) | **FIXED** | All sections h=32 on every reopen |
| Section heights after 5× rapid cycle | **FIXED** | Consistent h=32 across all cycles |
| Icon pickability on reopen | **FIXED** | reactive=true, paint_visibility=true |
| Bug 2 fix (stale panel height) | **Partial** | Fixed for reopens (196px), first open still 175px |
| Click on Shown icon | **Works** | Closes popup |
| Click on Hidden XApp icon | **Works** | Forwards click to original (pasystray menu opens) |
| Escape key close | **Works** | Popup closes on Escape |
| DND demote (Shown→Hidden) | **Works** | Icon moves, counts update, popup refreshes |
| DND promote (Hidden→Shown) | **Broken** | Pre-existing issue, not caused by height fix |
| Panel resize after DND | **Works** | Width/height adjust to new icon count |
| Zero Cinnamon errors | **Clean** | No JS errors in log through entire session |
| Settings persistence | **Works** | DND visibility changes persist across close/reopen |

---

## Resolution Plan

### Defect 1 Fix: Compute panel height explicitly (bypass `get_preferred_height` entirely)

**Approach:** The same strategy that fixed section heights — compute the total panel height from known values instead of relying on Clutter's preferred-height query. This eliminates the layout-timing dependency that causes the first-open underestimate.

**Implementation in `resizePopup()`:**

The innerBox contains exactly 6 children: 3 labels + 3 sections.

```
labelHeight = 18  (measured: font 0.85em + 2px padding top/bottom)
boxSpacing  = 4   (from stylesheet .systray-overflow-panel spacing)
panelPad    = 12  (6px top + 6px bottom from stylesheet padding)
nLabels     = 3   (Shown, Hidden, Inactive — always present)
nSections   = 3
nGaps       = nLabels + nSections - 1 = 5

panelHeight = panelPad
            + nLabels * labelHeight
            + visibleSectionHeight + overflowSectionHeight + inactiveSectionHeight
            + nGaps * boxSpacing
```

**Steps:**
1. In `resizePopup()`, after computing the 3 section heights via `calcSectionHeight()`, sum them with the known label heights + spacing + padding
2. Call `set_height(panelHeight)` directly on the panel — no `set_height(-1)` + `get_preferred_height` needed
3. Add `LABEL_HEIGHT`, `BOX_SPACING`, `PANEL_PADDING` as constants at the top of `resizePopup()` (or as module-level constants) for clarity
4. Update lint tests: remove the `set_height(-1)` test, replace with test for explicit panel height computation
5. Add a helpers.js `calcPopupHeight()` function if the computation should be tested in Node

**Risk:** The label height (18px) depends on the font and CSS. If the theme changes, the hardcoded value would be wrong. Mitigations:
- Accept the 18px constant — it only needs to be approximately right (±5px is cosmetically fine)
- Or query label height once during `ensureOverflowUI()` and cache it

**Files:** `popup-manager.js` (resizePopup), `test/popup-lint.test.js` (update lint test)

### Defect 2 Fix: Diagnose and fix DND promote failure

**Approach:** Instrument the DND state machine to determine where the promote drag goes wrong. The demote path (Shown→Hidden) works, so the event routing is functional — the bug is specific to drags originating from the overflow section.

**Investigation steps:**
1. Add temporary `global.log()` calls in `dnd-handler.js`:
   - `onButtonPress`: log when press is registered, source section, managed icon ID
   - `onMotion`: log motion events, current state, threshold status
   - `onButtonRelease`: log state, transition action (click vs drop), target section
2. Reproduce the promote drag via XTest on the VM
3. Examine Cinnamon log to identify where the state machine diverges

**Likely fix areas:**
- **`findActorSection()`** — may walk up parent chain past the section to the innerBox or panel, returning the wrong section ID. If source is already in "overflow", `_getDropSection` returning "panel" means `targetSection !== sourceSection` is true... but the settings change (`setIconVisibility`) might trigger a re-populate that resets the DND state
- **DND state transition** — the release handler may fire before motion crosses threshold, treating it as a "click" instead of "drop". The click handler for overflow icons forwards the click, which closes the popup and cancels the DND
- **Race condition** — `setIconVisibility` triggers a settings callback that calls `redistributeIcons`, which may destroy the clone being dragged

**Files:** `dnd-handler.js` (investigation + fix), `test/dnd-lint.test.js` (add promote scenario coverage)

---

## Defect 3: Chevron position unstable among system applet proxy icons

**Severity:** High (persistent, unfixed across multiple attempts)
**Component:** Chevron positioning architecture
**Status:** Open — requires architectural change (see below)

### Symptom
The chevron (overflow toggle button) does not reliably stay to the right of ALL systray icons. It typically stays to the right of application tray icons (XEmbed/XApp), but is displaced by system applet proxy icons (sound, display, power, etc.) which are managed by Cinnamon's panel zone system, not by our `_panelBox` or `applet.actor`.

### History of Failed Fixes
1. **Chevron in `_panelBox` with `set_child_at_index(panel.length)`** — displaced by `insert_child_at_index(icon, 0)` and `sortXAppIcons()` which ignore the chevron
2. **Chevron moved to `applet.actor` as sibling of `_panelBox`** — still displaced by system applet proxy icons which are positioned by Cinnamon's panel zone independently

### Root Cause
System applet proxy icons are rendered by Cinnamon's panel zone layout system, which positions applets in zones (`_leftBox`, `_centerBox`, `_rightBox`). Each applet is a separate actor in the zone. Our applet's actor and the system applet proxy icons' actors are siblings in the zone, and Cinnamon controls their ordering — we cannot.

No amount of `set_child_at_index` or container-hierarchy changes within our applet can affect the relative ordering of other applets' actors in the zone.

### Proposed Fix: Panel-attached button (not a tray icon)
Follow the pattern from `cinnamon-multirow-panellauncher`: create the chevron as a pure `St.Button` child of `this.actor` (the applet's main box), completely outside the tray icon system. This makes it:
- Immune to XEmbed/XApp icon dispatcher position scrambling
- Positioned by Cinnamon's layout engine automatically (as part of the applet's allocation)
- Always at the trailing edge of the applet's box

See `~/dev/cinnamon-multirow-panellauncher/applet.js` line 610-626 for reference implementation.

---

### Priority

1. **Defect 3** (chevron position) — Architectural change required. Highest priority.
2. **Defect 1** (first-open height) — Quick fix, deterministic, low risk.
3. **Defect 2** (DND promote) — Needs investigation. Pre-existing, not a regression.
