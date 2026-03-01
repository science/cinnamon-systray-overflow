#!/bin/bash
# E2E tests for systray-overflow@cinnamon applet.
#
# Runs on the host, drives the cinnamon-dev VM via SSH + D-Bus eval + XTest.
# Tests popup height consistency, DND promote/demote, click forwarding, and more.
#
# Prerequisites:
#   - VM "cinnamon-dev" running with applet installed
#     (run: ./vm/vm-setup-test-env.sh)
#   - python-xlib installed on VM (apt install python3-xlib)
#
# Usage:
#   ./test/vm-e2e-test.sh                # Run all tests
#   ./test/vm-e2e-test.sh --setup        # Set up VM first, then test
#   ./test/vm-e2e-test.sh --revert       # Revert to snapshot first
#   ./test/vm-e2e-test.sh --screenshots  # Take screenshots at each step

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

# --- Test result helper ---
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

# --- Source the eval library (provides eval_js, applet_state, etc.) ---
source "$PROJECT_DIR/vm/test-tools/applet-eval.sh"

# ═══════════════════════════════════════════
#  SETUP
# ═══════════════════════════════════════════

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  E2E Tests — $APPLET_UUID${NC}"
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
applet_check=$(eval_js "
const AppletManager = imports.ui.appletManager;
AppletManager.getRunningInstancesForUuid('$APPLET_UUID').length > 0
" 2>/dev/null || echo "false")

if [[ "$applet_check" != "true" ]]; then
    echo -e "  ${RED}FATAL: Applet not loaded in Cinnamon${NC}"
    echo "  Run: $PROJECT_DIR/vm/vm-setup-test-env.sh"
    exit 1
fi
test_result "Applet loaded in panel" "pass"

# Check python-xlib is available
xlib_check=$(vm_run "python3 -c 'from Xlib.ext import xtest; print(\"ok\")'" 2>/dev/null || echo "fail")
if [[ "$xlib_check" != "ok" ]]; then
    echo -e "  ${RED}FATAL: python3-xlib not installed on VM${NC}"
    echo "  Run: vm-ssh 'sudo apt install -y python3-xlib'"
    exit 1
fi
test_result "python-xlib available on VM" "pass"

# Ensure popup is closed before starting
popup_close >/dev/null 2>&1 || true
sleep 0.5

echo ""

# ═══════════════════════════════════════════
#  SCENARIO 1: Open-Close Height Consistency
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 1: Open-Close Height Consistency${NC}"

# Open popup
popup_open >/dev/null 2>&1
sleep 1

# Get first-open height
state1=$(applet_state 2>/dev/null || echo '{}')
h1=$(json_field "$state1" popupHeight 2>/dev/null || echo 0)
is_open=$(json_field "$state1" popupOpen 2>/dev/null || echo false)

if [[ "$is_open" == "True" || "$is_open" == "true" ]]; then
    test_result "Popup opens programmatically" "pass"
else
    test_result "Popup opens programmatically" "fail" "popupOpen=$is_open"
fi

if [[ $h1 -gt 100 ]]; then
    test_result "First-open height is reasonable" "pass" "h=${h1}px"
else
    test_result "First-open height is reasonable" "fail" "h=${h1}px (expected >100)"
fi

$DO_SCREENSHOTS && screenshot "01-first-open" 2>/dev/null && echo -e "  ${CYAN}INFO${NC} screenshot saved"

# Close and reopen
popup_close >/dev/null 2>&1
sleep 0.5
popup_open >/dev/null 2>&1
sleep 1

# Get second-open height
state2=$(applet_state 2>/dev/null || echo '{}')
h2=$(json_field "$state2" popupHeight 2>/dev/null || echo 0)

if [[ $h1 -eq $h2 ]]; then
    test_result "Reopen height matches first open" "pass" "h1=${h1} h2=${h2}"
else
    test_result "Reopen height matches first open" "fail" "h1=${h1} h2=${h2}"
fi

# Check expected height (196 for 3 sections with 1 row each)
# Allow some tolerance for different icon counts
if [[ $h1 -ge 130 && $h1 -le 500 ]]; then
    test_result "Height in expected range" "pass" "${h1}px"
else
    test_result "Height in expected range" "warn" "${h1}px (expected 130-500)"
fi

popup_close >/dev/null 2>&1
sleep 0.5
echo ""

# ═══════════════════════════════════════════
#  SCENARIO 2: DND Demote (Shown → Hidden)
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 2: DND Demote (Shown → Hidden)${NC}"

# Open popup and get initial counts
popup_open >/dev/null 2>&1
sleep 1

counts_before=$(popup_section_counts 2>/dev/null || echo '{}')
vis_before=$(json_field "$counts_before" visible 2>/dev/null || echo 0)
ov_before=$(json_field "$counts_before" overflow 2>/dev/null || echo 0)
echo -e "  ${CYAN}INFO${NC} before demote: visible=$vis_before overflow=$ov_before"

if [[ $vis_before -lt 1 ]]; then
    test_result "DND demote: need at least 1 visible icon" "warn" "skipping — visible=$vis_before"
    popup_close >/dev/null 2>&1
    sleep 0.5
else
    # Get position of first visible icon (center of 32px cell)
    vis_pos=$(icon_positions "visible" 2>/dev/null || echo '[]')
    first_x=$(( $(json_array_field "$vis_pos" 0 x 2>/dev/null || echo 0) + 16 ))
    first_y=$(( $(json_array_field "$vis_pos" 0 y 2>/dev/null || echo 0) + 16 ))

    bounds=$(popup_bounds 2>/dev/null || echo '{}')
    panel_y=$(json_field "$bounds" y 2>/dev/null || echo 0)
    panel_h=$(json_field "$bounds" h 2>/dev/null || echo 200)
    # Target: bottom quarter of popup (overflow section)
    target_y=$(( panel_y + panel_h - 20 ))
    target_x=$first_x

    echo -e "  ${CYAN}INFO${NC} dragging from ($first_x, $first_y) to ($target_x, $target_y)"

    # Perform drag via XTest
    xtest_drag "$first_x" "$first_y" "$target_x" "$target_y" 15 2>/dev/null
    sleep 1.5

    $DO_SCREENSHOTS && screenshot "02-after-demote" 2>/dev/null && echo -e "  ${CYAN}INFO${NC} screenshot saved"

    # Check counts after demote
    counts_after=$(popup_section_counts 2>/dev/null || echo '{}')
    vis_after=$(json_field "$counts_after" visible 2>/dev/null || echo 0)
    ov_after=$(json_field "$counts_after" overflow 2>/dev/null || echo 0)
    echo -e "  ${CYAN}INFO${NC} after demote: visible=$vis_after overflow=$ov_after"

    if [[ $vis_after -eq $((vis_before - 1)) && $ov_after -eq $((ov_before + 1)) ]]; then
        test_result "DND demote: visible -1, overflow +1" "pass"
    else
        test_result "DND demote: visible -1, overflow +1" "fail" \
            "expected vis=$((vis_before-1)) ov=$((ov_before+1)), got vis=$vis_after ov=$ov_after"
    fi

    popup_close >/dev/null 2>&1
    sleep 0.5
fi
echo ""

# ═══════════════════════════════════════════
#  SCENARIO 3: DND Promote (Hidden → Shown)
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 3: DND Promote (Hidden → Shown)${NC}"

# Open popup and get counts
popup_open >/dev/null 2>&1
sleep 1

counts_before=$(popup_section_counts 2>/dev/null || echo '{}')
vis_before=$(json_field "$counts_before" visible 2>/dev/null || echo 0)
ov_before=$(json_field "$counts_before" overflow 2>/dev/null || echo 0)
echo -e "  ${CYAN}INFO${NC} before promote: visible=$vis_before overflow=$ov_before"

if [[ $ov_before -lt 1 ]]; then
    test_result "DND promote: need at least 1 overflow icon" "warn" "skipping — overflow=$ov_before"
    popup_close >/dev/null 2>&1
    sleep 0.5
else
    # Get position of first overflow icon (center of 32px cell)
    ov_pos=$(icon_positions "overflow" 2>/dev/null || echo '[]')
    src_x=$(( $(json_array_field "$ov_pos" 0 x 2>/dev/null || echo 0) + 16 ))
    src_y=$(( $(json_array_field "$ov_pos" 0 y 2>/dev/null || echo 0) + 16 ))

    # Target: top quarter of popup (visible section)
    bounds=$(popup_bounds 2>/dev/null || echo '{}')
    panel_y=$(json_field "$bounds" y 2>/dev/null || echo 0)
    target_y=$(( panel_y + 30 ))
    target_x=$src_x

    echo -e "  ${CYAN}INFO${NC} dragging from ($src_x, $src_y) to ($target_x, $target_y)"

    # Perform drag via XTest
    xtest_drag "$src_x" "$src_y" "$target_x" "$target_y" 15 2>/dev/null
    sleep 1.5

    $DO_SCREENSHOTS && screenshot "03-after-promote" 2>/dev/null && echo -e "  ${CYAN}INFO${NC} screenshot saved"

    # Check counts after promote
    counts_after=$(popup_section_counts 2>/dev/null || echo '{}')
    vis_after=$(json_field "$counts_after" visible 2>/dev/null || echo 0)
    ov_after=$(json_field "$counts_after" overflow 2>/dev/null || echo 0)
    echo -e "  ${CYAN}INFO${NC} after promote: visible=$vis_after overflow=$ov_after"

    if [[ $vis_after -eq $((vis_before + 1)) && $ov_after -eq $((ov_before - 1)) ]]; then
        test_result "DND promote: overflow -1, visible +1" "pass"
    else
        test_result "DND promote: overflow -1, visible +1" "fail" \
            "expected vis=$((vis_before+1)) ov=$((ov_before-1)), got vis=$vis_after ov=$ov_after"
    fi

    popup_close >/dev/null 2>&1
    sleep 0.5
fi
echo ""

# ═══════════════════════════════════════════
#  SCENARIO 4: Click Shown Icon Closes Popup
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 4: Click Shown Icon Closes Popup${NC}"

popup_open >/dev/null 2>&1
sleep 1

counts=$(popup_section_counts 2>/dev/null || echo '{}')
vis_count=$(json_field "$counts" visible 2>/dev/null || echo 0)

if [[ $vis_count -lt 1 ]]; then
    test_result "Click shown: need visible icons" "warn" "skipping"
    popup_close >/dev/null 2>&1
    sleep 0.5
else
    vis_pos=$(icon_positions "visible" 2>/dev/null || echo '[]')
    click_x=$(json_array_field "$vis_pos" 0 x 2>/dev/null || echo 0)
    click_y=$(json_array_field "$vis_pos" 0 y 2>/dev/null || echo 0)
    # Offset to center of icon (icons are ~32px)
    click_x=$(( click_x + 16 ))
    click_y=$(( click_y + 16 ))

    echo -e "  ${CYAN}INFO${NC} clicking shown icon at ($click_x, $click_y)"
    xtest_click "$click_x" "$click_y" 2>/dev/null
    sleep 1

    state_after=$(applet_state 2>/dev/null || echo '{}')
    is_open=$(json_field "$state_after" popupOpen 2>/dev/null || echo true)

    if [[ "$is_open" == "False" || "$is_open" == "false" ]]; then
        test_result "Click shown icon closes popup" "pass"
    else
        test_result "Click shown icon closes popup" "fail" "popup still open"
    fi
fi
echo ""

# ═══════════════════════════════════════════
#  SCENARIO 5: Click Hidden Icon Forwards
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 5: Click Hidden Icon Forwards Click${NC}"

popup_open >/dev/null 2>&1
sleep 1

counts=$(popup_section_counts 2>/dev/null || echo '{}')
ov_count=$(json_field "$counts" overflow 2>/dev/null || echo 0)

if [[ $ov_count -lt 1 ]]; then
    test_result "Click hidden: need overflow icons" "warn" "skipping"
    popup_close >/dev/null 2>&1
    sleep 0.5
else
    ov_pos=$(icon_positions "overflow" 2>/dev/null || echo '[]')
    click_x=$(json_array_field "$ov_pos" 0 x 2>/dev/null || echo 0)
    click_y=$(json_array_field "$ov_pos" 0 y 2>/dev/null || echo 0)
    click_x=$(( click_x + 16 ))
    click_y=$(( click_y + 16 ))

    echo -e "  ${CYAN}INFO${NC} clicking hidden icon at ($click_x, $click_y)"
    xtest_click "$click_x" "$click_y" 2>/dev/null
    sleep 1

    # After clicking a hidden icon, popup should close (click is forwarded)
    state_after=$(applet_state 2>/dev/null || echo '{}')
    is_open=$(json_field "$state_after" popupOpen 2>/dev/null || echo true)

    if [[ "$is_open" == "False" || "$is_open" == "false" ]]; then
        test_result "Click hidden icon closes popup (forwarding click)" "pass"
    else
        test_result "Click hidden icon closes popup" "fail" "popup still open"
        popup_close >/dev/null 2>&1
        sleep 0.5
    fi
fi
echo ""

# ═══════════════════════════════════════════
#  SCENARIO 6: Rapid Open/Close Cycle
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 6: Rapid Open/Close Cycle (5x)${NC}"

# Drop an error marker
marker="E2E_RAPID_$(date +%s)"
vm_ssh "echo '$marker' >> ~/.xsession-errors" 2>/dev/null

heights=()
for i in $(seq 1 5); do
    popup_open >/dev/null 2>&1
    sleep 0.8

    s=$(applet_state 2>/dev/null || echo '{}')
    h=$(json_field "$s" popupHeight 2>/dev/null || echo 0)
    heights+=("$h")

    popup_close >/dev/null 2>&1
    sleep 0.3
done

# Check all heights are equal
all_equal=true
for h in "${heights[@]}"; do
    if [[ "$h" != "${heights[0]}" ]]; then
        all_equal=false
        break
    fi
done

if $all_equal && [[ ${heights[0]} -gt 0 ]]; then
    test_result "5x open/close: consistent heights" "pass" "all=${heights[0]}px"
else
    test_result "5x open/close: consistent heights" "fail" "heights: ${heights[*]}"
fi

# Check for errors during rapid cycling
our_errors=$(vm_ssh "sed -n '/$marker/,\$p' ~/.xsession-errors 2>/dev/null \
    | grep -i '$APPLET_UUID' \
    | grep -iE 'error|critical|exception' \
    | grep -v 'Loaded applet\|Installing settings\|Settings successfully' \
    | head -5" 2>/dev/null || true)
if [[ -z "$our_errors" ]]; then
    test_result "5x rapid cycle: no applet errors" "pass"
else
    test_result "5x rapid cycle: applet errors found" "fail"
    echo "$our_errors" | while read -r line; do
        echo -e "    ${RED}> $line${NC}"
    done
fi

echo ""

# ═══════════════════════════════════════════
#  SCENARIO 7: DND After Reopen
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 7: DND After Reopen${NC}"

# Open, close, reopen — then try a DND demote
popup_open >/dev/null 2>&1
sleep 0.5
popup_close >/dev/null 2>&1
sleep 0.5
popup_open >/dev/null 2>&1
sleep 1.5

counts_before=$(popup_section_counts 2>/dev/null || echo '{}')
vis_before=$(json_field "$counts_before" visible 2>/dev/null || echo 0)
ov_before=$(json_field "$counts_before" overflow 2>/dev/null || echo 0)
echo -e "  ${CYAN}INFO${NC} before reopen-DND: visible=$vis_before overflow=$ov_before"

if [[ $vis_before -lt 1 ]]; then
    test_result "DND after reopen: need visible icons" "warn" "skipping"
    popup_close >/dev/null 2>&1
    sleep 0.5
else
    vis_pos=$(icon_positions "visible" 2>/dev/null || echo '[]')
    first_x=$(( $(json_array_field "$vis_pos" 0 x 2>/dev/null || echo 0) + 16 ))
    first_y=$(( $(json_array_field "$vis_pos" 0 y 2>/dev/null || echo 0) + 16 ))

    bounds=$(popup_bounds 2>/dev/null || echo '{}')
    panel_y=$(json_field "$bounds" y 2>/dev/null || echo 0)
    panel_h=$(json_field "$bounds" h 2>/dev/null || echo 200)
    target_y=$(( panel_y + panel_h - 20 ))

    echo -e "  ${CYAN}INFO${NC} dragging from ($first_x, $first_y) to ($first_x, $target_y)"

    xtest_drag "$first_x" "$first_y" "$first_x" "$target_y" 15 2>/dev/null
    sleep 2

    counts_after=$(popup_section_counts 2>/dev/null || echo '{}')
    vis_after=$(json_field "$counts_after" visible 2>/dev/null || echo 0)
    ov_after=$(json_field "$counts_after" overflow 2>/dev/null || echo 0)
    echo -e "  ${CYAN}INFO${NC} after reopen-DND: visible=$vis_after overflow=$ov_after"

    if [[ $vis_after -eq $((vis_before - 1)) && $ov_after -eq $((ov_before + 1)) ]]; then
        test_result "DND works after close→reopen cycle" "pass"
    else
        test_result "DND works after close→reopen cycle" "fail" \
            "expected vis=$((vis_before-1)) ov=$((ov_before+1)), got vis=$vis_after ov=$ov_after"
    fi

    popup_close >/dev/null 2>&1
    sleep 0.5
fi
echo ""

# ═══════════════════════════════════════════
#  SCENARIO 8: Escape Closes Popup
# ═══════════════════════════════════════════

echo -e "${BOLD}Scenario 8: Escape Closes Popup${NC}"

popup_open >/dev/null 2>&1
sleep 1

state_before=$(applet_state 2>/dev/null || echo '{}')
is_open=$(json_field "$state_before" popupOpen 2>/dev/null || echo false)

if [[ "$is_open" != "True" && "$is_open" != "true" ]]; then
    test_result "Escape test: popup must be open first" "fail"
else
    xtest_key "Escape" 2>/dev/null
    sleep 0.8

    state_after=$(applet_state 2>/dev/null || echo '{}')
    is_open=$(json_field "$state_after" popupOpen 2>/dev/null || echo true)

    if [[ "$is_open" == "False" || "$is_open" == "false" ]]; then
        test_result "Escape key closes popup" "pass"
    else
        test_result "Escape key closes popup" "fail" "popup still open"
        popup_close >/dev/null 2>&1
        sleep 0.5
    fi
fi

$DO_SCREENSHOTS && screenshot "08-final" 2>/dev/null && echo -e "  ${CYAN}INFO${NC} screenshot saved"
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
