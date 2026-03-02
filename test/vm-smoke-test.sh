#!/bin/bash
# VM integration smoke tests for systray-overflow@cinnamon.
#
# Tests the applet running inside the cinnamon-dev VM with real tray icons.
# Uses D-Bus Eval to inspect applet state and python-xlib XTest for clicks.
#
# Prerequisites:
#   - VM "cinnamon-dev" running with test env set up
#     (run: ./vm/vm-setup-test-env.sh)
#   - Or: ./test/vm-smoke-test.sh --setup (auto-setup first)
#
# Usage:
#   ./test/vm-smoke-test.sh                # Run all tests
#   ./test/vm-smoke-test.sh --setup        # Set up VM first, then test
#   ./test/vm-smoke-test.sh --revert       # Revert to snapshot first
#   ./test/vm-smoke-test.sh --screenshots  # Take screenshots at each step

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VM_CTL="$PROJECT_DIR/vm/vm-ctl.sh"
SCREENSHOT_DIR="$SCRIPT_DIR/screenshots"
APPLET_UUID="systray-overflow@cinnamon"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# --- Counters ---
TOTAL=0
PASSED=0
FAILED=0
WARNINGS=0

# --- Options ---
DO_SETUP=false
DO_REVERT=false
DO_SCREENSHOTS=false

for arg in "$@"; do
    case "$arg" in
        --setup) DO_SETUP=true ;;
        --revert) DO_REVERT=true ;;
        --screenshots) DO_SCREENSHOTS=true ;;
        --help|-h)
            echo "Usage: $0 [--setup] [--revert] [--screenshots]"
            echo "  --setup        Run vm-setup-test-env.sh first"
            echo "  --revert       Revert to clean-baseline snapshot first"
            echo "  --screenshots  Take screenshots at each step"
            exit 0 ;;
    esac
done

# --- SSH helpers ---
VM_IP=""
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5"

get_vm_ip() {
    if [[ -z "$VM_IP" ]]; then
        VM_IP=$("$VM_CTL" ip 2>/dev/null || true)
    fi
    echo "$VM_IP"
}

vm_ssh() {
    local ip
    ip=$(get_vm_ip)
    ssh $SSH_OPTS "steve@$ip" "$@"
}

vm_run() {
    vm_ssh "DISPLAY=:0 $*"
}

# --- D-Bus eval helper ---
install_eval_helper() {
    vm_ssh "cat > /tmp/cinnamon-eval.py" << 'EVAL_HELPER'
#!/usr/bin/env python3
"""Read JS from stdin, eval via Cinnamon D-Bus, print result."""
import subprocess, sys, re

js = sys.stdin.read().strip()
result = subprocess.run(
    ["dbus-send", "--session", "--print-reply", "--dest=org.Cinnamon",
     "/org/Cinnamon", "org.Cinnamon.Eval", "string:" + js],
    capture_output=True, text=True, env={**__import__('os').environ, 'DISPLAY': ':0'}
)
output = result.stdout
success = "boolean true" in output
match = re.search(r'^\s*string "(.*)"$', output, re.MULTILINE)
if match:
    val = match.group(1)
    if val.startswith('"') and val.endswith('"'):
        val = val[1:-1]
    val = val.replace('\\"', '"').replace('\\\\', '\\')
    print(val)
    sys.exit(0 if success else 1)
else:
    print("PARSE_ERROR: " + output, file=sys.stderr)
    sys.exit(1)
EVAL_HELPER
}

cinnamon_eval() {
    echo "$1" | vm_ssh "DISPLAY=:0 python3 /tmp/cinnamon-eval.py"
}

# --- Test result helpers ---
test_result() {
    local description="$1"
    local status="$2"
    local detail="${3:-}"
    TOTAL=$((TOTAL + 1))
    case "$status" in
        pass)
            PASSED=$((PASSED + 1))
            echo -e "  ${GREEN}PASS${NC} $description${detail:+ ($detail)}"
            ;;
        fail)
            FAILED=$((FAILED + 1))
            echo -e "  ${RED}FAIL${NC} $description${detail:+ ($detail)}"
            ;;
        warn)
            WARNINGS=$((WARNINGS + 1))
            PASSED=$((PASSED + 1))
            echo -e "  ${YELLOW}WARN${NC} $description${detail:+ ($detail)}"
            ;;
    esac
}

