import test from 'node:test';
import assert from 'node:assert/strict';
import {ScheduledSpeechQueue, SPEECH_QUEUE_LIMITS, PlaybackBlockedError} from '../src/scheduled-speech-queue.js';

function clip(seconds, label = 'clip') {
  const sampleRate = 24000, length = Math.round(seconds * sampleRate);
  return {sampleRate, length, duration: length / sampleRate, numberOfChannels: 1, label};
}
function harness({progress = true, sleepHook} = {}) {
  const context = {currentTime: 0, state: 'running'};
  const state = {tail: 0, version: 1, wall: 0, waits: 0, maxAhead: 0, scheduled: []};
  const queue = new ScheduledSpeechQueue({context: () => context, tail: () => state.tail,
    currentVersion: () => state.version, now: () => state.wall,
    sleep: async (ms, signal) => {
      state.wall += progress ? ms : 500;
      if (progress) context.currentTime += .25;
      if (sleepHook) await sleepHook({queue, context, state, signal});
    },
    onWait: waiting => { if (waiting) state.waits++; },
    schedule: value => {
      const start = Math.max(context.currentTime + .025, state.tail);
      state.tail = start + value.duration;
      state.maxAhead = Math.max(state.maxAhead, state.tail - context.currentTime);
      state.scheduled.push({...value, start});
    }});
  return {queue, context, state, add: (seconds, label) => queue.enqueue({decode: async () => clip(seconds,label), version: state.version, encodedBytes: 100, caption: label})};
}

test('cached producers can deliver ninety-six seconds without exceeding twenty seconds ahead', async () => {
  const h = harness();
  for (let i=0;i<12;i++) assert.equal(await h.add(8,`sentence-${i}`), true);
  assert.equal(h.state.scheduled.reduce((sum,item)=>sum+item.duration,0),96);
  assert(h.state.maxAhead <= SPEECH_QUEUE_LIMITS.aheadSeconds + 1e-7);
  assert(h.state.waits>0);
  assert.deepEqual(h.state.scheduled.filter((_,i)=>i%2===0).map(item=>item.buffer.label),Array.from({length:12},(_,i)=>`sentence-${i}`));
});

test('a long replay uses every original sample once without copying or changing cue time', async () => {
  const h=harness(),buffer=clip(47.137),cues=[{start:41,end:42,value:'F'}];
  await h.queue.enqueue({decode:async()=>buffer,version:1,cues,caption:'Long replay'});
  let position=0;
  for(const item of h.state.scheduled){
    assert.equal(item.buffer,buffer);assert.equal(item.cues,cues);assert.equal(item.caption,'Long replay');
    assert.equal(Math.round(item.offset*buffer.sampleRate),position);
    position+=Math.round(item.duration*buffer.sampleRate);
  }
  assert.equal(position,buffer.length);assert(h.state.maxAhead<=20+1e-7);
});

test('concurrent decoded clips are serialized in request order', async () => {
  const h=harness();
  await Promise.all([h.add(9,'first'),h.add(7,'second'),h.add(10,'third')]);
  assert.deepEqual([...new Set(h.state.scheduled.map(item=>item.buffer.label))],['first','second','third']);
  assert(h.state.maxAhead<=20+1e-7);
});

test('interruption releases a waiting clip and the next turn does not wait for it', async () => {
  let cancelled=false;
  const h=harness({sleepHook:({queue,state})=>{if(!cancelled){cancelled=true;state.version++;queue.reset();}}});
  assert.equal(await h.add(60,'old turn'),false);
  const oldCount=h.state.scheduled.length;
  h.state.tail=h.context.currentTime;
  assert.equal(await h.add(1,'new turn'),true);
  assert.equal(h.state.scheduled.length,oldCount+1);
  assert.equal(h.state.scheduled.at(-1).buffer.label,'new turn');
});

test('late decoder completion cannot leak into a newer conversation', async () => {
  const h=harness();let release;const decoded=new Promise(resolve=>{release=resolve;});
  const old=h.queue.enqueue({decode:()=>decoded,version:1});
  await Promise.resolve();h.state.version++;h.queue.reset();
  await h.add(1,'new');release(clip(4,'stale'));
  assert.equal(await old,false);assert.equal(h.state.scheduled.length,1);
  assert.equal(h.state.scheduled[0].buffer.label,'new');
});

test('a stalled audio clock fails promptly instead of growing or hanging', async () => {
  const h=harness({progress:false});
  await assert.rejects(h.add(40,'stalled'),PlaybackBlockedError);
  assert(h.state.wall<=3000);assert(h.state.maxAhead<=20+1e-7);
});

test('a suspended context waits for a bounded recovery rather than scheduling inaudible output', async () => {
  const h=harness({progress:false});h.context.state='suspended';
  await assert.rejects(h.add(1),PlaybackBlockedError);assert.equal(h.state.scheduled.length,0);
});

test('transient suspension can recover before its deadline', async () => {
  const h=harness({sleepHook:({context})=>{context.state='running';}});h.context.state='suspended';
  assert.equal(await h.add(1),true);assert.equal(h.state.scheduled.length,1);
});

test('a failed epoch cannot keep scheduling; an explicit new turn can recover', async () => {
  const h=harness({progress:false});
  await assert.rejects(h.add(40),PlaybackBlockedError);
  const count=h.state.scheduled.length;
  await assert.rejects(h.add(1),PlaybackBlockedError);assert.equal(h.state.scheduled.length,count);
  h.state.version++;h.state.tail=0;h.queue.reset();
  assert.equal(await h.add(1,'recovery'),true);
});

test('encoded memory limits reject before decoding', async () => {
  const h=harness();let decoded=false;
  await assert.rejects(h.queue.enqueue({decode:async()=>{decoded=true;return clip(1);},version:1,encodedBytes:SPEECH_QUEUE_LIMITS.encodedBytes+1}));
  assert.equal(decoded,false);
});

test('clip count remains bounded even while the first decode is pending', async () => {
  const h=harness();let finish;const blocked=new Promise(resolve=>{finish=resolve;});
  const pending=Array.from({length:8},()=>h.queue.enqueue({decode:()=>blocked,version:1}));
  await assert.rejects(h.queue.enqueue({decode:async()=>clip(1),version:1}));
  h.state.version++;h.queue.reset();finish(clip(1));
  assert((await Promise.all(pending)).every(value=>value===false));assert.equal(h.state.scheduled.length,0);
});

for(const changed of [{duration:Infinity},{duration:181,length:181*24000},{sampleRate:0},{numberOfChannels:50},{length:NaN},{length:1,duration:2}]){
  test('invalid decoded dimensions are refused: '+JSON.stringify(changed),async()=>{
    const h=harness();await assert.rejects(h.queue.enqueue({decode:async()=>({...clip(1),...changed}),version:1}));
    assert.equal(h.state.scheduled.length,0);
  });
}

test('reset wakes the real timer immediately; no wall-clock drain is required', async () => {
  const context={currentTime:0,state:'running'};let version=1;
  const queue=new ScheduledSpeechQueue({context:()=>context,tail:()=>20,currentVersion:()=>version,schedule:()=>assert.fail('Cancelled audio must not play')});
  const waiting=queue.enqueue({decode:async()=>clip(1),version:1});
  await new Promise(resolve=>setTimeout(resolve,5));version++;queue.reset();
  assert.equal(await waiting,false);
});
