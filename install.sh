#!/bin/bash
# Install systray-overflow@cinnamon applet
#
# Creates a symlink from the repo into Cinnamon's applet directory,
# checks for conflicts with BOTH stock tray applets, and validates
# that required files are present.
#
# Usage: ./install.sh

set -eo pipefail

UUID="systray-overflow@cinnamon"
STOCK_SYSTRAY_UUID="systray@cinnamon.org"
STOCK_XAPP_UUID="xapp-status@cinnamon.org"
APPLET_DIR="$HOME/.local/share/cinnamon/applets/$UUID"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REQUIRED_FILES=(applet.js helpers.js metadata.json settings-schema.json)

echo "Installing $UUID..."
echo ""

# 1. Check Cinnamon is installed
if ! command -v cinnamon &>/dev/null; then
    echo "ERROR: cinnamon not found. Is Cinnamon desktop installed?"
    exit 1
fi
CINNAMON_VERSION=$(cinnamon --version 2>/dev/null | grep -oP '[\d.]+' || echo "unknown")
echo "  Cinnamon version: $CINNAMON_VERSION"

# 2. Check required files exist in the repo
MISSING=()
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$SCRIPT_DIR/$f" ]; then
        MISSING+=("$f")
    fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
    echo "ERROR: Missing required files: ${MISSING[*]}"
    exit 1
fi
echo "  Required files: OK"

# 3. Check UUID in metadata.json matches
META_UUID=$(python3 -c "import json; print(json.load(open('$SCRIPT_DIR/metadata.json'))['uuid'])" 2>/dev/null || echo "")
if [ "$META_UUID" != "$UUID" ]; then
    echo "ERROR: metadata.json uuid is '$META_UUID', expected '$UUID'"
    exit 1
fi
echo "  Metadata UUID: OK"

# 4. Check if already installed
if [ -L "$APPLET_DIR" ]; then
    EXISTING_TARGET=$(readlink -f "$APPLET_DIR")
    if [ "$EXISTING_TARGET" = "$SCRIPT_DIR" ]; then
        echo "  Symlink already exists and points to this repo"
    else
        echo "WARNING: Symlink exists but points to: $EXISTING_TARGET"
        echo "  Removing old symlink..."
        rm "$APPLET_DIR"
    fi
elif [ -d "$APPLET_DIR" ]; then
    echo "WARNING: Directory install exists at $APPLET_DIR"
    echo "  Remove it first with: rm -rf $APPLET_DIR"
    exit 1
fi

# 5. Create applet directory and symlink
mkdir -p "$(dirname "$APPLET_DIR")"
if [ ! -L "$APPLET_DIR" ]; then
    ln -s "$SCRIPT_DIR" "$APPLET_DIR"
    echo "  Created symlink: $APPLET_DIR -> $SCRIPT_DIR"
fi

# 6. Check for stock systray conflicts
ENABLED=$(dconf read /org/cinnamon/enabled-applets 2>/dev/null || echo "")
if echo "$ENABLED" | grep -q "$STOCK_SYSTRAY_UUID"; then
    echo ""
    echo "WARNING: Stock systray ($STOCK_SYSTRAY_UUID) is currently enabled."
    echo "  Both applets use the StatusIconDispatcher (singleton)."
    echo "  You MUST remove the stock one before using this applet:"
    echo "    Right-click panel -> Applets -> find 'System Tray' -> Remove"
fi

if echo "$ENABLED" | grep -q "$STOCK_XAPP_UUID"; then
    echo ""
    echo "WARNING: Stock XApp status ($STOCK_XAPP_UUID) is currently enabled."
    echo "  Both applets monitor XApp status icons — you'll get duplicates."
    echo "  You should remove the stock one:"
    echo "    Right-click panel -> Applets -> find 'XApp Status Applet' -> Remove"
fi

# 6.5 Check the SNI/appindicator bridge (xapp-sn-watcher)
# Modern apps (Slack, Discord, etc.) publish their tray icons via the
# StatusNotifierItem (SNI / appindicator) protocol. Cinnamon bridges those into
# XApp status icons — which this applet displays — using xapp-sn-watcher, which
# must own the org.kde.StatusNotifierWatcher D-Bus name. If another service (e.g.
# Ubuntu's indicator-application) grabs that name first, xapp-sn-watcher backs
# off and SNI icons silently never appear. XEmbed icons are unaffected, so the
# breakage is partial and easy to misattribute to this applet. Warn only.
if command -v dbus-send &>/dev/null && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    SNI_OWNER=$(dbus-send --session --print-reply \
        --dest=org.freedesktop.DBus /org/freedesktop/DBus \
        org.freedesktop.DBus.GetNameOwner \
        string:org.kde.StatusNotifierWatcher 2>/dev/null | awk -F'"' '/string/ {print $2}')
    SNI_CMD=""
    if [ -n "$SNI_OWNER" ]; then
        SNI_PID=$(dbus-send --session --print-reply \
            --dest=org.freedesktop.DBus /org/freedesktop/DBus \
            org.freedesktop.DBus.GetConnectionUnixProcessID \
            string:"$SNI_OWNER" 2>/dev/null | awk '/uint32/ {print $2}')
        [ -n "$SNI_PID" ] && SNI_CMD=$(tr '\0' ' ' < "/proc/$SNI_PID/cmdline" 2>/dev/null)
    fi
    if echo "$SNI_CMD" | grep -q 'xapp-sn-watcher'; then
        echo "  SNI bridge (xapp-sn-watcher): OK"
    else
        echo ""
        echo "WARNING: Cinnamon's SNI bridge (xapp-sn-watcher) is not active."
        if [ -z "$SNI_OWNER" ]; then
            echo "  Nothing owns org.kde.StatusNotifierWatcher — appindicator apps"
            echo "  (Slack, Discord, etc.) will NOT show their tray icons here."
            echo "  Start it with: systemctl --user start 'app-xapp\\x2dsn\\x2dwatcher@autostart.service'"
        else
            echo "  org.kde.StatusNotifierWatcher is held by another service:"
            echo "    ${SNI_CMD:-pid $SNI_PID}"
            echo "  This blocks xapp-sn-watcher, so appindicator apps (Slack, Discord)"
            echo "  won't appear. Common culprit: Ubuntu's indicator-application."
            echo "  Fix: stop/disable that service so xapp-sn-watcher can own the name"
            echo "  (e.g. a Hidden=true override in ~/.config/autostart/), then re-login."
        fi
        echo "  NOTE: This is an environment issue, not a fault in this applet —"
        echo "  XEmbed icons (e.g. PasswordSafe) still work without the bridge."
    fi
fi

# 7. Check if our applet is already in enabled-applets
if echo "$ENABLED" | grep -q "$UUID"; then
    echo "  Already in enabled-applets"
else
    echo ""
    echo "  Applet files are installed. To enable:"
    echo "    1. Right-click panel -> Applets"
    echo "    2. Search for 'System Tray with Overflow'"
    echo "    3. Click '+' to add it to your panel"
fi

echo ""
echo "Done. After enabling, restart Cinnamon to load:"
echo "  - From desktop: Alt+F2 -> r -> Enter"
echo "  - From TTY:     DISPLAY=:0 cinnamon --replace &"
echo ""
echo "If something goes wrong, run: ./uninstall.sh"
