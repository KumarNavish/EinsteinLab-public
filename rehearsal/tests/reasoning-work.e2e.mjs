import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('..'),out=path.join(root,'evidence/runtime/c9/reasoning-'+Date.now());await fs.mkdir(out,{recursive:true});
const report={scope:'Actual configured Google native model plans, reads an existing official-lab page, calls deterministic arithmetic and delivers an in-conversation downloadable draft. Exa search is explicitly off. No human microphone, account actions, external publication or document upload.',checks:[],errors:[],posts:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,recordVideo:{dir:path.join(out,'interface'),size:{width:1440,height:1000}}});
const page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')report.posts.push(request.url().split('?')[0]);});
const check=(name,passed,details={})=>report.checks.push({name,passed:Boolean(passed),...details});
let recording=false;
try {
  for(let i=0;i<50;i++){try{const r=await context.request.get('http://127.0.0.1:8765/api/native/status');const data=await r.json();if(data.available&&!data.active){report.before=data;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!report.before)throw new Error('No idle ready native service; existing conversations were not interrupted.');
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.__einstein?.stats.avatarReady&&window.__einstein.stats.nativeStatus,{}, {timeout:60000});
  check('public_web_requires_opt_in',!(await page.locator('#public-web').isChecked()));
  await page.evaluate(async()=>{
    const app=window.__einstein;await app.player.prepareNative();
    const video=app.stage.renderer.domElement.captureStream(30);
    const media=new MediaStream([...video.getVideoTracks(),...app.player.capture.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(media,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1400000,audioBitsPerSecond:96000});
    const parts=[];recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};
    window.__workRecording={recorder,parts,video};recorder.start(250);
  });recording=true;
  const question='Make a short plan, read the official Telematics for Road Safety results, calculate (250-200)/250*100 as a separate hypothetical example, and deliver a downloadable note. Clearly distinguish the lab result from the made-up numbers. Do not use external web search or consult Flash for this task.';
  await page.getByRole('button',{name:'Type a question',exact:true}).click();await page.locator('#question').fill(question);await page.getByRole('button',{name:'Send question',exact:true}).click();
  await page.waitForFunction(()=>window.__einstein.stats.latestDraft?.markdown,{}, {timeout:110000});
  await page.waitForFunction(()=>window.__einstein.stats.nativeCompletedTurns>=1,{}, {timeout:45000});
  check('actual_native_answer_completed',true);
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&window.__einstein.player.entries.length===0,{}, {timeout:45000});
  report.events=await page.evaluate(()=>window.__einstein.stats.workEvents||[]);
  report.draft=await page.evaluate(()=>window.__einstein.stats.latestDraft);
  report.answer=await page.evaluate(()=>window.__einstein.stats.lastTurn);
  report.audio=await page.evaluate(()=>({continuous:window.__einstein.stats.continuousAudioStream,toneFramesSuppressed:window.__einstein.stats.audioToneFramesSuppressed,underruns:window.__einstein.stats.audioUnderruns,queueMs:window.__einstein.stats.audioQueueMs}));
  check('plan_returned',report.events.some(event=>event.event==='work_plan'&&event.plan.steps.length>=2));
  const calculation=report.events.find(event=>event.event==='calculation');
  check('actual_arithmetic_used',calculation&&Number(calculation.result.result)===20);
  const tools=report.events.filter(event=>event.event==='work_activity').map(event=>event.tool);
  check('actual_lab_lookup_executed',tools.includes('lookup_lab'));
  check('draft_tool_executed',tools.includes('deliver_note'));
  check('draft_distinguishes_hypothetical_numbers',/hypothetical|illustrat|made.up|not.*lab|not.*study/i.test(report.draft.markdown));
  check('draft_preserves_nonsignificant_accident_result',/not significant|not statistically significant|no statistically significant|non.significant/i.test(report.draft.markdown));
  check('draft_has_actual_source_url',report.draft.markdown.includes('telematics-for-road-safety'));
  check('no_exa_tool_called',!tools.some(tool=>['search_public','read_public'].includes(tool)));
  await page.locator('#source-toggle').click();await page.waitForTimeout(350);
  await page.screenshot({path:path.join(out,'actual-plan-and-draft.png')});
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download this draft',exact:true}).first().click();
  const download=await downloadPromise;await download.saveAs(path.join(out,'delivered-note.md'));
  const downloaded=await fs.readFile(path.join(out,'delivered-note.md'),'utf8');check('download_matches_delivered_text',downloaded===report.draft.markdown);
  await page.keyboard.press('Escape');await page.evaluate(()=>window.__einstein.native.stop());
  check('no_real_microphone_opened',!await page.evaluate(()=>window.__einstein.stats.microphoneActive));
  await page.setViewportSize({width:390,height:844});await page.locator('#source-toggle').click();await page.waitForTimeout(250);
  await page.screenshot({path:path.join(out,'mobile-work-notes.png')});
  check('mobile_has_no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check('no_runtime_errors',report.errors.length===0);
} catch(error){report.failure=error.stack;report.stateAtFailure=await page.evaluate(()=>window.__einstein?.stats).catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await page.evaluate(()=>window.__einstein?.native.stop()).catch(()=>{});}
if(recording){try{const text=await page.evaluate(async()=>{const capture=window.__workRecording;await new Promise(resolve=>{capture.recorder.onstop=resolve;capture.recorder.stop();});const bytes=new Uint8Array(await new Blob(capture.parts,{type:'video/webm'}).arrayBuffer());let output='';for(let i=0;i<bytes.length;i+=8192)output+=String.fromCharCode(...bytes.subarray(i,i+8192));capture.video.getTracks().forEach(track=>track.stop());return btoa(output);});await fs.writeFile(path.join(out,'actual-reasoning-voice.webm'),Buffer.from(text,'base64'));report.recording='actual-reasoning-voice.webm';}catch(error){report.captureError=error.message;}}
const video=page.video();await context.close();report.interfaceVideo=await video.path();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:out,checks:report.checks,draft:report.draft,audio:report.audio,errors:report.errors,failure:report.failure},null,2));
if(report.failure||report.checks.some(item=>!item.passed))process.exitCode=1;
