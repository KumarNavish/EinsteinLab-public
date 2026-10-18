import test from 'node:test';import assert from 'node:assert/strict';
import {sourceLines,phraseBoxes} from '../src/source-passage-painter.js';
const ctx={measureText:text=>({width:text.length*10})};
test('source line offsets refer to unchanged source text',()=>{const text='Expected results\nWe expect an improvement, not a demonstrated result.';for(const line of sourceLines(ctx,text,220))assert.equal(line.text,text.slice(line.start,line.end));});
test('one exact phrase can span multiple wrapped lines',()=>{const text='The project does not establish improved outcomes.';const quote='does not establish improved';const index=text.indexOf(quote);const lines=sourceLines(ctx,text,160);const boxes=phraseBoxes(ctx,lines,[index,index+quote.length],{x:80,y:200,lineHeight:32});assert(boxes.length>=2);for(const box of boxes){assert(box.from>=index&&box.to<=index+quote.length);assert(box.width>0);}});
test('an absent selection never creates an arbitrary highlight',()=>{assert.deepEqual(phraseBoxes(ctx,sourceLines(ctx,'Actual text',160),null,{x:0,y:0,lineHeight:20}),[]);});
test('malicious looking strings stay source text, not executable markup',()=>{const text='<script>bad()</script> is merely an untrusted source string.';const lines=sourceLines(ctx,text,200);assert(lines.some(line=>line.text.includes('<script>')));});