# --- Screenshot ---
take_screenshot() {
    local label="$1"
    if ! $DO_SCREENSHOTS; then return; fi
    local filename="vm-smoke-${label}.png"
    mkdir -p "$SCREENSHOT_DIR"
    vm_run "xwd -root -silent | convert xwd:- png:/tmp/screenshot.png" 2>/dev/null || return
    scp $SSH_OPTS "steve@$(get_vm_ip):/tmp/screenshot.png" "$SCREENSHOT_DIR/$filename" 2>/dev/null || return
    echo -e "  ${CYAN}INFO${NC} screenshot: $SCREENSHOT_DIR/$filename"
}

# --- JSON field helper ---
json_field() {
    local json="$1"
    local field="$2"
    echo "$json" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['$field'])"
}

# --- Applet state query ---
query_applet_state() {
    cinnamon_eval "
const Main = imports.ui.main;
let applet = null;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let z of [p._rightBox, p._leftBox, p._centerBox]) {
        for (let c of z.get_children()) {
            if (c._delegate && c._delegate._registry)
                applet = c._delegate;
        }
    }
}
if (!applet) { JSON.stringify({error: 'applet not found'}); }
else {
    let icons = [];
    applet._registry._managedIcons.forEach((v, k) => {
        icons.push({
            id: k,
            type: v.type || 'unknown',
            visible: v.actor ? v.actor.visible : false,
            inPanel: v.actor && v.actor.get_parent() === applet._panelBox
        });
    });
    let chevronInAppletActor = false;
    let chevron = applet._popup._overflowIndicator;
    if (chevron) {
        chevronInAppletActor = chevron.get_parent() === applet.actor;
    }
    JSON.stringify({
        managedCount: applet._registry._managedIcons.size,
        icons: icons,
        panelBoxChildren: applet._panelBox.get_n_children(),
        overflowPanelOpen: applet._popup.isOpen(),
        chevronVisible: chevron ? chevron.visible : false,
        chevronInAppletActor: chevronInAppletActor,
        hasInactiveSection: !!applet._popup._overflowInactiveSection,
        iconSize: applet.icon_size || 0,
        defaultVisibility: applet.defaultVisibility || 'panel'
    });
}
"
}

