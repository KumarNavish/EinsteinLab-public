import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechPlayer} from '../src/speech-player.js';

function fixture() {
  const events=[],frames=[],sources=[];
  const player=new SpeechPlayer({speechFrame:(...args)=>frames.push(args)},state=>events.push(state),{audioSegments:0});
  player.context={currentTime:10,state:'running',decodeAudioData:async()=>({duration:6,length:144000,sampleRate:24000,numberOfChannels:1}),
    createBufferSource:()=>{const source={connected:false,ended:false,connect(){this.connected=true},disconnect(){this.connected=false},start(...args){this.startArguments=args},stop(){this.ended=true}};sources.push(source);return source;}};
  player.analyser={getFloatTimeDomainData:values=>values.fill(.05)};player.samples=new Float32Array(32);
  player.activate=async()=>{};player.makeNativeDelay=()=>{};
  return {player,events,frames,sources};
}
const buffer={duration:12,length:288000,sampleRate:24000,numberOfChannels:1};

test('a scheduled range uses original buffer offsets and retains its caption/cues',()=>{
  const {player,sources}=fixture();const cues=[{start:5,end:6,value:'D'}];
  player.schedule(buffer,cues,0,false,{offset:4,duration:4,caption:'Actual sentence'});
  assert.equal(sources[0].buffer,buffer);
  assert.deepEqual(sources[0].startArguments,[10.025,4,4]);
  assert.equal(player.entries[0].end,14.025);assert.equal(player.entries[0].cueOffset,4);
  assert.equal(player.entries[0].caption,'Actual sentence');assert.equal(player.entries[0].cues,cues);
});

test('lip cues are evaluated at the original whole-clip position',()=>{
  const {player,frames}=fixture();
  player.schedule(buffer,[],0,false,{offset:8,duration:2});
  player.context.currentTime=10.125;
  const old=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>1;
  try{player.tick();}finally{if(old)globalThis.requestAnimationFrame=old;else delete globalThis.requestAnimationFrame;}
  assert(Math.abs(frames.at(-1)[1]-8.1)<1e-7);assert.equal(frames.at(-1)[3],true);
});

test('a rejected range allocates no audio node',()=>{
  const {player,sources}=fixture();
  assert.throws(()=>player.schedule(buffer,[],0,false,{offset:11,duration:4}));
  assert.throws(()=>player.schedule(buffer,[],0,false,{offset:NaN,duration:1}));
  assert.equal(sources.length,0);
});

test('cancelled versions cannot schedule even a valid range',()=>{
  const {player,sources}=fixture();player.version=2;
  player.schedule(buffer,[],1,false,{offset:0,duration:4});assert.equal(sources.length,0);
});

test('stopping publishes idle once synchronously, not on a later frame that overwrites an error',()=>{
  const {player,events}=fixture();player.lastState='playing';
  player.schedule(buffer,[],0,false,{offset:0,duration:2});player.stop();
  assert.deepEqual(events,['idle']);assert.equal(player.lastState,'idle');assert.equal(player.entries.length,0);
  const old=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>1;
  try{player.tick();}finally{if(old)globalThis.requestAnimationFrame=old;else delete globalThis.requestAnimationFrame;}
  assert.deepEqual(events,['idle']);
});

test('the decoded enqueue path schedules all samples and captures the sentence at admission',async()=>{
  const {player,sources}=fixture();player.nextCaption='First sentence';
  const queued=player.enqueue('AAAA',[],0);player.nextCaption='A later sentence';await queued;
  assert.equal(sources.length,2);
  assert.equal(sources[0].startArguments[1],0);assert.equal(sources[1].startArguments[1],4);
  assert.equal(sources[0].startArguments[2]+sources[1].startArguments[2],6);
  assert(player.entries.every(entry=>entry.caption==='First sentence'));
});

test('a cancelled decode cannot create old waveform sources',async()=>{
  const {player,sources}=fixture();let finish;
  player.context.decodeAudioData=()=>new Promise(resolve=>{finish=resolve;});
  const pending=player.enqueue('AAAA',[],0);
  await new Promise(resolve=>setImmediate(resolve));player.stop();finish(buffer);
  assert.equal(await pending,false);assert.equal(sources.length,0);
});

test('native voice previews retain their separate lip-sync delay',()=>{
  const {player,sources}=fixture();player.nativeBus={};
  player.schedule(buffer,[],0,true);
  assert(Math.abs(sources[0].startArguments[0]-10.025)<1e-7);
  assert(Math.abs(player.entries[0].start-10.095)<1e-7);
  assert.equal(player.entries[0].native,true);assert.equal(sources[0].startArguments[2],12);
});
