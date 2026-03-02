#!/bin/bash
# dev-deploy.sh — Deploy applet to cinnamon-dev VM and open SPICE viewer for UAT.
#
# Runs from the host. Deploys the applet on the VM via the virtio-fs shared
# mount, swaps stock systray/xapp-status applets in dconf, restarts Cinnamon,
# verifies the applet loaded, and opens a SPICE viewer window.
#
# Idempotent — re-run after code changes to restart Cinnamon and reload.
# Code changes are picked up automatically via the virtio-fs mount.
#
# Usage:
#   ./dev-deploy.sh              # Deploy to VM + open viewer
#   ./dev-deploy.sh --no-viewer  # Deploy without opening viewer
#   ./dev-deploy.sh --restart    # Just restart Cinnamon on VM (skip install)
#   ./dev-deploy.sh --uninstall  # Restore stock applets on VM

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VM_CTL="$SCRIPT_DIR/vm/vm-ctl.sh"
UUID="systray-overflow@cinnamon"
STOCK_SYSTRAY="systray@cinnamon.org"
STOCK_XAPP="xapp-status@cinnamon.org"
VM_MOUNT="/mnt/host-dev/cinnamon-systray-overflow"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5"
VM_IP=""

get_vm_ip() {
    if [[ -z "$VM_IP" ]]; then
        VM_IP=$("$VM_CTL" ip 2>/dev/null || true)
    fi
    echo "$VM_IP"
}

vm_ssh() {
    ssh $SSH_OPTS "steve@$(get_vm_ip)" "$@"
}

vm_run() {
    vm_ssh "DISPLAY=:0 $*"
}

vm_dconf_read() {
    vm_run "dconf read $1" 2>/dev/null || echo "[]"
}

vm_dconf_write() {
    vm_run "dconf write $1 \"$2\""
}

vm_eval() {
    local js="$1"
    vm_ssh "DISPLAY=:0 dbus-send --session --print-reply --dest=org.Cinnamon \
        /org/Cinnamon org.Cinnamon.Eval string:\"$js\"" 2>/dev/null \
        | grep -oP 'string "\K[^"]*' || echo ""
}

# ─── Preflight ────────────────────────────────────────────────

preflight() {
    # VM running?
    local state
    state=$("$VM_CTL" status 2>/dev/null | grep -o 'running' || true)
    if [[ "$state" != "running" ]]; then
        echo -e "${RED}ERROR: VM is not running. Start with: $VM_CTL start${NC}"
        exit 1
    fi

    # SSH works?
    local hostname
    hostname=$(vm_ssh "hostname" 2>/dev/null || true)
    if [[ -z "$hostname" ]]; then
        echo -e "${RED}ERROR: Cannot SSH to VM at $(get_vm_ip)${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}VM running${NC} ($hostname at $(get_vm_ip))"

    # virtio-fs mount?
    local mount_ok
    mount_ok=$(vm_ssh "test -d $VM_MOUNT && echo ok" 2>/dev/null || true)
    if [[ "$mount_ok" != "ok" ]]; then
        echo -e "${RED}ERROR: virtio-fs mount not found at $VM_MOUNT${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}virtio-fs mount OK${NC}"
}

# ─── Restart only ─────────────────────────────────────────────

restart_cinnamon() {
    echo -e "  Restarting Cinnamon on VM..."
    vm_ssh "DISPLAY=:0 nohup cinnamon --replace >/tmp/cinnamon.log 2>&1 &" 2>/dev/null
    sleep 4

    local loaded
    loaded=$(vm_eval "imports.ui.appletManager.getRunningInstancesForUuid('$UUID').length")
    if [[ "$loaded" -ge 1 ]]; then
        echo -e "  ${GREEN}Applet loaded${NC} ($loaded instance)"
    else
        echo -e "  ${RED}Applet NOT loaded — check VM ~/.xsession-errors${NC}"
        vm_ssh "grep -i '$UUID' ~/.xsession-errors 2>/dev/null | grep -iE 'error|exception' | tail -3" 2>/dev/null || true
        return 1
    fi
}

# ─── Uninstall mode ───────────────────────────────────────────