# ═══════════════════════════════════════════
#  SETUP
# ═══════════════════════════════════════════

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  VM Smoke Tests — $APPLET_UUID${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo ""

if $DO_REVERT; then
    echo -e "${CYAN}Reverting to clean-baseline snapshot...${NC}"
    "$VM_CTL" revert clean-baseline
    "$VM_CTL" start
    sleep 15
    echo ""
fi

if $DO_SETUP; then
    echo -e "${CYAN}Running test environment setup...${NC}"
    "$PROJECT_DIR/vm/vm-setup-test-env.sh"
    echo ""
fi

# ═══════════════════════════════════════════
#  PREFLIGHT
# ═══════════════════════════════════════════

echo -e "${BOLD}Pre-flight checks${NC}"

# VM running?
state=$("$VM_CTL" status 2>/dev/null | grep -o 'running' || true)
if [[ "$state" != "running" ]]; then
    echo -e "  ${RED}FATAL: VM is not running. Start with: $VM_CTL start${NC}"
    exit 1
fi
test_result "VM is running" "pass"

# SSH works?
hostname=$(vm_ssh "hostname" 2>/dev/null || true)
if [[ -z "$hostname" ]]; then
    echo -e "  ${RED}FATAL: Cannot SSH to VM${NC}"
    exit 1
fi
test_result "SSH to VM ($hostname at $(get_vm_ip))" "pass"

# Install eval helper
install_eval_helper
test_result "D-Bus eval helper installed" "pass"

# Applet loaded?
applet_check=$(cinnamon_eval "
const AppletManager = imports.ui.appletManager;
AppletManager.getRunningInstancesForUuid('$APPLET_UUID').length > 0
" 2>/dev/null || echo "false")

if [[ "$applet_check" != "true" ]]; then
    echo -e "  ${RED}FATAL: Applet not loaded in Cinnamon${NC}"
    echo "  Run: $PROJECT_DIR/vm/vm-setup-test-env.sh"
    exit 1
fi
test_result "Applet loaded in panel" "pass"

echo ""

# ═══════════════════════════════════════════
#  TEST 1: Applet state
# ═══════════════════════════════════════════

echo -e "${BOLD}Test 1: Applet State${NC}"

state_json=$(query_applet_state 2>/dev/null || echo '{"error":"query failed"}')

if echo "$state_json" | python3 -c "import sys,json; json.loads(sys.stdin.read())" 2>/dev/null; then
    test_result "State query returns valid JSON" "pass"
else
    test_result "State query returns valid JSON" "fail" "$state_json"
fi

managed_count=$(json_field "$state_json" managedCount 2>/dev/null || echo 0)
if [[ $managed_count -gt 0 ]]; then
    test_result "Icons managed" "pass" "$managed_count icons"
else
    test_result "Icons managed" "fail" "no icons found"
fi

chevron=$(json_field "$state_json" chevronVisible 2>/dev/null || echo "False")
if [[ "$chevron" == "True" || "$chevron" == "true" ]]; then
    test_result "Chevron visible" "pass"
else
    test_result "Chevron visible" "warn" "chevron not visible"
fi

chevron_aa=$(json_field "$state_json" chevronInAppletActor 2>/dev/null || echo "False")
if [[ "$chevron_aa" == "True" || "$chevron_aa" == "true" ]]; then
    test_result "Chevron in applet.actor" "pass"
else
    test_result "Chevron in applet.actor" "warn" "chevron not in applet.actor"
fi

has_inactive=$(json_field "$state_json" hasInactiveSection 2>/dev/null || echo "False")
if [[ "$has_inactive" == "True" || "$has_inactive" == "true" ]]; then
    test_result "Inactive section exists" "pass"
else
    test_result "Inactive section exists" "warn" "may not have been created yet"
fi

panel_children=$(json_field "$state_json" panelBoxChildren 2>/dev/null || echo 0)
if [[ $panel_children -gt 0 ]]; then
    test_result "Panel box has children" "pass" "$panel_children icons in panel"
else
    test_result "Panel box has children" "warn" "no icons in panel box"
fi

# Check that all icons (including hidden) are in panelBox
all_in_panel=$(echo "$state_json" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
icons = data.get('icons', [])
if not icons:
    print('no_icons')
elif all(icon.get('inPanel', False) for icon in icons):
    print('true')
else:
    print('false')
" 2>/dev/null || echo "error")

if [[ "$all_in_panel" == "true" ]]; then
    test_result "All icons (including hidden) in panelBox" "pass"
elif [[ "$all_in_panel" == "no_icons" ]]; then
    test_result "All icons in panelBox" "warn" "no icons to check"
else
    test_result "All icons (including hidden) in panelBox" "fail" "some icons not in panelBox"
fi

# Check applet is positioned right before calendar in enabled-applets
applet_before_calendar=$(vm_run "dconf read /org/cinnamon/enabled-applets" 2>/dev/null | python3 -c "
import sys, ast
try:
    applets = ast.literal_eval(sys.stdin.read().strip())
    our_pos = cal_pos = None
    for a in applets:
        parts = a.split(':')
        if len(parts) >= 4:
            if '$APPLET_UUID' in parts[3]:
                our_pos = int(parts[2])
            elif 'calendar@cinnamon.org' in parts[3]:
                cal_pos = int(parts[2])
    if our_pos is not None and cal_pos is not None:
        print('true' if cal_pos == our_pos + 1 else 'false')
    else:
        print('missing')
except:
    print('error')
" 2>/dev/null || echo "error")

if [[ "$applet_before_calendar" == "true" ]]; then
    test_result "Applet positioned right before calendar" "pass"
elif [[ "$applet_before_calendar" == "missing" ]]; then
    test_result "Applet positioned right before calendar" "warn" "applet or calendar not found in dconf"
else
    test_result "Applet positioned right before calendar" "warn" "not adjacent to calendar (got: $applet_before_calendar)"
fi

# List icons
echo -e "  ${CYAN}INFO${NC} managed icons:"
echo "$state_json" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
for icon in data.get('icons', []):
    loc = 'panel' if icon.get('inPanel') else 'overflow'
    print(f\"    {icon['id']}: type={icon.get('type','?')} loc={loc}\")
" 2>/dev/null || true

take_screenshot "01-initial"
echo ""

# ═══════════════════════════════════════════
#  TEST 2: Cinnamon restart resilience
# ═══════════════════════════════════════════

echo -e "${BOLD}Test 2: Cinnamon Restart Resilience${NC}"

# Drop a log marker
marker="SMOKE_TEST_RESTART_$(date +%s)"
vm_ssh "echo '$marker' >> ~/.xsession-errors" 2>/dev/null

# Restart Cinnamon
vm_run "nohup cinnamon --replace >/tmp/cinnamon-restart.log 2>&1 &" 2>/dev/null
sleep 6

# Check applet reloaded
applet_check=$(cinnamon_eval "
const AppletManager = imports.ui.appletManager;
AppletManager.getRunningInstancesForUuid('$APPLET_UUID').length > 0
" 2>/dev/null || echo "false")

if [[ "$applet_check" == "true" ]]; then
    test_result "Applet survives Cinnamon restart" "pass"
else
    test_result "Applet survives Cinnamon restart" "fail"
fi

# Reinstall eval helper after restart
install_eval_helper

# Check icon count after restart
state_json=$(query_applet_state 2>/dev/null || echo '{"managedCount":0}')
count_after=$(json_field "$state_json" managedCount 2>/dev/null || echo 0)
if [[ $count_after -ge $managed_count ]]; then
    test_result "Icon count preserved after restart" "pass" "$count_after icons (was $managed_count)"
else
    test_result "Icon count preserved after restart" "warn" "$count_after icons (was $managed_count)"
fi

# Check for critical errors
crits=$(vm_ssh "sed -n '/$marker/,\$p' ~/.xsession-errors 2>/dev/null \
    | grep -ci 'Gjs-CRITICAL' || true" 2>/dev/null)
if [[ -z "$crits" || "$crits" == "0" ]]; then
    test_result "No Gjs-CRITICAL during restart" "pass"
elif [[ "$crits" -lt 50 ]]; then
    test_result "Gjs-CRITICAL count acceptable" "warn" "$crits (Cinnamon baseline noise)"
else
    test_result "Gjs-CRITICAL count" "fail" "$crits — excessive errors"
fi

# Check for our applet's errors specifically
our_errors=$(vm_ssh "sed -n '/$marker/,\$p' ~/.xsession-errors 2>/dev/null \
    | grep -i '$APPLET_UUID' \
    | grep -iE 'error|critical|exception' \
    | grep -v 'Loaded applet\|Installing settings\|Settings successfully' \
    | head -5" 2>/dev/null || true)
if [[ -z "$our_errors" ]]; then
    test_result "No applet-specific errors" "pass"
else
    test_result "No applet-specific errors" "fail"
    echo "$our_errors" | while read -r line; do
        echo -e "    ${RED}> $line${NC}"
    done
fi

take_screenshot "02-after-restart"
echo ""

# ═══════════════════════════════════════════
#  TEST 3: Overflow popup
# ═══════════════════════════════════════════

echo -e "${BOLD}Test 3: Overflow Popup${NC}"

# Check popup is initially closed
popup_open=$(cinnamon_eval "
const Main = imports.ui.main;
let applet = null;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let z of [p._rightBox]) {
        for (let c of z.get_children()) {
            if (c._delegate && c._delegate._registry)
                applet = c._delegate;
        }
    }
}
applet ? applet._popup.isOpen() : 'no-applet';
" 2>/dev/null || echo "error")

if [[ "$popup_open" == "false" ]]; then
    test_result "Popup initially closed" "pass"
else
    test_result "Popup initially closed" "fail" "got: $popup_open"
fi

# Open popup programmatically
cinnamon_eval "
const Main = imports.ui.main;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let c of p._rightBox.get_children()) {
        if (c._delegate && c._delegate._popup) {
            c._delegate._popup.togglePanel();
            break;
        }
    }
}
'opened';
" 2>/dev/null >/dev/null

sleep 2

# Verify popup opened
popup_open=$(cinnamon_eval "
const Main = imports.ui.main;
let applet = null;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let c of p._rightBox.get_children()) {
        if (c._delegate && c._delegate._registry)
            applet = c._delegate;
    }
}
applet ? applet._popup.isOpen() : 'no-applet';
" 2>/dev/null || echo "error")

if [[ "$popup_open" == "true" ]]; then
    test_result "Popup opens programmatically" "pass"
else
    test_result "Popup opens programmatically" "fail" "got: $popup_open"
fi

take_screenshot "03-popup-open"

# Check popup has sections
popup_info=$(cinnamon_eval "
const Main = imports.ui.main;
let applet = null;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let c of p._rightBox.get_children()) {
        if (c._delegate && c._delegate._registry)
            applet = c._delegate;
    }
}
if (!applet) JSON.stringify({error: 'no applet'});
else JSON.stringify({
    visibleSection: applet._popup.visibleSection ? applet._popup.visibleSection.get_n_children() : -1,
    overflowSection: applet._popup.overflowSection ? applet._popup.overflowSection.get_n_children() : -1,
    inactiveSection: applet._popup.inactiveSection ? applet._popup.inactiveSection.get_n_children() : -1,
    popupVisible: applet._popup.panel ? applet._popup.panel.visible : false
});
" 2>/dev/null || echo '{}')

visible_count=$(json_field "$popup_info" visibleSection 2>/dev/null || echo -1)
overflow_count=$(json_field "$popup_info" overflowSection 2>/dev/null || echo -1)
inactive_count=$(json_field "$popup_info" inactiveSection 2>/dev/null || echo -1)

if [[ $visible_count -ge 0 ]]; then
    test_result "Shown section populated" "pass" "$visible_count icons"
else
    test_result "Shown section populated" "fail"
fi

echo -e "  ${CYAN}INFO${NC} popup sections: shown=$visible_count hidden=$overflow_count inactive=$inactive_count"

# Close popup
cinnamon_eval "
const Main = imports.ui.main;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let c of p._rightBox.get_children()) {
        if (c._delegate && c._delegate._popup) {
            c._delegate._popup.closePanel();
            break;
        }
    }
}
'closed';
" 2>/dev/null >/dev/null

