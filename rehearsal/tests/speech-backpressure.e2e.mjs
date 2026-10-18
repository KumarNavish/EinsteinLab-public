import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.EINSTEIN_TEST_URL || 'http://127.0.0.1:8765/';
const headed = process.env.EINSTEIN_HEADED === '1';
const out = path.resolve('../.work/audio-queue-repair-20261015/' + (headed ? 'headed-recovery-v2' : 'headless-recovery-v2'));
await fs.mkdir(out, {recursive:true});
const report = {scope:'Real local application and its authored introduction, actual audio graph and rendered character. No Google/Anam request, human microphone, or substituted API response. This is not public-site or subjective voice-quality acceptance.',
  browser:'Isolated Chrome via Playwright; Browser plugin not available.',headed,origin,checks:[],errors:[],posts:[]};
const browser = await chromium.launch({channel:'chrome',headless:!headed,args:['--autoplay-policy=no-user-gesture-required']});
const context = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
page.on('request', request => {if(request.method()==='POST')report.posts.push(new URL(request.url()).pathname);});
const check = (name, passed, detail={}) => report.checks.push({name,passed,...detail});
let recording=false;
try {
  await page.goto(origin,{waitUntil:'networkidle',timeout:90000});
  await page.waitForFunction(()=>window.__einstein?.stats.avatarReady,{},{timeout:90000});
  check('correct_nonblank_app', (await page.title()).includes('Einstein') && await page.locator('#introduction').isVisible());
  await page.locator('#conversation-engine').selectOption('local',{force:true});
  await page.locator('#sound').check({force:true});
  await page.evaluate(async()=>{
    const app=window.__einstein;await app.player.activate();
    window.__speechProbe={samples:[],peak:0};
    window.__speechProbe.timer=setInterval(()=>{
      const p=app.player,probe=window.__speechProbe;
      const samples=new Float32Array(p.analyser.fftSize);p.analyser.getFloatTimeDomainData(samples);
      let rms=0;for(const value of samples)rms+=value*value;rms=Math.sqrt(rms/samples.length);probe.peak=Math.max(probe.peak,rms);
      if(probe.samples.length<900)probe.samples.push({wall:performance.now(),clock:p.context.currentTime,queue:Math.max(0,(p.tail||0)-p.context.currentTime),playing:app.stats.audioPlaying,waiting:app.stats.speechBackpressure,rms});
    },100);
    const canvas=app.stage.renderer.domElement.captureStream(20);
    const stream=new MediaStream([...canvas.getVideoTracks(),...app.player.capture.stream.getAudioTracks()]);
    const mimeType=['video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:1000000,audioBitsPerSecond:96000});
    const parts=[];recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};
    window.__speechRecording={recorder,parts,canvas};recorder.start(250);
  });
  recording=true;
  await page.locator('#introduction').click();
  await page.waitForFunction(()=>window.__einstein.stats.audioPlaying||!document.querySelector('#error').hidden,{},{timeout:45000});
  if(await page.evaluate(()=>!document.querySelector('#error').hidden))throw new Error(await page.locator('#error').innerText());
  await page.waitForFunction(()=>window.__einstein.stats.lastTurn?.timings && !window.__einstein.player.receiving && !window.__einstein.stats.audioPlaying && window.__einstein.player.entries.length===0 || !document.querySelector('#error').hidden,{},{timeout:120000});
  report.completed=await page.evaluate(()=>({state:window.__einstein.stats.state,mode:window.__einstein.stats.lastTurn?.mode,
    serverTimings:window.__einstein.stats.lastTurn?.timings,receivedSegments:window.__einstein.stats.receivedSegments,
    scheduledSlices:window.__einstein.stats.audioSegments,backpressureWaits:window.__einstein.stats.speechBackpressureWaits,
    peakScheduledQueueMs:window.__einstein.stats.peakScheduledQueueMs,error:document.querySelector('#error').textContent,
    probe:window.__speechProbe.samples,peakRMS:window.__speechProbe.peak}));
  check('authored_introduction_is_disclosed',report.completed.mode==='prepared-introduction');
  check('full_intro_completes_without_queue_exception',report.completed.state!=='error'&&!report.completed.error);
  check('producer_waited_for_playback',report.completed.backpressureWaits>0);
  check('scheduled_audio_stayed_within_twenty_seconds',report.completed.peakScheduledQueueMs<=20001);
  check('actual_audio_graph_is_non_silent',report.completed.peakRMS>.005);
  const audible=report.completed.probe.filter(item=>item.rms>.003);
  report.audibleSpanSeconds=audible.length?Math.max(0,(audible.at(-1).wall-audible[0].wall)/1000):0;
  check('long_reply_exercised_overflow_regime',report.audibleSpanSeconds>20);
  await page.screenshot({path:path.join(out,'complete-introduction.png')});
  await page.locator('#keyboard-toggle').click();
  await page.locator('#question').fill('What does the GenAI in VR project investigate?');
  await page.locator('#send').click();
  await page.waitForFunction(()=>window.__einstein.stats.audioPlaying,{},{timeout:45000});
  const started=await page.evaluate(()=>performance.now());
  await page.locator('#interrupt').click();
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&!window.__einstein.player.receiving&&window.__einstein.player.entries.length===0,{},{timeout:3000});
  report.interruptMs=await page.evaluate(start=>performance.now()-start,started);
  check('waiting_audio_is_interruptible',report.interruptMs<1500);
  const afterStop=await page.evaluate(()=>window.__einstein.player.version);
  await page.waitForTimeout(400);
  check('cancelled_clip_does_not_resume',await page.evaluate(()=>window.__einstein.player.entries.length===0&&!window.__einstein.stats.audioPlaying));
  await page.locator('#keyboard-toggle').click();
  await page.locator('#question').fill('What does the lab investigate about delegating decisions to agentic AI?');
  await page.locator('#send').click();
  await page.waitForFunction(()=>window.__einstein.stats.audioPlaying,{},{timeout:45000});
  check('new_turn_recovers_after_interrupt',await page.evaluate(version=>window.__einstein.player.version>version,afterStop));
  await page.waitForTimeout(900);await page.locator('#interrupt').click();
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying);
  check('no_microphone_opened',await page.evaluate(()=>!window.__einstein.stats.microphoneActive));
  check('no_provider_or_avatar_request',report.posts.every(route=>!route.startsWith('/api/native')&&!route.startsWith('/api/avatar')));
  check('no_runtime_errors',report.errors.length===0);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  check('mobile_has_no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'mobile-after-recovery.png')});
} catch(error) {
  report.failure=error.message;
  report.failureState=await page.evaluate(()=>({state:window.__einstein?.stats.state,queue:window.__einstein?.stats.audioQueueMs,
    playerVersion:window.__einstein?.player.version,audioContextState:window.__einstein?.player.context?.state,audioClock:window.__einstein?.player.context?.currentTime,probe:window.__speechProbe?.samples,error:document.querySelector('#error')?.textContent})).catch(()=>null);
  await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
} finally {
  await page.evaluate(()=>clearInterval(window.__speechProbe?.timer)).catch(()=>{});
  if(recording)try{
    const encoded=await page.evaluate(async()=>{
      const c=window.__speechRecording;
      await new Promise(resolve=>{c.recorder.onstop=resolve;c.recorder.stop();});
      c.canvas.getTracks().forEach(track=>track.stop());
      const bytes=new Uint8Array(await new Blob(c.parts,{type:'video/webm'}).arrayBuffer());
      let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);
    });
    await fs.writeFile(path.join(out,'actual-introduction-and-recovery.webm'),Buffer.from(encoded,'base64'));
  }catch(error){report.recordingFailure=error.message;}
  await page.evaluate(()=>window.__einstein?.interrupt()).catch(()=>{});
  await context.close();await browser.close();
}
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,completed:report.completed?{...report.completed,probe:'saved in report.json'}:undefined},null,2));
if(report.failure||report.checks.some(item=>!item.passed))process.exitCode=1;
