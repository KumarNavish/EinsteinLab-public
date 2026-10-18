/** Render an already-retrieved exact source excerpt with a non-destructive phrase highlight.
 * This does not fetch, parse, upload or reconstruct a paper/webpage. Text indices
 * refer to the unchanged excerpt supplied by the source-ledger contract.
 */
export function sourceLines(context, text, maxWidth) {
  const lines = [];
  let start = 0;
  while (start < text.length) {
    let end = start, lastSpace = -1;
    while (end < text.length && text[end] !== '\n') {
      if (/\s/.test(text[end])) lastSpace = end;
      if (context.measureText(text.slice(start, end + 1)).width > maxWidth) break;
      end++;
    }
    if (end === start && text[end] !== '\n') end++;
    else if (end < text.length && text[end] !== '\n' && lastSpace > start) end = lastSpace;
    lines.push({start, end, text: text.slice(start, end)});
    start = end;
    if (text[start] === '\n') start++;
    else while (start < text.length && text[start] !== '\n' && /\s/.test(text[start])) start++;
  }
  return lines;
}

export function phraseBoxes(context, lines, range, {x, y, lineHeight}) {
  if (!range) return [];
  const boxes = [];
  lines.forEach((line, index) => {
    const from = Math.max(line.start, range[0]), to = Math.min(line.end, range[1]);
    if (to <= from) return;
    const before = line.text.slice(0, from - line.start);
    const segment = line.text.slice(from - line.start, to - line.start);
    boxes.push({x: x + context.measureText(before).width, y: y + index * lineHeight - lineHeight * .78,
      width: context.measureText(segment).width, height: lineHeight, from, to});
  });
  return boxes;
}

export function paintSourcePassage(canvas, passage) {
  const context = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  context.clearRect(0, 0, width, height); context.fillStyle = '#fbfaf4'; context.fillRect(0, 0, width, height);
  context.textAlign = 'left'; context.fillStyle = '#596a53'; context.font = '600 20px system-ui';
  context.fillText('SOURCE EXCERPT · ORIGINAL WORDING', 64, 56);
  context.fillStyle = '#25372f'; context.font = '41px Georgia';
  context.fillText(passage.title, 64, 120, width - 128);
  context.font = '19px system-ui'; context.fillStyle = '#788171';
  context.fillText('Reformatted from the inspected source. Not a PDF page or original research figure.', 64, 162, width - 128);
  context.font = '26px system-ui';
  let lines = sourceLines(context, passage.text, width - 160), lineHeight = 39;
  if (lines.length * lineHeight > 620) { context.font = '23px system-ui'; lines = sourceLines(context, passage.text, width - 160); lineHeight = 34; }
  if (lines.length * lineHeight > 650) throw new Error('The source passage is too long for this readable workspace');
  const y = 242;
  const boxes = phraseBoxes(context, lines, passage.quote_range, {x: 80, y, lineHeight});
  context.fillStyle = '#e7edcc';
  for (const box of boxes) context.fillRect(box.x - 2, box.y, box.width + 4, box.height);
  context.fillStyle = '#2b3d32';
  for (let index = 0; index < lines.length; index++) context.fillText(lines[index].text, 80, y + index * lineHeight);
  context.strokeStyle = '#9b7045'; context.lineWidth = 2;
  for (const box of boxes) { context.beginPath(); context.moveTo(box.x, box.y + box.height - 2); context.lineTo(box.x + box.width, box.y + box.height - 2); context.stroke(); }
  context.fillStyle = '#65755e'; context.font = '17px system-ui';
  const omission = (passage.omitted_before ? 'Earlier source text omitted. ' : '') + (passage.omitted_after ? 'Later source text omitted. ' : '');
  context.fillText(omission || 'Complete retrieved passage shown; this is not necessarily the complete source.', 64, height - 92, width - 128);
  context.fillText(passage.url, 64, height - 58, width - 128);
  context.fillText('Source checked: ' + (passage.fetched_at ? new Date(passage.fetched_at).toLocaleString() : 'date unavailable'), 64, height - 28, width - 128);
  return {lines, boxes, highlightedText: passage.quote || '', text: passage.text,
    focus: boxes.length ? [boxes[0].x + boxes[0].width / 2, boxes[0].y + boxes[0].height / 2] : [width / 2, height / 2]};
}
