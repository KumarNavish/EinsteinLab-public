import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';import path from 'node:path';
const out=path.resolve('../evidence/runtime/c12/native-source-'+Date.now());await fs.mkdir(out,{recursive:true});
const report={scope:'Actual Google-native conversation and exact text from an existing official-lab lookup. This verifies an excerpt card, NOT paper reading, original figure extraction or uploaded-source support.',checks:[],turns:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:1536,height:1000},recordVideo:{dir:path.join(out,'interface'),size:{width:1536,height:1000}}});const page=await context.newPage();
page.on('pageerror',error=>report.errors.push(error.message));let capture=false;
const check=(name,passed,details={})=>report.checks.push({name,passed,...details});
async function ask(question){const n=await page.evaluate(()=>window.__einstein.stats.nativeCompletedTurns||0);await page.evaluate(q=>window.__einstein.ask(q),question);await page.waitForFunction(n=>(window.__einstein.stats.nativeCompletedTurns||0)>n,n,{timeout:60000});await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&!window.__einstein.player.entries.length,{}, {timeout:40000});const r=await page.evaluate(()=>({answer:window.__einstein.stats.lastTurn,visual:window.__einstein.stats.visual}));report.turns.push({question,...r});return r;}
try{
 const pre=await context.request.get('http://127.0.0.1:8765/api/native/status');const status=await pre.json();if(status.active)throw new Error('Existing participant is active');
 await page.goto('http://127.0.0.1:8765/',{waitUntil:'networkidle',timeout:60000});await page.waitForFunction(()=>window.__einstein?.stats.avatarReady,{}, {timeout:60000});
 await page.getByRole('button',{name:'Conversation settings',exact:true}).click();await page.locator('#conversation-engine').selectOption('native');await page.keyboard.press('Escape');
 await page.locator('#introduction').click();await page.waitForFunction(()=>window.__einstein.stats.audioPlaying&&window.__einstein.player.context.currentTime>.1,{}, {timeout:30000});
 await page.evaluate(()=>{const a=window.__einstein;const v=a.stage.renderer.domElement.captureStream(30);const s=new MediaStream([...v.getVideoTracks(),...a.player.capture.stream.getAudioTracks()]);const r=new MediaRecorder(s,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1300000,audioBitsPerSecond:96000});const parts=[];r.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};window.__sourceCapture={r,v,parts};r.start(200);});capture=true;
 await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&!window.__einstein.player.entries.length&&window.__einstein.stats.lastTurn,{}, {timeout:35000});
 const first=await ask('Look up the actual official Mobiliar Lab page for GenAI in VR. Show a source excerpt with its original wording, not your own diagram. Highlight an exact phrase indicating whether the outcomes are anticipated or established, then explain that distinction briefly.');
 const p=first.visual.passage;check('actual_source_excerpt_displayed',Boolean(p?.text&&p?.url?.includes('genai-in-vr')));check('quote_is_exact_source_substring',Boolean(p?.quote&&p.text.includes(p.quote)));
 const trueSource=await page.evaluate(()=>{const p=window.__einstein.stats.visual.passage;return p&&[...document.querySelectorAll('#sources p')].some(e=>e.textContent.includes(p.text));});check('displayed_text_matches_actual_inspected_ledger',trueSource);
 await page.screenshot({path:path.join(out,'source-evidence.png')});
 const quote=(p?.text.match(/Expected Results|Project Status|expected|anticipate|potential|hypothes\w*/i)||[])[0]||p?.quote;
 if(!quote)throw new Error('No actual source phrase was available for the follow-up');
 const second=await ask('Focus on this exact visible phrase: "'+quote+'". Explain in one sentence what it does and does not establish. Keep the original source wording unchanged.');
 check('spoken_focus_keeps_original_passage',second.visual.passage?.text===p.text&&second.visual.passage?.quote===quote);
 await page.screenshot({path:path.join(out,'source-phrase-focused.png')});
 const third=await ask('Replace the source excerpt with a simple two-box conceptual explanation showing what the project is testing. Label the relation as a hypothesis, not a proven benefit.');
 check('source_to_concept_transition_is_real',third.visual.visible&&third.visual.graph?.nodes?.length===2&&!third.visual.passage);
 check('concept_retains_hypothesis_boundary',third.visual.graph?.edges?.some(e=>e.kind==='causal-hypothesis'));
 await page.screenshot({path:path.join(out,'source-to-concept.png')});
 await page.evaluate(()=>window.__einstein.interrupt());
 for(let i=0;i<40;i++){report.after=await (await context.request.get('http://127.0.0.1:8765/api/native/status')).json();if(!report.after.active)break;await page.waitForTimeout(150);}
 check('native_session_released',report.after?.active===false);check('console_clean',report.errors.length===0);
}catch(error){report.failure=error.stack;report.failureState=await page.evaluate(()=>window.__einstein?.stats).catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
if(capture){try{const data=await page.evaluate(async()=>{const c=window.__sourceCapture;await new Promise(ok=>{c.r.onstop=ok;c.r.stop();});const a=new Uint8Array(await new Blob(c.parts).arrayBuffer());let t='';for(let i=0;i<a.length;i+=8192)t+=String.fromCharCode(...a.subarray(i,i+8192));c.v.getTracks().forEach(t=>t.stop());return btoa(t);});await fs.writeFile(path.join(out,'actual-source-walkthrough.webm'),Buffer.from(data,'base64'));report.recording='actual-source-walkthrough.webm';}catch(error){report.captureFailure=error.message;}}
await page.evaluate(()=>window.__einstein?.interrupt()).catch(()=>{});const v=page.video();await context.close();report.interfaceVideo=await v.path();await browser.close();await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:out,...report},null,2));if(report.failure||report.checks.some(c=>!c.passed))process.exitCode=1;
