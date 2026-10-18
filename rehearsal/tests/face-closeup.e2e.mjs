import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const out = path.resolve('../evidence/runtime/c10/face-closeup');
await fs.mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport:{width:1280,height:900}});
const report = {scope:'Actual updated character rendering with an existing recorded native voice, through the current continuous PCM graph and classifier. No provider request or human microphone. Mouth-event timing is diagnostic, not ground-truth phoneme alignment.',checks:[],errors:[]};
page.on('pageerror', e=>report.errors.push(e.message));
const check=(name,passed,extra={})=>report.checks.push({name,passed:Boolean(passed),...extra});
try {
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.__einstein?.stats.avatarReady,{},{timeout:90000});
  await page.locator('#portrait').click();
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(out,'face-idle.png')});
  await page.evaluate(async()=>{
    const app=window.__einstein; await app.player.prepareNative();
    const r=await fetch('/voice-previews/Algenib.wav');const bytes=await r.arrayBuffer();
    const header=new DataView(bytes);let offset=12,pcm=null,rate=null;
    const tag=i=>String.fromCharCode(...new Uint8Array(bytes,i,4));
    while(offset+8<=bytes.byteLength){const length=header.getUint32(offset+4,true);if(tag(offset)==='fmt ')rate=header.getUint32(offset+12,true);if(tag(offset)==='data')pcm=new Uint8Array(bytes,offset+8,length);offset+=8+length+(length%2);}
    if(rate!==24000||!pcm)throw new Error('Recorded fixture must actually be 24 kHz PCM');
    const video=app.stage.renderer.domElement.captureStream(30);
    const stream=new MediaStream([...video.getVideoTracks(),...app.player.capture.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1600000});
    const chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    window.__faceCapture={recorder,chunks,video};window.__faceMotion=[];
    window.__faceTimer=setInterval(()=>{const s=app.stage;if(app.stats.audioPlaying)window.__faceMotion.push({audioTime:app.player.context.currentTime,jaw:s.current.jaw,open:s.current.V_Open,round:s.current.V_Tight_O,closed:s.current.V_Explosive,classes:app.stats.audioFaceClasses?.slice(),zero:app.stats.audioFaceZeroEvents||0});},16);
    recorder.start(200);
    const version=app.player.begin();
    for(let start=0;start<pcm.length;start+=4096)await app.player.enqueuePCM(pcm.slice(start,start+4096),rate,version);
    app.player.finish();
  });
  await page.waitForFunction(()=>window.__einstein.stats.audioPlaying,{},{timeout:10000});
  await page.waitForTimeout(1250);
  await page.screenshot({path:path.join(out,'face-speaking.png')});
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying && window.__einstein.stats.audioQueueMs===0,{},{timeout:20000});
  report.stats=await page.evaluate(()=>window.__einstein.stats);
  report.motion=await page.evaluate(()=>window.__faceMotion);
  check('real_classifier_active',report.stats.audioFaceReady);
  check('continuous_stream_used',report.stats.continuousAudioStream===true);
  check('open_vowel_zero_observed',report.stats.audioFaceZeroEvents>0);
  check('mouth_actually_opens',Math.max(...report.motion.map(f=>f.open))>.35);
  check('round_and_closed_poses_present',report.motion.some(f=>f.round>.10) && report.motion.some(f=>f.closed>.10));
  check('no_console_errors',report.errors.length===0);
  await page.screenshot({path:path.join(out,'face-after-speech.png')});
  const b64=await page.evaluate(async()=>{
    clearInterval(window.__faceTimer);const c=window.__faceCapture;await new Promise(r=>{c.recorder.onstop=r;c.recorder.stop();});
    const bytes=new Uint8Array(await new Blob(c.chunks).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));c.video.getTracks().forEach(t=>t.stop());return btoa(text);
  });
  await fs.writeFile(path.join(out,'actual-face-and-audio.webm'),Buffer.from(b64,'base64'));
} catch(e) {report.failure=e.stack;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({checks:report.checks,errors:report.errors,zero:report.stats?.audioFaceZeroEvents,failure:report.failure},null,2));
if(report.failure||report.checks.some(c=>!c.passed))process.exitCode=1;
