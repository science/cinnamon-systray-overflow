# System Tray with Overflow — Cinnamon Applet

## Project

Cinnamon 6.0.4 desktop applet that combines `systray@cinnamon.org` (XEmbed) and `xapp-status@cinnamon.org` (XApp) into a single applet with overflow support. Status: **Alpha**.

- **UUID**: `systray-overflow@cinnamon`
- **Target**: Cinnamon 6.0+ on Ubuntu 24.04
- **Role**: `tray` (max-instances: 1)

## Key Files

| File | Purpose |
|------|---------|
| `applet.js` | Main applet code (GJS/Clutter/St) — both protocols + overflow UI + DND |
| `helpers.js` | Pure computation functions (no GJS deps, testable in Node) |
| `metadata.json` | Applet UUID, name, role |
| `settings-schema.json` | icon-visibility, icon-order, default-visibility |
| `stylesheet.css` | Overflow popup styling |
| `install.sh` | Install with validation — warns about removing BOTH stock applets |
| `uninstall.sh` | Safe removal — warns about re-enabling stock applets |
| `test/helpers.test.js` | Unit tests for helper functions |
| `test/schema.test.js` | Settings schema + metadata validation tests |
| `test/applet-lint.test.js` | Static safety checks on applet.js |
| `test/install-uninstall.test.js` | Sandboxed install/uninstall integration tests |

## Commands

- **Run tests**: `npm test` (Node.js 18+)
- **Install**: `./install.sh` (validates files, creates symlink, warns about stock applet conflicts)
- **Uninstall**: `./uninstall.sh` (removes from dconf + deletes symlink; safe from TTY)
- **Restart Cinnamon**: `Alt+F2 -> r -> Enter` or from TTY: `DISPLAY=:0 cinnamon --replace &`
- **Applet dir**: `~/.local/share/cinnamon/applets/systray-overflow@cinnamon`

## Architecture

- `helpers.js` exports pure functions (`classifyIcons`, `xappProxyToId`, `dropTargetSection`, `calcOverflowPanelPosition`) used by both `applet.js` and Node tests
- `applet.js` uses `require('./helpers')` for GJS, `module.exports` for Node — same file, dual runtime
- `XAppStatusIcon` class handles XApp/DBus protocol icons (from stock `xapp-status@cinnamon.org`)
- `RecorderIcon` class handles screen recorder indicator
- `SystrayOverflowApplet` handles both XEmbed (via `StatusIconDispatcher`) and XApp (via `XApp.StatusIconMonitor`)
- Icons tracked in `this._managedIcons` Map keyed by stable ID
- Overflow popup: `St.Bin` on `global.stage` with `pushModal`/`popModal` for input routing
- Chevron button shows/hides based on whether overflow section has icons

## Constraints

- Our applet and stock `systray@cinnamon.org` CANNOT coexist (StatusIconDispatcher singleton)
- Our applet and stock `xapp-status@cinnamon.org` should not coexist (duplicate XApp icons)
- XEmbed event handling uses `global.begin_modal`/`end_modal` — must guard against nesting when overflow popup's `pushModal` is already active
- Stock UUIDs: `systray@cinnamon.org`, `xapp-status@cinnamon.org`

## VM Testing

A libvirt/KVM VM (`cinnamon-dev`) mirrors the host environment (Ubuntu 24.04 + Cinnamon 6.0.4). The host `~/dev` is mounted read-write at `/mnt/host-dev/` via virtio-fs.

### VM Management

```bash
./vm/vm-ctl.sh start          # Start VM
./vm/vm-ctl.sh stop           # Graceful shutdown
./vm/vm-ctl.sh ssh [cmd]      # SSH into VM
./vm/vm-ctl.sh viewer         # Open SPICE desktop viewer
./vm/vm-ctl.sh snapshot <n>   # Create snapshot
./vm/vm-ctl.sh revert <n>     # Revert to snapshot
```

### Restarting Cinnamon on the VM

```bash
./vm/vm-ctl.sh ssh "DISPLAY=:0 nohup cinnamon --replace >/tmp/cinnamon.log 2>&1 &"
sleep 3
```

### D-Bus Eval (Looking Glass remotely)

```bash
./vm/vm-ctl.sh ssh "DISPLAY=:0 dbus-send --session --dest=org.Cinnamon \
  --type=method_call --print-reply /org/Cinnamon org.Cinnamon.Eval \
  string:'<javascript expression>'"
```