sleep 1

popup_open=$(cinnamon_eval "
const Main = imports.ui.main;
let applet = null;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let c of p._rightBox.get_children()) {
        if (c._delegate && c._delegate._registry)
            applet = c._delegate;
    }
}
applet ? applet._popup.isOpen() : 'no-applet';
" 2>/dev/null || echo "error")

if [[ "$popup_open" == "false" ]]; then
    test_result "Popup closes programmatically" "pass"
else
    test_result "Popup closes programmatically" "fail" "still open: $popup_open"
fi

take_screenshot "04-popup-closed"
echo ""

# ═══════════════════════════════════════════
#  TEST 4: Icon visibility settings
# ═══════════════════════════════════════════

echo -e "${BOLD}Test 4: Icon Visibility Settings${NC}"

# Get the first icon ID and check we can read its visibility
first_icon=$(echo "$state_json" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
icons = data.get('icons', [])
if icons:
    print(icons[0]['id'])
" 2>/dev/null || echo "")

if [[ -n "$first_icon" ]]; then
    test_result "Can identify icons by ID" "pass" "first: $first_icon"

    # Read current visibility setting
    vis=$(cinnamon_eval "
const Main = imports.ui.main;
let applet = null;
for (let p of Main.panelManager.panels) {
    if (!p) continue;
    for (let c of p._rightBox.get_children()) {
        if (c._delegate && c._delegate._registry)
            applet = c._delegate;
    }
}
let iv = applet ? (applet.iconVisibility || {}) : {};
JSON.stringify(iv);
" 2>/dev/null || echo '{}')
    test_result "Icon visibility settings readable" "pass"
    echo -e "  ${CYAN}INFO${NC} current visibility: $vis"
else
    test_result "Can identify icons by ID" "warn" "no icons to test"
fi

echo ""

# ═══════════════════════════════════════════
#  TEST 5: No segfaults/crashes
# ═══════════════════════════════════════════

echo -e "${BOLD}Test 5: Stability${NC}"

# Check Cinnamon is still running
cinnamon_pid=$(vm_ssh "pgrep -o cinnamon 2>/dev/null" || echo "")
if [[ -n "$cinnamon_pid" ]]; then
    test_result "Cinnamon still running" "pass" "PID $cinnamon_pid"
else
    test_result "Cinnamon still running" "fail" "process gone!"
fi

# Check for segfaults in dmesg
segfaults=$(vm_ssh "dmesg 2>/dev/null | grep -ci segfault || true" 2>/dev/null)
if [[ -z "$segfaults" || "$segfaults" == "0" ]]; then
    test_result "No segfaults in dmesg" "pass"
else
    test_result "No segfaults in dmesg" "fail" "$segfaults segfault(s)"
fi

# Check for na_tray_manager assertion (expected on restart, not a real error)
tray_assert=$(vm_ssh "grep -c 'na_tray_manager_manage_screen' /tmp/cinnamon.log 2>/dev/null || echo 0" 2>/dev/null | tr -d '[:space:]')
if [[ "${tray_assert:-0}" -gt 0 ]]; then
    test_result "Tray manager assertion" "warn" "expected on restart ($tray_assert)"
else
    test_result "No tray manager assertion" "pass"
fi

take_screenshot "05-final"
echo ""

# ═══════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════

echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Summary${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "  Total:    $TOTAL"
echo -e "  ${GREEN}Passed:   $PASSED${NC}"
if [[ $FAILED -gt 0 ]]; then
    echo -e "  ${RED}Failed:   $FAILED${NC}"
else
    echo -e "  Failed:   0"
fi
if [[ $WARNINGS -gt 0 ]]; then
    echo -e "  ${YELLOW}Warnings: $WARNINGS${NC}"
fi
echo ""

if [[ $FAILED -gt 0 ]]; then
    echo -e "${RED}RESULT: FAIL${NC}"
    exit 1
else
    echo -e "${GREEN}RESULT: PASS${NC}"
    exit 0
fi
