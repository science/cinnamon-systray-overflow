const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registrySrc = fs.readFileSync(path.join(__dirname, '..', 'icon-registry.js'), 'utf8');

describe('icon-registry.js structure', () => {
    it('has IconRegistry class', () => {
        assert.ok(registrySrc.includes('class IconRegistry'), 'missing IconRegistry class');
    });

    it('requires helpers module', () => {
        assert.ok(registrySrc.includes("require('./helpers')"), 'must require helpers');
    });

    it('uses a Map for managed icons', () => {
        assert.ok(registrySrc.includes('new Map()'), 'must use Map for icon tracking');
    });

    it('has redistributeIcons method', () => {
        assert.ok(registrySrc.includes('redistributeIcons()'), 'missing redistributeIcons');
    });

    it('has setIconVisibility method', () => {
        assert.ok(registrySrc.includes('setIconVisibility('), 'missing setIconVisibility');
    });

    it('has setIconOrder method', () => {
        assert.ok(registrySrc.includes('setIconOrder('), 'missing setIconOrder');
    });

    it('has findManagedIconForActor method', () => {
        assert.ok(registrySrc.includes('findManagedIconForActor('), 'missing findManagedIconForActor');
    });

    it('has getPanelIconOrder method', () => {
        assert.ok(registrySrc.includes('getPanelIconOrder()'), 'missing getPanelIconOrder');
    });

    it('persists icon-visibility via settings', () => {
        assert.ok(registrySrc.includes("setValue('icon-visibility'"), 'must persist icon-visibility');
    });

    it('persists icon-order via settings', () => {
        assert.ok(registrySrc.includes("setValue('icon-order'"), 'must persist icon-order');
    });

    it('uses classifyIcons from helpers', () => {
        assert.ok(registrySrc.includes('classifyIcons'), 'must use classifyIcons');
    });
});

describe('icon-registry.js redistributeIcons', () => {
    it('skips while popup is open', () => {
        let methodStart = registrySrc.indexOf('redistributeIcons()');
        assert.ok(methodStart > 0, 'redistributeIcons not found');
        let method = registrySrc.substring(methodStart, methodStart + 300);
        assert.ok(method.includes('_popup.isOpen()'), 'must check if popup is open');
        assert.ok(method.includes('return'), 'must return early when popup is open');
    });

    it('keeps overflow icons in panelBox with visible=false', () => {
        let methodStart = registrySrc.indexOf('redistributeIcons()');
        assert.ok(methodStart > 0, 'redistributeIcons not found');
        let method = registrySrc.substring(methodStart, methodStart + 1800);
        assert.ok(method.includes('visible = true'), 'must set panel icons visible');
        assert.ok(method.includes('visible = false'), 'must set overflow icons hidden');
    });

    it('does not manage chevron (handled by applet init)', () => {
        let methodStart = registrySrc.indexOf('redistributeIcons()');
        assert.ok(methodStart > 0, 'redistributeIcons not found');
        let method = registrySrc.substring(methodStart, methodStart + 2500);
        assert.ok(!method.includes('ensureOverflowUI'), 'must not call ensureOverflowUI (created at init)');
        assert.ok(!method.includes('overflowIndicator'), 'must not reference overflowIndicator');
    });
});

describe('icon-registry.js findManagedIconForActor', () => {
    it('checks clone references', () => {
        let methodStart = registrySrc.indexOf('findManagedIconForActor(actor)');
        assert.ok(methodStart > 0, 'findManagedIconForActor not found');
        let method = registrySrc.substring(methodStart, methodStart + 600);
        assert.ok(method.includes('_managedIconRef'), 'must check _managedIconRef on clones');
    });
});
