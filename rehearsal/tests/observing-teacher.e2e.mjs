import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomInt} from 'node:crypto';

const out=path.resolve('../evidence/runtime/c12/observing-teacher-'+Date.now());
await fs.mkdir(out,{recursive:true});
const report={scope:'Actual native model, tool execution, rendered conceptual diagram and spoken output. Typed visitor prompts; Chrome fake media-device flags stabilize the isolated test environment (no microphone opened). A labelled marker intervention separately tests whether the model inspects actual pixels. No PDF/video acquisition or human/Quest test.',checks:[],turns:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:1536,height:1000},recordVideo:{dir:path.join(out,'interface'),size:{width:1536,height:1000}}});
const page=await context.newPage();
page.on('pageerror',error=>report.errors.push(error.message));
const check=(name,passed,details={})=>report.checks.push({name,passed,...details});
let capture=false;
async function ask(question){
  const count=await page.evaluate(()=>window.__einstein.stats.nativeCompletedTurns||0);
  await page.evaluate(q=>window.__einstein.ask(q),question);
  await page.waitForFunction(n=>(window.__einstein.stats.nativeCompletedTurns||0)>n,count,{timeout:75000});
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&!window.__einstein.player.entries.length,{}, {timeout:40000});
  const state=await page.evaluate(()=>({answer:window.__einstein.stats.lastTurn,visual:window.__einstein.stats.visual,caption:document.querySelector('#live-caption').textContent,fullCaption:window.__einstein.captions.fullText,context:window.__einstein.player.context?.state,inspections:window.__einstein.stats.visualImageInspections||0}));
  report.turns.push({question,...state});return state;
}
try{
  for(let attempt=0;attempt<80;attempt++){
    try{const r=await context.request.get('http://127.0.0.1:8765/api/native/status');if(r.ok()){const status=await r.json();if(status.available&&status.visual_tools.includes('inspect_visual')){report.before=status;break;}}}catch{}
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(!report.before)throw new Error('Updated native server did not become ready');
  if(report.before.active)throw new Error('A visitor is active; no test conversation was started');
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'networkidle',timeout:90000});
  await page.waitForFunction(()=>window.__einstein?.stats.avatarReady,{}, {timeout:90000});
  await page.evaluate(()=>{const n=window.__einstein.native,original=n.presentationHandler;n.presentationHandler=async(action,valid)=>{const result=await original(action,valid);if(result.image)window.__lastInspectedImage=result.image;return result;};});
  await page.getByRole('button',{name:'Conversation settings',exact:true}).click();
  await page.locator('#conversation-engine').selectOption('native');
  await page.keyboard.press('Escape');
  await page.locator('#introduction').click();
  await page.waitForFunction(()=>window.__einstein.stats.audioPlaying&&window.__einstein.player.context.currentTime>.1,{}, {timeout:30000});
  await page.evaluate(()=>{
    const {stage,player}=window.__einstein;
    const visual=stage.renderer.domElement.captureStream(30);
    const stream=new MediaStream([...visual.getVideoTracks(),...player.capture.stream.getAudioTracks()]);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',videoBitsPerSecond:1300000,audioBitsPerSecond:96000});
    const chunks=[];recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    window.__teachingCapture={recorder,chunks,visual};recorder.start(200);
  });capture=true;
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying&&!window.__einstein.player.entries.length&&window.__einstein.stats.lastTurn,{}, {timeout:40000});
  const first=await ask('Teach me why selecting on a common effect can create an association between independent causes. Use two independent fair coins A and B, and select only trials where at least one is heads. Draw a three-node conceptual diagram, then give one short intuitive explanation. Label it a mathematical illustration, not empirical evidence.');
  check('novel_concept_produced_actual_graph',first.visual.visible&&first.visual.graph.nodes.length>=3);
  check('captions_are_short_and_history_is_complete',first.caption.length<=114&&first.fullCaption===first.answer.answer);
  // Controlled perception intervention: this marker is NOT in the graph metadata
  // or user question sent to the model. It is added only to the actually displayed canvas.
  const marker=['K','M','R','Y'][randomInt(4)] + String(randomInt(2,10)); report.controlledPixelMarker=marker;
  await page.evaluate(text=>{const b=window.__einstein.board;b.ctx.fillStyle='#7528a8';b.ctx.font='bold 72px system-ui';b.ctx.fillText(text,1380,230);b.texture.needsUpdate=true;},marker);
  await page.screenshot({path:path.join(out,'marker-visible.png')});
  const second=await ask('I added a small colored marker near the upper-right corner of the displayed whiteboard. Inspect the actual rendered image, then tell me its exact letters or digits and its color. Do not infer it from your planned diagram.');
  check('actual_render_inspected',second.inspections>=1);
  const captured=await page.evaluate(()=>window.__lastInspectedImage||null);if(captured){await fs.writeFile(path.join(out,'actual-inspected-image.jpg'),Buffer.from(captured.data,'base64'));report.inspectionImageFile='actual-inspected-image.jpg';}
  check('pixels_not_graph_metadata_identify_marker',new RegExp(marker[0]+'\\s*'+marker[1],'i').test(second.answer.answer)&&/purple|violet|lavender/i.test(second.answer.answer));
  const third=await ask('Now challenge the intuition with numbers. In the selected trials, what is P(B is heads | A is heads), and what is P(B is heads | A is tails)? Use the calculator. Revise or annotate the conceptual diagram to make the induced association clear without drawing a causal arrow from A to B.');
  check('counterexample_revises_displayed_graph',third.visual.visible&&third.visual.revision>first.visual.revision);
  const fourth=await ask('Focus on the selection variable and explain in one sentence why observing an association after selection does not show that coin A caused coin B.');
  check('followup_uses_actual_element',Boolean(fourth.visual.focused));
  const geometry=await page.evaluate(()=>{
    const app=window.__einstein,mesh=app.board.mesh;
    const pos=mesh.geometry.attributes.position;const corners=[];
    for(let i=0;i<pos.count;i++){const v=app.stage.camera.position.clone().set(pos.getX(i),pos.getY(i),pos.getZ(i));mesh.localToWorld(v);v.project(app.stage.camera);corners.push({x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2});}
    const caption=document.querySelector('.caption-region').getBoundingClientRect();
    const board={left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),bottom:Math.max(...corners.map(p=>p.y)),top:Math.min(...corners.map(p=>p.y))};
    return {board,caption:{top:caption.top,bottom:caption.bottom,height:caption.height},width:innerWidth,height:innerHeight,captionFont:getComputedStyle(document.querySelector('#live-caption')).fontSize};
  });report.geometry=geometry;
  check('caption_band_does_not_cover_diagram',geometry.caption.top>geometry.board.bottom);
  check('teaching_workspace_is_primary',geometry.board.right-geometry.board.left>geometry.width*.48);
  await page.screenshot({path:path.join(out,'teaching-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(600);
  await page.evaluate(()=>window.__einstein.captions.set('A causal explanation is not established merely because two variables are associated after selecting observations. The entire original answer remains available in the conversation history.'));
  check('mobile_caption_is_bounded',await page.evaluate(()=>document.querySelector('#live-caption').textContent.length<=72&&document.querySelector('.caption-region').getBoundingClientRect().height<=48));
  check('mobile_no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'teaching-mobile.png')});
  await page.evaluate(()=>window.__einstein.interrupt());
  for(let i=0;i<40;i++){const r=await context.request.get('http://127.0.0.1:8765/api/native/status');report.after=await r.json();if(!report.after.active&&report.after.last_session?.conversation_id===report.turns[0].answer.conversation_id)break;if(!report.after.active&&report.after.last_session?.diagram_image_inspections)break;await page.waitForTimeout(200);}
  check('live_frame_channel_sent_the_actual_diagram',report.after?.last_session?.diagram_image_inspections>=1);
  check('native_session_released',report.after?.active===false);
  check('no_runtime_errors',report.errors.length===0);
}catch(error){report.failure=error.stack;report.failureState=await page.evaluate(()=>window.__einstein?.stats).catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
if(capture){try{const data=await page.evaluate(async()=>{const c=window.__teachingCapture;await new Promise(resolve=>{c.recorder.onstop=resolve;c.recorder.stop();});const b=new Uint8Array(await new Blob(c.chunks).arrayBuffer());let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));c.visual.getTracks().forEach(t=>t.stop());return btoa(s);});await fs.writeFile(path.join(out,'actual-observing-teacher.webm'),Buffer.from(data,'base64'));report.recording='actual-observing-teacher.webm';}catch(error){report.captureFailure=error.message;}}
await page.evaluate(()=>window.__einstein?.interrupt()).catch(()=>{});
const video=page.video();await context.close();report.interfaceVideo=await video.path();await browser.close();
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory:out,...report},null,2));
if(report.failure||report.checks.some(c=>!c.passed))process.exitCode=1;
