const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('metadata.json', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'metadata.json'), 'utf8'));

    it('has uuid systray-overflow@cinnamon', () => {
        assert.equal(meta.uuid, 'systray-overflow@cinnamon');
    });

    it('has role "tray"', () => {
        assert.equal(meta.role, 'tray');
    });

    it('has max-instances 1', () => {
        assert.equal(meta['max-instances'], 1);
    });

    it('has a name', () => {
        assert.ok(meta.name && meta.name.length > 0);
    });

    it('has a description', () => {
        assert.ok(meta.description && meta.description.length > 0);
    });

    it('does not have icon field', () => {
        assert.equal(meta.icon, undefined);
    });

    it('does not have dangerous field', () => {
        assert.equal(meta.dangerous, undefined);
    });

    it('does not have last-edited field', () => {
        assert.equal(meta['last-edited'], undefined);
    });
});

describe('settings-schema.json', () => {
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'settings-schema.json'), 'utf8'));

    it('has icon-visibility as generic type', () => {
        assert.equal(schema['icon-visibility'].type, 'generic');
    });

    it('icon-visibility defaults to empty object', () => {
        assert.deepEqual(schema['icon-visibility'].default, {});
    });

    it('has icon-order as generic type', () => {
        assert.equal(schema['icon-order'].type, 'generic');
    });

    it('icon-order defaults to empty array', () => {
        assert.deepEqual(schema['icon-order'].default, []);
    });

    it('has default-visibility as combobox', () => {
        assert.equal(schema['default-visibility'].type, 'combobox');
    });

    it('default-visibility defaults to "panel"', () => {
        assert.equal(schema['default-visibility'].default, 'panel');
    });

    it('default-visibility options include panel and overflow', () => {
        let opts = schema['default-visibility'].options;
        let values = Object.values(opts);
        assert.ok(values.includes('panel'), 'missing "panel" option');
        assert.ok(values.includes('overflow'), 'missing "overflow" option');
    });

    it('has overflow section', () => {
        assert.equal(schema['section-overflow'].type, 'section');
    });
});