if [[ "${1:-}" == "--uninstall" ]]; then
    echo -e "${BOLD}Restoring stock applets on VM...${NC}"
    preflight

    CURRENT=$(vm_dconf_read /org/cinnamon/enabled-applets)
    UPDATED=$(echo "$CURRENT" | python3 -c "
import sys, ast
applets = ast.literal_eval(sys.stdin.read().strip())
applets = [a for a in applets if '$UUID' not in a]
has_systray = any('$STOCK_SYSTRAY' in a for a in applets)
has_xapp = any('$STOCK_XAPP' in a for a in applets)
if not has_systray:
    applets.append('panel1:right:24:$STOCK_SYSTRAY:3')
if not has_xapp:
    applets.append('panel1:right:25:$STOCK_XAPP:4')
print(applets)
")
    vm_dconf_write /org/cinnamon/enabled-applets "$UPDATED"
    echo -e "  ${GREEN}Stock applets restored${NC}"

    vm_ssh "rm -f ~/.local/share/cinnamon/applets/$UUID" 2>/dev/null || true
    echo -e "  ${GREEN}Symlink removed${NC}"

    vm_ssh "DISPLAY=:0 nohup cinnamon --replace >/tmp/cinnamon.log 2>&1 &" 2>/dev/null
    sleep 4
    echo -e "${GREEN}Done — stock applets restored on VM.${NC}"
    exit 0
fi

# ─── Restart-only mode ────────────────────────────────────────

if [[ "${1:-}" == "--restart" ]]; then
    echo -e "${BOLD}Restarting Cinnamon on VM...${NC}"
    preflight
    restart_cinnamon
    echo -e "${GREEN}Done.${NC}"
    exit 0
fi

# ─── Parse options ────────────────────────────────────────────

OPEN_VIEWER=true
for arg in "$@"; do
    case "$arg" in
        --no-viewer) OPEN_VIEWER=false ;;
    esac
done

# ─── Deploy mode ──────────────────────────────────────────────

echo -e "${BOLD}Deploying $UUID to VM...${NC}"
echo ""
preflight

# 1. Install applet via virtio-fs symlink
INSTALLED=$(vm_ssh "readlink -f ~/.local/share/cinnamon/applets/$UUID 2>/dev/null" || true)
if [[ "$INSTALLED" == "$VM_MOUNT" ]]; then
    echo -e "  ${GREEN}Symlink OK${NC}"
else
    vm_ssh "mkdir -p ~/.local/share/cinnamon/applets && \
            rm -f ~/.local/share/cinnamon/applets/$UUID && \
            ln -s $VM_MOUNT ~/.local/share/cinnamon/applets/$UUID" 2>/dev/null
    echo -e "  ${GREEN}Symlink created${NC} → $VM_MOUNT"
fi

# 2. Swap dconf: remove stock systray + xapp-status, add ours
CURRENT=$(vm_dconf_read /org/cinnamon/enabled-applets)
HAS_OURS=$(echo "$CURRENT" | grep -c "$UUID" || true)
HAS_STOCK=$(echo "$CURRENT" | grep -cE "$STOCK_SYSTRAY|$STOCK_XAPP" || true)

if [[ $HAS_OURS -gt 0 && $HAS_STOCK -eq 0 ]]; then
    echo -e "  ${GREEN}dconf OK${NC} (already configured)"
else
    UPDATED=$(echo "$CURRENT" | python3 -c "
import sys, ast
applets = ast.literal_eval(sys.stdin.read().strip())
applets = [a for a in applets if '$STOCK_SYSTRAY' not in a and '$STOCK_XAPP' not in a and '$UUID' not in a]
# Find calendar position and insert just before it
cal_pos = None
for a in applets:
    if 'calendar@cinnamon.org' in a:
        parts = a.split(':')
        cal_pos = int(parts[2])
        break
our_pos = cal_pos if cal_pos is not None else 99
# Bump calendar and anything at/after our position up by 1
new_applets = []
for a in applets:
    parts = a.split(':')
    if len(parts) >= 3 and parts[1] == 'right' and int(parts[2]) >= our_pos:
        parts[2] = str(int(parts[2]) + 1)
    new_applets.append(':'.join(parts))
new_applets.append('panel1:right:' + str(our_pos) + ':$UUID:3')
print(new_applets)
")
    vm_dconf_write /org/cinnamon/enabled-applets "$UPDATED"
    echo -e "  ${GREEN}dconf updated${NC} (removed stock, added ours)"
fi

# 3. Restart Cinnamon
restart_cinnamon || exit 1

# 4. Open SPICE viewer
if $OPEN_VIEWER; then
    "$VM_CTL" viewer 2>/dev/null
    echo -e "  ${GREEN}SPICE viewer launched${NC}"
fi

echo ""
echo -e "${GREEN}Done — applet is live on VM desktop.${NC}"
echo -e "After code changes, run ${CYAN}./dev-deploy.sh --restart${NC} to reload."
