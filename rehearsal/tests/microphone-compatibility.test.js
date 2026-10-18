import test from 'node:test';
import assert from 'node:assert/strict';
import {createMicrophoneCompatibilityNode} from '../src/pcm-fallback.js';
import {NativeConversation} from '../src/native-audio.js';

const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function node(){return {connect(){},disconnect(){this.disconnected=true;}};}
function setup(t,worklet){
 const contexts=[],packets=[],tracks=[],stats={};
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
 Object.defineProperty(globalThis,'AudioContext',{configurable:true,value:class{
  constructor(){this.state='running';this.sampleRate=48000;this.destination={};this.audioWorklet={addModule:worklet};contexts.push(this);}
  createScriptProcessor(size,inputs,outputs){assert.deepEqual([size,inputs,outputs],[1024,1,1]);return this.processor=node();}
  createMediaStreamSource(){return node();}createGain(){return {...node(),gain:{value:1}};}
  async resume(){}async close(){this.state='closed';}
 }});
 t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'AudioContext',descriptor);else delete globalThis.AudioContext;});
 const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');let requests=0;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{requests++;const track={stopped:false,stop(){this.stopped=true;}};tracks.push(track);return {getTracks:()=>[track]};}}}});
 t.after(()=>{if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;});
 const n=new NativeConversation({player:{stop(){},version:0},stats,onState(){},onError:assert.fail,onEvent(){}});
 n.active=true;n.serial=1;n.socket={readyState:1,bufferedAmount:0,send:message=>packets.push(message),close(){}};
 return {n,stats,contexts,packets,tracks,requests:()=>requests};
}

test('capture compatibility copies actual input, emits asynchronously and never plays that input',async()=>{
 const context={createScriptProcessor:()=>node()},n=createMicrophoneCompatibilityNode(context),messages=[];
 n.port.onmessage=e=>messages.push(new Float32Array(e.data));const input=new Float32Array(1024).fill(.25),output=new Float32Array(1024).fill(1);
 n.onaudioprocess({inputBuffer:{getChannelData:()=>input},outputBuffer:{getChannelData:()=>output}});
 assert.equal(messages.length,0);input.fill(.5);await settle();assert(messages[0].every(x=>x===.25));assert(output.every(x=>x===0));
 const callback=n.onaudioprocess;callback({inputBuffer:{getChannelData:()=>input},outputBuffer:{getChannelData:()=>output}});n.disconnect();await settle();
 assert.equal(messages.length,1);assert.equal(n.onaudioprocess,null);assert.equal(n.port.onmessage,null);
});

test('actual microphone handler resamples compatibility input and Stop releases every owned resource',async t=>{
 const h=setup(t,async()=>{throw Error('unavailable');});await h.n.startMicrophone(1);
 assert.equal(h.stats.nativeMicrophoneEngine,'compatibility-buffer');assert.equal(h.stats.microphoneActive,true);
 const output=new Float32Array(1024).fill(1);h.contexts[0].processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1024).fill(.1)},outputBuffer:{getChannelData:()=>output}});await settle();
 assert.equal(h.stats.nativeInputBytes,682);assert.equal(h.packets.filter(x=>x instanceof ArrayBuffer).length,1);assert(output.every(x=>x===0));
 await h.n.stop();assert(h.tracks.every(x=>x.stopped));assert.equal(h.contexts[0].state,'closed');assert.equal(h.stats.microphoneActive,false);assert.equal(h.n.microphoneStarting,false);
});

test('Stop during pending worklet preparation cannot create a fallback or duplicate capture',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const h=setup(t,()=>new Promise(()=>{}));
 const pending=h.n.startMicrophone(1);await settle();assert.equal(h.n.microphoneStarting,true);
 await h.n.startMicrophone(1);assert.equal(h.requests(),1);
 await h.n.stop();t.mock.timers.tick(1500);await pending;
 assert.equal(h.contexts[0].processor,undefined);assert.equal(h.stats.microphoneActive,false);assert(h.tracks[0].stopped);assert.equal(h.n.microphoneStarting,false);
});
