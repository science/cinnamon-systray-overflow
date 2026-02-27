const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const UUID = 'systray-overflow@cinnamon';
const STOCK_SYSTRAY = 'systray@cinnamon.org';
const STOCK_XAPP = 'xapp-status@cinnamon.org';

// Helper to run a script in a sandboxed environment
function runScript(scriptName, env = {}) {
    let fullEnv = {
        ...process.env,
        ...env,
        HOME: env.HOME || process.env.HOME,
        PATH: env.PATH || process.env.PATH
    };

    try {
        let output = execSync(`bash ${path.join(ROOT, scriptName)}`, {
            env: fullEnv,
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return { stdout: output, stderr: '', exitCode: 0 };
    } catch (e) {
        return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.status || 1 };
    }
}

describe('install.sh', () => {
    let tmpHome;
    let appletDir;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync('/tmp/systray-test-');
        appletDir = path.join(tmpHome, '.local', 'share', 'cinnamon', 'applets', UUID);
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('creates symlink into applet directory', () => {
        let result = runScript('install.sh', { HOME: tmpHome });
        assert.equal(result.exitCode, 0, `install failed: ${result.stderr}`);
        assert.ok(fs.existsSync(appletDir), 'applet dir not created');
        assert.ok(fs.lstatSync(appletDir).isSymbolicLink(), 'not a symlink');
        let target = fs.readlinkSync(appletDir);
        assert.equal(fs.realpathSync(target), fs.realpathSync(ROOT));
    });

    it('reports Cinnamon version', () => {
        let result = runScript('install.sh', { HOME: tmpHome });
        assert.ok(result.stdout.includes('Cinnamon version'), 'missing version report');
    });

    it('reports required files OK', () => {
        let result = runScript('install.sh', { HOME: tmpHome });
        assert.ok(result.stdout.includes('Required files: OK'), 'missing files check');
    });

    it('reports metadata UUID OK', () => {
        let result = runScript('install.sh', { HOME: tmpHome });
        assert.ok(result.stdout.includes('Metadata UUID: OK'), 'missing UUID check');
    });

    it('is idempotent (re-run is safe)', () => {
        runScript('install.sh', { HOME: tmpHome });
        let result = runScript('install.sh', { HOME: tmpHome });
        assert.equal(result.exitCode, 0, 'second install failed');
        assert.ok(result.stdout.includes('already exists'), 'should note existing symlink');
    });

    it('prints uninstall reminder', () => {
        let result = runScript('install.sh', { HOME: tmpHome });
        assert.ok(result.stdout.includes('uninstall.sh'), 'missing uninstall reminder');
    });

    it('prints restart instructions', () => {
        let result = runScript('install.sh', { HOME: tmpHome });
        assert.ok(result.stdout.includes('Alt+F2'), 'missing restart instructions');
    });
});

describe('uninstall.sh', () => {
    let tmpHome;
    let appletDir;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync('/tmp/systray-test-');
        appletDir = path.join(tmpHome, '.local', 'share', 'cinnamon', 'applets', UUID);
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('removes symlink', () => {
        // First install
        runScript('install.sh', { HOME: tmpHome });
        assert.ok(fs.existsSync(appletDir), 'install did not create dir');

        // Then uninstall
        let result = runScript('uninstall.sh', { HOME: tmpHome });
        assert.equal(result.exitCode, 0, `uninstall failed: ${result.stderr}`);
        assert.ok(!fs.existsSync(appletDir), 'symlink still exists after uninstall');
    });

    it('handles already-removed applet gracefully', () => {
        let result = runScript('uninstall.sh', { HOME: tmpHome });
        assert.equal(result.exitCode, 0, 'uninstall should succeed even if nothing to remove');
        assert.ok(result.stdout.includes('already removed') || result.stdout.includes('No applet directory'),
            'should note nothing to remove');
    });

    it('removes directory install (not just symlinks)', () => {
        // Create a directory install (not symlink)
        fs.mkdirSync(appletDir, { recursive: true });
        fs.writeFileSync(path.join(appletDir, 'test.txt'), 'test');

        let result = runScript('uninstall.sh', { HOME: tmpHome });
        assert.equal(result.exitCode, 0);
        assert.ok(!fs.existsSync(appletDir), 'directory still exists');
    });

    it('prints restart instructions', () => {
        let result = runScript('uninstall.sh', { HOME: tmpHome });
        assert.ok(result.stdout.includes('Alt+F2'), 'missing restart instructions');
    });
});

describe('round-trip', () => {
    let tmpHome;
    let appletDir;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync('/tmp/systray-test-');
        appletDir = path.join(tmpHome, '.local', 'share', 'cinnamon', 'applets', UUID);
    });

    afterEach(() => {
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('install then uninstall leaves clean state', () => {
        runScript('install.sh', { HOME: tmpHome });
        assert.ok(fs.existsSync(appletDir));

        runScript('uninstall.sh', { HOME: tmpHome });
        assert.ok(!fs.existsSync(appletDir));

        // Parent dirs may still exist (that's fine)
        let parentDir = path.dirname(appletDir);
        if (fs.existsSync(parentDir)) {
            let remaining = fs.readdirSync(parentDir);
            assert.ok(!remaining.includes(UUID), 'UUID dir should be gone');
        }
    });

    it('double uninstall is safe', () => {
        runScript('install.sh', { HOME: tmpHome });
        runScript('uninstall.sh', { HOME: tmpHome });
        let result = runScript('uninstall.sh', { HOME: tmpHome });
        assert.equal(result.exitCode, 0, 'double uninstall should succeed');
    });
});
