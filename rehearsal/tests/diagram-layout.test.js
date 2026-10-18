import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutDiagram, arrowRoute, extendsDiagram} from '../src/diagram-layout.js';

function overlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function assertReadable(layout) {
  const boxes = Object.values(layout.boxes);
  for (const box of boxes) {
    assert(box.width >= 190 && box.height >= 120);
    assert(box.x >= 0 && box.y >= 200 && box.x + box.width <= 1600 && box.y + box.height <= 815);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert(!overlap(boxes[i], boxes[j]));
}

test('cumulative teaching keeps previous ideas visible; replacement or changed meaning cannot reuse it', () => {
  const first = {title: 'Trace', caption: 'Conceptual', nodes: [{id: 'a', x: .1, y: .5}], edges: [], sources: []};
  const second = {...first, nodes: [...first.nodes, {id: 'b', x: .5, y: .5}], edges: [{id: 'edge-0', from: 'a', to: 'b', kind: 'information'}]};
  assert(extendsDiagram(first, second));
  assert(!extendsDiagram(second, first));
  assert(!extendsDiagram(first, {...second, nodes: [{id: 'a', x: .3, y: .5}, second.nodes[1]]}));
  assert(!extendsDiagram(first, {...second, sources: [{id: 'another-source'}]}));
  assert(!extendsDiagram(null, second));
  const third = {...second, nodes: [...second.nodes, {id: 'c', x: .9, y: .5}], edges: [{...second.edges[0], id: 'edge-1'}]};
  assert(extendsDiagram(second, third));
  assert(!extendsDiagram(second, {...third, edges: [{...third.edges[0], kind: 'causal-hypothesis'}]}));
});

test('reserved teaching positions remain exactly stable at every prefix size', () => {
  for (let count = 2; count <= 6; count++) {
    const columns = count <= 4 ? count : 3;
    const nodes = Array.from({length: count}, (_, i) => ({id: 'n' + i,
      x: .1 + (i % columns) * .8 / (columns - 1), y: count <= 4 ? .5 : .12 + Math.floor(i / columns) * .76}));
    const complete = layoutDiagram(nodes); assertReadable(complete);
    for (let prefix = 1; prefix <= count; prefix++) {
      const current = layoutDiagram(nodes.slice(0, prefix));
      for (const node of nodes.slice(0, prefix)) assert.deepEqual(current.boxes[node.id], complete.boxes[node.id]);
    }
  }
});

test('the actual four-column native graph no longer merges adjacent boxes', () => {
  const nodes = [.2, .4, .6, .8].map((x, i) => ({id: 'n' + i, x, y: .3}));
  const layout = layoutDiagram(nodes); assertReadable(layout); assert(layout.adjusted);
  const route = arrowRoute(layout.boxes.n0, layout.boxes.n1);
  assert(route.kind === 'arch' && route.control1.y < layout.boxes.n0.y);
});

test('eight identical positions are reflowed without altering identifiers or adding elements', () => {
  const nodes = Array.from({length: 8}, (_, i) => ({id: 'n' + i, x: .5, y: .5}));
  const layout = layoutDiagram(nodes); assertReadable(layout);
  assert.deepEqual(Object.keys(layout.boxes), nodes.map(n => n.id));
});

test('boundary positions leave the title and caveat readable', () => {
  assertReadable(layoutDiagram([{id: 'a', x: .06, y: .06}, {id: 'b', x: .94, y: .94}]));
});

test('vertical relation exits node boundaries without drawing through their centers', () => {
  const {boxes} = layoutDiagram([{id: 'a', x: .5, y: .1}, {id: 'b', x: .5, y: .9}]);
  const route = arrowRoute(boxes.a, boxes.b);
  assert(route.kind === 'line');
  assert(route.start.y > boxes.a.y + boxes.a.height);
  assert(route.end.y < boxes.b.y);
  assert(route.endDirection.y > .99);
});
