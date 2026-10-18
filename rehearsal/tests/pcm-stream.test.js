import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PCMStreamCore, PureToneGuard} from '../public/audio/pcm-stream-core.mjs';
const rate = 24000;
const sine = (hz, seconds, gain=.3) => Float32Array.from({length: Math.round(rate*seconds)}, (_, i) => gain*Math.sin(2*Math.PI*hz*i/rate));
const join = parts => { const x=new Float32Array(parts.reduce((n,p)=>n+p.length,0)); let i=0; for(const p of parts){x.set(p,i);i+=p.length;}return x; };

test('packetized PCM equals one continuous waveform after the start fade', () => {
  const input=sine(223.7,.8), a=new PCMStreamCore(48000), b=new PCMStreamCore(48000);
  a.push(input);
  for(let i=0;i<input.length;i+=337)b.push(input.slice(i,i+337));
  a.finish();b.finish();const left=new Float32Array(48000),right=new Float32Array(48000);
  a.render(left);b.render(right);assert.deepEqual(right,left);
  assert.equal(b.underruns,0); assert.equal(b.overflows,0);
});

test('reset clears pending sound rather than repeating stale frames', () => {
  const core=new PCMStreamCore(48000);core.push(sine(440,1));let out=new Float32Array(4096);core.render(out);
  core.reset();out=new Float32Array(2048);core.render(out);
  assert(out.slice(200).every(x=>x===0));assert.equal(core.count,0);
});

test('underrun fade avoids abrupt discontinuity and resumes after rebuffer', () => {
  const core=new PCMStreamCore(48000);core.push(new Float32Array(3000).fill(.3));
  const out=new Float32Array(7000);core.render(out);
  const jump=Math.max(...out.slice(1).map((v,i)=>Math.abs(v-out[i])));
  assert(jump<.002);assert.equal(core.underruns,1);
  core.push(new Float32Array(3000).fill(.3));const next=new Float32Array(2000);core.render(next);
  assert(next.slice(300).some(x=>x>.29));
});

test('queue memory is bounded and nonfinite samples never reach speakers', () => {
  const core=new PCMStreamCore(48000);assert.throws(()=>core.push(new Float32Array(480001)));
  core.push(new Float32Array([NaN,Infinity,-Infinity]));core.finish();const out=new Float32Array(1000);core.render(out);
  assert(out.every(Number.isFinite));
});

for (const hz of [800, 1000, 2000, 4000]) test(`clear synthetic ${hz} Hz beep is suppressed without generating replacement sound`, () => {
  const guard=new PureToneGuard();const x=sine(hz,.3);const parts=[];
  for(let i=0;i<x.length;i+=233)parts.push(guard.push(x.slice(i,i+233)));
  parts.push(guard.push(new Float32Array(),true));const y=join(parts);
  assert.equal(y.length,x.length);assert(y.every(v=>Math.abs(v)<1e-9));assert(guard.suppressedFrames>=14);
});

test('ordinary harmonic voice-like signal is not treated as a notification tone', () => {
  const x=sine(120,.4);for(let i=0;i<x.length;i++)x[i]+=.1*Math.sin(2*Math.PI*360*i/rate)+.07*Math.sin(2*Math.PI*1080*i/rate);
  const guard=new PureToneGuard();const y=join([guard.push(x),guard.push(new Float32Array(),true)]);
  assert.deepEqual(y,x);assert.equal(guard.suppressedFrames,0);
});

test('three actual recorded native voice samples are unchanged by the narrowband guard', () => {
  for(const name of ['Algenib','Gacrux','Sadaltager']) {
    const bytes=fs.readFileSync(new URL(`../public/voice-previews/${name}.wav`,import.meta.url));
    let offset=12; let pcm;
    while(offset+8<=bytes.length){const id=bytes.toString('ascii',offset,offset+4),n=bytes.readUInt32LE(offset+4);if(id==='data'){pcm=bytes.subarray(offset+8,offset+8+n);break;}offset+=8+n+(n%2);}
    assert(pcm);const x=Float32Array.from({length:pcm.length/2},(_,i)=>pcm.readInt16LE(i*2)/32768);
    const guard=new PureToneGuard();const y=join([guard.push(x),guard.push(new Float32Array(),true)]);
    assert.deepEqual(y,x);assert.equal(guard.suppressedFrames,0,name);
  }
});
