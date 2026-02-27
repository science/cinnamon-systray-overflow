#!/bin/bash
# Uninstall systray-overflow@cinnamon applet
#
# Safe to run from a TTY if Cinnamon has crashed.
# Removes the applet from dconf and deletes the symlink/directory.
# Does NOT require a running GUI — only needs dconf and a shell.
#
# Usage: ./uninstall.sh

set -eo pipefail

UUID="systray-overflow@cinnamon"
STOCK_SYSTRAY_UUID="systray@cinnamon.org"
STOCK_XAPP_UUID="xapp-status@cinnamon.org"
APPLET_DIR="$HOME/.local/share/cinnamon/applets/$UUID"

echo "Uninstalling $UUID..."
echo ""

# 1. Check if dconf is available (needed for enabled-applets)
if ! command -v dconf &>/dev/null; then
    echo "WARNING: dconf not found. Skipping enabled-applets cleanup."
    echo "  You may need to manually edit enabled-applets after Cinnamon restarts."
else
    # 2. Remove from dconf enabled-applets list
    CURRENT=$(dconf read /org/cinnamon/enabled-applets 2>/dev/null || echo "")
    if echo "$CURRENT" | grep -q "$UUID"; then
        UPDATED=$(echo "$CURRENT" | python3 -c "
import sys, ast
raw = sys.stdin.read().strip()
entries = ast.literal_eval(raw)
filtered = [e for e in entries if '$UUID' not in e]
print(filtered)
")
        dconf write /org/cinnamon/enabled-applets "$UPDATED"
        echo "  Removed from enabled-applets"
    else
        echo "  Not in enabled-applets (already disabled)"
    fi

    # 3. Check if stock tray applets are present — warn if not
    CURRENT=$(dconf read /org/cinnamon/enabled-applets 2>/dev/null || echo "")
    HAS_STOCK_SYSTRAY=false
    HAS_STOCK_XAPP=false
    echo "$CURRENT" | grep -q "$STOCK_SYSTRAY_UUID" && HAS_STOCK_SYSTRAY=true
    echo "$CURRENT" | grep -q "$STOCK_XAPP_UUID" && HAS_STOCK_XAPP=true

    if ! $HAS_STOCK_SYSTRAY || ! $HAS_STOCK_XAPP; then
        echo ""
        echo "WARNING: Stock tray applets are not all enabled."
        if ! $HAS_STOCK_SYSTRAY; then
            echo "  Missing: $STOCK_SYSTRAY_UUID (XEmbed system tray)"
        fi
        if ! $HAS_STOCK_XAPP; then
            echo "  Missing: $STOCK_XAPP_UUID (XApp status icons)"
        fi
        echo "  You may want to re-enable them after restart:"
        echo "    Right-click panel -> Applets -> search 'System Tray' / 'XApp Status' -> Add"
    fi
fi

# 4. Remove applet files/symlink
if [ -L "$APPLET_DIR" ]; then
    rm "$APPLET_DIR"
    echo "  Removed symlink: $APPLET_DIR"
elif [ -d "$APPLET_DIR" ]; then
    rm -rf "$APPLET_DIR"
    echo "  Removed directory: $APPLET_DIR"
else
    echo "  No applet directory found (already removed)"
fi

echo ""
echo "Done. Restart Cinnamon to apply:"
echo "  - From desktop: Alt+F2 -> r -> Enter"
echo "  - From TTY:     DISPLAY=:0 cinnamon --replace &"
