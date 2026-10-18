import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('..'), out=path.join(root,'evidence/runtime/c11','spoken-board-'+Date.now());
await fs.mkdir(out,{recursive:true});
const fixture=path.join(root,'evidence/runtime/c11/spoken-fixture/questions.wav');await fs.access(fixture);
const report={scope:'Three disclosed synthetic spoken requests enter the real microphone/Google native pipeline. The model chooses actual source and visual tools; no diagram command is injected by this test. Not a human-room or headset test.',checks:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${fixture}`]});
const context=await browser.newContext({viewport:{width:1600,height:1000},permissions:['microphone']});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
const check=(name,passed,extra={})=>report.checks.push({name,passed:Boolean(passed),...extra});let capture=false;
try{
 const before=await(await context.request.get('http://127.0.0.1:8765/api/native/status')).json();if(!before.available||before.active)throw new Error('An existing participant is active or native voice is unavailable.');
 await page.goto('http://127.0.0.1:8765/',{waitUntil:'networkidle',timeout:90000});await page.waitForFunction(()=>window.__einstein?.stats.avatarReady&&window.__einstein.stats.nativeStatus,{}, {timeout:60000});
 await page.locator('#microphone').click();await page.waitForFunction(()=>window.__einstein.stats.microphoneActive&&window.__einstein.stats.audioPlaying,{}, {timeout:35000});
 await page.evaluate(()=>{
  const app=window.__einstein, context=app.player.context;
  const mix=context.createMediaStreamDestination();app.player.master.connect(mix);
  const input=context.createMediaStreamSource(app.native.stream);const inputGain=context.createGain();inputGain.gain.value=.75;input.connect(inputGain);inputGain.connect(mix);
  const video=app.stage.renderer.domElement.captureStream(30);const stream=new MediaStream([...video.getVideoTracks(),...mix.stream.getAudioTracks()]);
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1250000,audioBitsPerSecond:96000});const chunks=[];
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};window.__spokenCapture={recorder,chunks,video,mix,input,inputGain};recorder.start(250);
 });capture=true;
 await page.waitForFunction(()=>window.__einstein.stats.visual?.visible&&window.__einstein.stats.nativeCompletedTurns>0,{}, {timeout:65000});
 report.first=await page.evaluate(()=>({visual:window.__einstein.stats.visual,transcript:window.__einstein.stats.lastTranscript,utterances:window.__einstein.stats.nativeUtterances,accent:window.__einstein.stats.nativeAccent}));
 check('spoken_request_creates_acknowledged_diagram',report.first.visual.visible&&report.first.visual.graph.nodes.length>=2);
 check('actual_project_source_cited',report.first.visual.graph.sources.some(s=>s.url.includes('llms-and-cognitive-load')));
 check('real_microphone_path_was_used',report.first.utterances>=1&&/cognitive|language|load/i.test(report.first.transcript||''));
 check('german_direction_active',report.first.accent==='german');
 await page.screenshot({path:path.join(out,'spoken-diagram.png')});
 await page.waitForFunction(()=>window.__einstein.stats.visual?.focused,{}, {timeout:65000});
 await page.waitForTimeout(1100);report.focus=await page.evaluate(()=>({visual:window.__einstein.stats.visual,attention:window.__einstein.stage.attentionMetrics,utterances:window.__einstein.stats.nativeUtterances}));
 check('spoken_followup_highlights_existing_element',Boolean(report.focus.visual.focused)&&report.focus.utterances>=2);
 check('spoken_focus_keeps_arms_at_rest',report.focus.attention?.pointing===null&&report.focus.attention?.headOrientationEnabled===true);
 await page.screenshot({path:path.join(out,'spoken-focus.png')});
 await page.waitForFunction(()=>!window.__einstein.stats.visual?.visible&&window.__einstein.stats.presentationActions?.some(a=>a.kind==='hide'),{}, {timeout:65000});
 check('spoken_dismissal_executes',true);
 await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&(window.__einstein.stats.audioQueueMs||0)<80,{}, {timeout:25000});
 report.final=await page.evaluate(()=>window.__einstein.stats);const id=report.final.nativeConversationId;
 await page.locator('#microphone').click();
 for(let i=0;i<50;i++){report.after=await(await context.request.get('http://127.0.0.1:8765/api/native/status')).json();if(!report.after.active&&report.after.last_session?.conversation_id===id)break;await new Promise(r=>setTimeout(r,100));}
 check('matched_session_receipt_confirms_three_visual_actions',report.after.last_session?.conversation_id===id&&report.after.last_session.visual_acknowledged>=3);
 check('microphone_and_native_session_release',!report.after.active&&!await page.evaluate(()=>window.__einstein.stats.microphoneActive));
 check('no_runtime_errors',report.errors.length===0);
}catch(e){report.failure=e.stack;report.failureState=await page.evaluate(()=>window.__einstein?.stats).catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await page.evaluate(()=>window.__einstein?.native.stop()).catch(()=>{});}
if(capture){try{const base64=await page.evaluate(async()=>{const c=window.__spokenCapture;await new Promise(r=>{c.recorder.onstop=r;c.recorder.stop();});const bytes=new Uint8Array(await new Blob(c.chunks,{type:'video/webm'}).arrayBuffer());if(bytes.length<1024)throw new Error('No recording data');let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));c.video.getTracks().forEach(t=>t.stop());c.input.disconnect();c.inputGain.disconnect();window.__einstein.player.master.disconnect(c.mix);return btoa(s);});await fs.writeFile(path.join(out,'actual-spoken-whiteboard.webm'),Buffer.from(base64,'base64'));report.recordingScope='Actual canvas, actual Google output, and synthetic incoming microphone questions mixed into one recording; no redub or pause removal. Recording starts after native output begins, so the first introduction may begin mid-sentence.';}catch(e){report.recordingFailure=e.message;}}
await context.close();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:out,checks:report.checks,failure:report.failure,recordingFailure:report.recordingFailure,lastSession:report.after?.last_session},null,2));if(report.failure||report.recordingFailure||report.checks.some(c=>!c.passed))process.exitCode=1;
