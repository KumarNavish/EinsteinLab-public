import test from 'node:test';
import assert from 'node:assert/strict';
import {captionWindow, LiveCaptions, spokenWords} from '../src/live-captions.js';
test('short captions preserve the actual words',()=>{assert.equal(captionWindow('  One  careful question. '),'One careful question.');});
test('performance tags stay out of streamed captions while scientific brackets and raw text remain',()=>{
 const element={textContent:''},stats={},captions=new LiveCaptions(element,stats);
 for(const partial of ['[','[inh','[inhale', '[inhale]']) {captions.set('The answer. '+partial);assert.equal(element.textContent,'The answer.');}
 const raw='[inhale] The interval [0, 1] is bounded. [exhale] See [1].';captions.set(raw);
 assert.equal(element.textContent,'The interval [0, 1] is bounded. See [1].');assert.equal(captions.fullText,raw);
 assert.equal(captionWindow('Use [input'), 'Use [input');
 assert.equal(spokenWords('[breath] An answer. [sighs] [pause] [laughs]'),'An answer.');
});
test('a bare hesitation never becomes a persistent display placeholder',()=>{for(const text of ['Hmm.','Hm…','Mhm.','Mmhmm…','Um,'])assert.equal(captionWindow(text),'');assert.equal(captionWindow('Hmm. The guard checks the type.'),'Hmm. The guard checks the type.');});
test('long speech is windowed instead of filling the screen',()=>{const text='The diagram is a conceptual explanation. '+ 'These observations do not by themselves prove the causal hypothesis. '.repeat(6);const shown=captionWindow(text);assert(shown.length<=114);assert(shown.startsWith('… '));assert(text.replace(/\s+/g,' ').trim().endsWith(shown.slice(2)));});
test('a single very long token cannot overflow the display budget',()=>{assert(captionWindow('x'.repeat(500)).length<=114);});
test('full caption text remains available to the existing transcript pipeline',()=>{const element={textContent:''},stats={};const caption=new LiveCaptions(element,stats);const text='An original explanatory sentence. '.repeat(10);caption.set(text);assert.equal(caption.fullText,text);assert(stats.captionTruncatedForDisplay);assert.equal(stats.fullCaptionCharacters,text.length);caption.clear();assert.equal(element.textContent,'');});
