# System Tray with Overflow — Cinnamon Applet

Unified system tray applet for Cinnamon 6.0+ that combines XEmbed (`systray@cinnamon.org`) and XApp (`xapp-status@cinnamon.org`) into a single applet with overflow popup and drag-and-drop icon management.

## Features

- Combined XEmbed + XApp system tray in one applet
- Overflow popup for icons that don't fit in the panel
- Drag-and-drop to promote/demote icons between Shown and Hidden sections
- System applet proxy (sound, power, network, etc.) in the overflow popup
- Chevron indicator when overflow icons are present

## Requirements

- Cinnamon 6.0+ (Ubuntu 24.04)
- Node.js 18+ (for running tests)

## Quick Start

### Deploy to VM for UAT / development

```bash
./vm/vm-ctl.sh start         # Start the cinnamon-dev VM (if not running)
./dev-deploy.sh              # Deploy to VM + open SPICE viewer
```

This installs the applet on the VM via virtio-fs mount, swaps stock systray/xapp applets, restarts Cinnamon, and opens a SPICE viewer window so you can interact with the VM desktop.

Code changes are picked up automatically via the shared mount. After editing, just reload:

```bash
./dev-deploy.sh --restart    # Restart Cinnamon on VM to pick up changes
./dev-deploy.sh --no-viewer  # Deploy without opening another viewer window
```

### Restore stock applets on VM

```bash
./dev-deploy.sh --uninstall  # Restore stock systray + xapp-status on VM
```

### Manual install

```bash
./install.sh                 # Create symlink + validate
# Then manually: Right-click panel -> Applets -> add 'System Tray with Overflow'
# And remove stock 'System Tray' and 'XApp Status Applet'
# Restart Cinnamon: Alt+F2 -> r -> Enter
```

## Testing

```bash
npm test                     # Unit tests (259 tests)
npm run test:e2e             # VM E2E tests (8 scenarios, VM required)
npm run test:vm              # VM smoke tests
npm run test:all             # Unit + VM smoke
```

### VM E2E test prerequisites

```bash
./vm/vm-ctl.sh start         # Start the cinnamon-dev VM
npm run test:vm:setup        # Set up test environment
npm run test:e2e             # Run E2E tests
./vm/vm-ctl.sh viewer        # Open SPICE viewer for visual inspection
```

## Project Structure

| File | Purpose |
|------|---------|
| `applet.js` | Main applet (GJS/Clutter/St) |
| `popup-manager.js` | Overflow popup UI |
| `dnd-handler.js` | Drag-and-drop state machine |
| `icon-registry.js` | Managed icons registry |
| `system-applet-proxy.js` | System applet proxy management |
| `helpers.js` | Pure functions (testable in Node) |
| `dev-deploy.sh` | Deploy to local desktop for UAT |
| `install.sh` / `uninstall.sh` | Manual install/uninstall |

## License

GPL-2.0
