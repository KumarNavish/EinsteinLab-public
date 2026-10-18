import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('../evidence/runtime/c9/audio-browser');await fs.mkdir(out,{recursive:true});
const report={scope:'Actual browser AudioWorklet playback with recorded voice and deliberately injected synthetic tones. No Google request, real microphone, OS/headset audio measurement or claim that the reported user beep was reproduced.',checks:[],errors:[],posts:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>report.errors.push(error.message));
page.on('request',request=>{if(request.method()==='POST')report.posts.push(request.url().split('?')[0]);});
const check=(name,passed,data={})=>report.checks.push({name,passed,...data});
try {
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.__einstein?.stats.avatarReady,{}, {timeout:60000});
  check('intended_page',(await page.title())==='Einstein · Mobiliar Lab');
  await page.evaluate(async()=>{
    const app=window.__einstein;await app.player.prepareNative();app.player.begin();
    const response=await fetch('/voice-previews/Algenib.wav');const data=await response.arrayBuffer();
    const view=new DataView(data);let offset=12;let pcm;
    while(offset+8<=data.byteLength){const id=String.fromCharCode(...new Uint8Array(data,offset,4));const size=view.getUint32(offset+4,true);if(id==='data'){pcm=new Uint8Array(data.slice(offset+8,offset+8+size));break;}offset+=8+size+(size%2);}
    if(!pcm)throw new Error('Voice sample has no PCM payload');
    for(let index=0;index<pcm.length;index+=960){await app.player.enqueuePCM(pcm.slice(index,index+960),24000,app.player.version);if(index%9600===0)await new Promise(resolve=>setTimeout(resolve,3));}
    app.player.finish();
  });
  await page.waitForFunction(()=>window.__einstein.stats.audioPlaying,{}, {timeout:10000});
  await page.waitForTimeout(600);
  report.voicePlaying=await page.evaluate(()=>({continuous:window.__einstein.stats.continuousAudioStream,queueMs:window.__einstein.stats.audioQueueMs,toneFrames:window.__einstein.stats.audioToneFramesSuppressed,face:window.__einstein.stats.audioFaceReady,segments:window.__einstein.stats.audioSegments}));
  check('real_worklet_drives_voice',report.voicePlaying.continuous&&report.voicePlaying.queueMs>0);
  check('speech_not_suppressed',report.voicePlaying.toneFrames===0);
  await page.screenshot({path:path.join(out,'actual-continuous-voice.png')});
  const start=performance.now();await page.evaluate(()=>window.__einstein.player.stop());
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&window.__einstein.stats.audioQueueMs===0);
  check('interruption_clears_stream',true,{command_to_silent_state_ms:Math.round(performance.now()-start)});
  const tone=await page.evaluate(async()=>{
    const app=window.__einstein;const version=app.player.begin();
    const buffer=new ArrayBuffer(24000*.4*2);const view=new DataView(buffer);
    for(let i=0;i<buffer.byteLength/2;i++)view.setInt16(i*2,Math.round(Math.sin(2*Math.PI*1000*i/24000)*.3*32767),true);
    await app.player.enqueuePCM(new Uint8Array(buffer),24000,version);app.player.finish();
    let peak=0;const values=new Float32Array(512);
    for(let i=0;i<90;i++){await new Promise(resolve=>setTimeout(resolve,10));app.player.analyser.getFloatTimeDomainData(values);for(const x of values)peak=Math.max(peak,Math.abs(x));}
    return {peak,toneFrames:app.stats.audioToneFramesSuppressed,underruns:app.stats.audioUnderruns};
  });
  report.syntheticTone=tone;
  check('injected_beep_suppressed_in_real_audio_graph',tone.peak<.001&&tone.toneFrames>=18);
  await page.evaluate(()=>window.__einstein.player.stop());
  check('microphone_never_opened',!await page.evaluate(()=>window.__einstein.stats.microphoneActive));
  check('zero_provider_posts',report.posts.length===0);
  check('no_runtime_error',report.errors.length===0);
}catch(error){report.failure=error.stack;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(report.failure||report.checks.some(item=>!item.passed))process.exitCode=1;
