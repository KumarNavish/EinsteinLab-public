const WIDTH = 1600;

export function extendsDiagram(previous, next) {
  if (!previous || previous.title !== next.title || previous.caption !== next.caption ||
    previous.nodes.length >= next.nodes.length ||
    JSON.stringify(previous.nodes) !== JSON.stringify(next.nodes.slice(0, previous.nodes.length)) ||
    JSON.stringify(previous.sources) !== JSON.stringify(next.sources)) return false;
  const relation = ({from, to, label, kind}) => JSON.stringify([from, to, label, kind]);
  const nextEdges = new Set(next.edges.map(relation));
  return previous.edges.every(edge => nextEdges.has(relation(edge)));
}

/** Positions are presentation choices, never observations. Preserve node/edge meaning. */
export function layoutDiagram(nodes) {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > 8) throw new Error('Invalid diagram layout input');
  const centers = nodes.map(node => ({id: node.id, x: 76 + node.x * 1448, y: 315 + node.y * 380}));
  let boxWidth = 300;
  for (let i = 0; i < centers.length; i++) for (let j = i + 1; j < centers.length; j++) {
    if (Math.abs(centers[i].y - centers[j].y) < 170) boxWidth = Math.min(boxWidth, Math.abs(centers[i].x - centers[j].x) - 60);
  }
  const height = 128;
  const overlaps = (a, b, width) => Math.abs(a.x - b.x) < width + 30 && Math.abs(a.y - b.y) < height + 30;
  const mustReflow = boxWidth < 190 || centers.some((a, i) => centers.slice(i + 1).some(b => overlaps(a, b, Math.max(190, boxWidth))));
  if (mustReflow) {
    const columns = nodes.length <= 4 ? nodes.length : Math.ceil(Math.sqrt(nodes.length));
    const rows = Math.ceil(nodes.length / columns);
    boxWidth = Math.min(290, 1360 / columns - 55);
    for (let i = 0; i < centers.length; i++) {
      centers[i].x = columns === 1 ? WIDTH / 2 : 220 + (i % columns) * 1160 / (columns - 1);
      centers[i].y = rows === 1 ? 480 : 330 + Math.floor(i / columns) * 360 / (rows - 1);
    }
  }
  return {adjusted: mustReflow || boxWidth < 300, boxes: Object.fromEntries(centers.map(center => [center.id,
    {x: center.x - boxWidth / 2, y: center.y - height / 2, width: boxWidth, height}]))};
}

export function arrowRoute(a, b, edgeIndex = 0) {
  const ac = {x: a.x + a.width / 2, y: a.y + a.height / 2};
  const bc = {x: b.x + b.width / 2, y: b.y + b.height / 2};
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  if (Math.abs(dy) < Math.max(a.height, b.height) * .8) {
    const top = Math.min(a.y, b.y) - 65 - Math.max(0, Math.floor(Math.abs(dx) / 550)) * 45;
    return {kind: 'arch', start: {x: ac.x, y: a.y - 4}, end: {x: bc.x, y: b.y - 5},
      control1: {x: ac.x, y: top}, control2: {x: bc.x, y: top}, label: {x: (ac.x + bc.x) / 2, y: top + 10}, endDirection: {x: 0, y: 1}};
  }
  const norm = Math.hypot(dx, dy) || 1;
  const shorten = r => 1 / Math.max(Math.abs(dx) / (r.width / 2 + 10), Math.abs(dy) / (r.height / 2 + 10));
  const ta = shorten(a), tb = shorten(b);
  const start = {x: ac.x + dx * ta, y: ac.y + dy * ta}, end = {x: bc.x - dx * tb, y: bc.y - dy * tb};
  return {kind: 'line', start, end, label: {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 16}, endDirection: {x: dx / norm, y: dy / norm}};
}
