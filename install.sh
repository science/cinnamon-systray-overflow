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
