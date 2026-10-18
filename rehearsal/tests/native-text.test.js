import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeConversation} from '../src/native-audio.js';

function fixture(t) {
  const sent = [], events = [], states = [], errors = [], stats = {};
  const player = {version:0, entries:[], activate(){assert.fail('Text must not activate audio');},
    prepareNative(){assert.fail('Text must not load audio');}, begin(){return ++this.version;},
    finish(){},stop(){this.version++;}};
  const native = new NativeConversation({player, stats, onEvent:e=>events.push(e), onState:s=>states.push(s), onError:e=>errors.push(e)});
  const priorLocation = Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'https://example.test/',protocol:'https:'}});
  t.after(()=>{if(priorLocation)Object.defineProperty(globalThis,'location',priorLocation);else delete globalThis.location;});
  let address, permitBody, socket;
  class Socket { static OPEN=1; readyState=1;
    constructor(url) {address=String(url);socket=this;queueMicrotask(()=>this.onmessage({data:JSON.stringify({event:'connected',mode:'text',generation:0,model:'gpt-6.1-sol',voice:null,continuous_audio:false})}));}
    send(value){sent.push(JSON.parse(value));} close(){} }
  const oldSocket = Object.getOwnPropertyDescriptor(globalThis,'WebSocket');
  Object.defineProperty(globalThis,'WebSocket',{configurable:true,value:Socket});
  t.after(()=>{if(oldSocket)Object.defineProperty(globalThis,'WebSocket',oldSocket);else delete globalThis.WebSocket;});
  t.mock.method(globalThis,'fetch',async(_url,options)=>{permitBody=JSON.parse(options.body);return {ok:true,json:async()=>({permit:'test-permit'})};});
  return {native,player,sent,events,states,errors,stats,address:()=>address,permit:()=>permitBody,socket:()=>socket};
}

test('written route starts without audio and requests a mode-bound permit',async t=>{
  const h=fixture(t);await h.native.start({textOnly:true,microphone:true});
  assert.equal(h.native.active,true);assert.equal(h.permit().text_only,true);
  assert.match(h.address(),/^wss:\/\/example.test\/api\/native\/text\?/);
  assert.equal(h.stats.nativeMode,'text');assert.equal(h.stats.nativeVoice,null);
  assert.equal(h.stats.nativeProviderVerified,false,'A relay handshake is not a completed provider answer');
  assert(!h.states.includes('audio-preparation'));assert(!h.states.includes('microphone-permission'));
  await assert.rejects(h.native.startMicrophone(h.native.serial),/written conversation/);
  await h.native.stop();assert.equal(h.stats.microphoneActive,false);
});

test('written answer rejects superseded output before and after current input acceptance',async t=>{
  const h=fixture(t);await h.native.start({textOnly:true});const serial=h.native.serial;
  h.native.sendText('First');h.native.handle({event:'input_accepted',request_id:1,generation:2},serial);
  h.native.handle({event:'output_transcript',text:'Old',request_id:1,generation:2},serial);
  h.native.sendText('Second');
  const before=h.events.length;
  h.native.handle({event:'output_transcript',text:'Late first',request_id:1,generation:2},serial);
  h.native.handle({event:'turn_complete',request_id:1,generation:2},serial);
  assert.equal(h.events.length,before);
  h.native.handle({event:'input_accepted',request_id:1,generation:99},serial);assert.equal(h.native.generation,2);
  h.native.handle({event:'input_accepted',request_id:2,generation:4},serial);
  h.native.handle({event:'output_transcript',text:'Still old',request_id:1,generation:2},serial);
  h.native.handle({event:'output_transcript',text:'Current',request_id:2,generation:4},serial);
  h.native.handle({event:'audio',data:'invalid',request_id:2,generation:4},serial);
  assert.equal(h.events.at(-1).text,'Current');assert.equal(h.stats.nativeOutputBytes,undefined);
  assert.deepEqual(h.sent.filter(p=>p.type==='text').map(p=>p.request_id),[1,2]);
  await h.native.stop();
});

test('written commentary belongs to the exact rendered step and advances only manually',async t=>{
  const h=fixture(t);await h.native.start({textOnly:true});const serial=h.native.serial;
  h.native.sendText('Explain');h.native.handle({event:'input_accepted',request_id:1,generation:2},serial);
  // A matching cancellation ACK must retire the old intent before accepting a sequence.
  h.native.handle({event:'teaching_cancelled',cancellation_id:h.native.teachingCancelPending},serial);
  h.native.handle({event:'teaching_started',sequence_id:'current',generation:2,request_id:1},serial);
  h.native.handle({event:'teaching_step',sequence_id:'current',index:0,count:2,focus_label:'Evidence',narration:'First compare the source evidence.',generation:2,request_id:1},serial);
  assert.equal(h.stats.teaching.phase,'waiting-reader');assert.equal(h.stats.teaching.manualOnly,true);
  const before=h.events.length;
  h.native.handle({event:'teaching_text',sequence_id:'old',index:0,count:2,text:'Wrong',complete:true,request_id:1,generation:2},serial);
  assert.equal(h.events.length,before);
  h.native.handle({event:'teaching_text',sequence_id:'current',index:0,count:2,text:'First compare the source evidence.',complete:true,request_id:1,generation:2},serial);
  assert.equal(h.events.at(-1).event,'teaching_text');assert.equal(h.native.teaching.update({idle:true}),false);
  assert.equal(h.native.teaching.continueManually(),true);
  assert.deepEqual(h.sent.at(-1),{type:'teaching_boundary',sequence_id:'current',index:0,heard:false,manual:true});
  await h.native.stop();
});

test('unexpected socket loss stops local ownership and reports a manual recovery path',async t=>{
  const h=fixture(t);await h.native.start({textOnly:true});
  h.socket().onclose({code:1006,wasClean:false});
  assert.equal(h.native.active,false);assert.equal(h.native.socket,null);
  assert.match(h.errors.at(-1),/connection was lost/);assert.equal(h.stats.nativeSocketClose.code,1006);
  assert.equal(h.sent.filter(p=>p.type==='text').length,0);
});

test('superseded text cannot mutate source, visuals or evidence while the next request is pending',async t=>{
  const h=fixture(t);await h.native.start({textOnly:true});const serial=h.native.serial;
  let applied=0;h.native.documentHandler=h.native.videoHandler=h.native.presentationHandler=async()=>{applied++;return {ok:true};};
  h.native.sharedDocument={id:'a'.repeat(64)};h.native.documentViewRevision=1;
  h.native.sendText('First');h.native.handle({event:'input_accepted',request_id:1,generation:2},serial);
  h.native.sendText('Second');const before=h.events.length;
  const old=[{event:'document_action',action:{document_id:'a'.repeat(64),view_revision:1}},
    {event:'video_action',action:{}},{event:'presentation_action',action:{}},
    ...['sources','research_complete','work_plan','calculation','draft_ready','web_grounding'].map(event=>({event,text:'superseded'}))];
  for(const message of old)h.native.handle({...message,generation:2,request_id:1},serial);
  await Promise.resolve();await Promise.resolve();assert.equal(applied,0);assert.equal(h.events.length,before);
  h.native.handle({event:'input_accepted',request_id:2,generation:4},serial);const accepted=h.events.length;
  for(const message of old)h.native.handle({...message,generation:2,request_id:1},serial);
  await Promise.resolve();assert.equal(applied,0);assert.equal(h.events.length,accepted);
  h.native.handle({event:'sources',sources:[],generation:4,request_id:2},serial);assert.equal(h.events.at(-1).event,'sources');
  await h.native.stop();
});
