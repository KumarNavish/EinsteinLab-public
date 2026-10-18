import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Exercise actual paint() without the CSS/Three DOM constructor. Real Chrome
// pixel comparisons separately cover GPU readback and fractional resampling.
const source = await readFile(new URL('../src/paper-workspace.js', import.meta.url), 'utf8');
const {PaperWorkspace} = await import('data:text/javascript;base64,' + Buffer.from(source.replace(/^import .*\n/gm, '')).toString('base64'));

function fixture() {
  const calls = {draw: 0, overlay: 0, fit: 0, replace: 0};
  const canvas = () => ({width: 0, height: 0, cloneNode: () => canvas(),
    replaceWith() { calls.replace++; },
    getContext() { return {fillRect() {}, drawImage() { calls.draw++; }}; }});
  const original = {width: 1500, height: 1943};
  const workspace = Object.assign(Object.create(PaperWorkspace.prototype), {
    pdf: {canvas: original}, base: canvas(), overlay: canvas(), region: [.4827864077669903, .228, .5124271844660194, .273],
    paintAnnotations() { calls.overlay++; }, fitDisplay() { calls.fit++; },
  });
  return {workspace, original, calls};
}

test('cumulative overlay paints preserve the unchanged original crop canvas', () => {
  const {workspace, original, calls} = fixture();
  workspace.paint();
  const base = workspace.base;
  for (let i = 0; i < 4; i++) workspace.paint();
  assert.equal(workspace.base, base);
  assert.equal(calls.draw, 1, 'Annotation progression must not resample original pixels.');
  assert.equal(calls.replace, 1);
  assert.equal(calls.overlay, 5); assert.equal(calls.fit, 5);
  assert.deepEqual(original, {width: 1500, height: 1943});
});

test('a crop change, replacement page or source dimension change gets a fresh backing context', () => {
  const {workspace, calls} = fixture();
  workspace.paint(); let previous = workspace.base;
  workspace.region[0] = .48; workspace.paint();
  assert.notEqual(workspace.base, previous); previous = workspace.base;
  workspace.pdf.canvas = {width: 1500, height: 1943}; workspace.paint();
  assert.notEqual(workspace.base, previous); previous = workspace.base;
  workspace.pdf.canvas.width = 1499; workspace.paint();
  assert.notEqual(workspace.base, previous);
  assert.equal(calls.draw, 4); assert.equal(calls.replace, 4);
  workspace.paint(); assert.equal(calls.draw, 4);
});
