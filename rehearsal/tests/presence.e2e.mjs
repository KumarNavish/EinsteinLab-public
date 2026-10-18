import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('..');
const output=path.join(root,'evidence/runtime/c4/presence');
await fs.mkdir(output,{recursive:true});
const url=process.env.EINSTEIN_TEST_URL || 'http://127.0.0.1:8766/';
const report={url,scope:'Actual candidate service and renderer. Typed questions and visible interface controls; no mocked inference. Not a headset or room-acoustic test.',checks:[],errors:[],httpErrors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
page.on('pageerror',error=>report.errors.push(error.message));
page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({url:response.url(),status:response.status()});});
const check=(name,passed,detail={})=>report.checks.push({name,passed,...detail});
try {
  for(let i=0;i<90;i++){
    try{const response=await context.request.get(url+'api/health');if(response.ok()){report.health=await response.json();break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!report.health)throw new Error('Candidate did not become ready');
  await page.goto(url,{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.__einstein?.stats.avatarReady,{},{timeout:60000});
  check('page_identity',(await page.title())==='Einstein · Mobiliar Lab');
  check('character_loaded',await page.evaluate(()=>window.__einstein.stats.avatarReady));
  check('text_entry_initially_hidden',!(await page.locator('#question').isVisible()));
  await page.screenshot({path:path.join(output,'desktop-idle.png')});
  await page.getByRole('button',{name:'Type a question',exact:true}).click();
  check('question_dialog_opens',await page.locator('#question-dialog').evaluate(element=>element.open));
  await page.locator('#question').fill('What does the GenAI in VR project investigate?');
  await page.getByRole('button',{name:'Send question',exact:true}).click();
  await page.waitForFunction(()=>window.__einstein.stats.lastTurn?.question==='What does the GenAI in VR project investigate?',{},{timeout:45000});
  check('dialog_closed_during_answer',!(await page.locator('#question-dialog').evaluate(element=>element.open)));
  await page.waitForFunction(()=>window.__einstein.stats.audioPlaying,{},{timeout:45000});
  await page.waitForTimeout(600);
  report.answer=await page.evaluate(()=>window.__einstein.stats);
  check('correct_source',report.answer.lastTurn.sources.some(source=>source.includes('genai-in-vr')));
  check('outgoing_phoneme_cues',report.answer.mouthCueCount>10);
  await page.screenshot({path:path.join(output,'desktop-speaking.png')});
  await page.locator('#source-toggle').click();
  check('source_dialog_opens',await page.locator('#evidence-dialog').evaluate(element=>element.open));
  await page.screenshot({path:path.join(output,'source-notes.png')});
  await page.keyboard.press('Escape');
  const start=performance.now();await page.getByRole('button',{name:'Interrupt Albert',exact:true}).click();
  await page.waitForFunction(()=>!window.__einstein.stats.audioPlaying);
  check('playback_interrupt',true,{button_to_silent_ms:Math.round(performance.now()-start)});
  await page.getByRole('button',{name:'Conversation settings',exact:true}).click();
  check('settings_dialog_opens',await page.locator('#settings-dialog').evaluate(element=>element.open));
  await page.locator('#captions').uncheck();check('caption_toggle',await page.evaluate(()=>document.body.classList.contains('captions-off')));
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
  await page.screenshot({path:path.join(output,'mobile.png')});
  check('no_mobile_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check('no_runtime_errors',report.errors.length===0&&report.httpErrors.length===0);
}catch(error){report.failure=error.stack;await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
await browser.close();
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.failure||report.checks.some(item=>!item.passed))process.exitCode=1;
