import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('..');const out=path.join(root,'evidence/runtime/c16');
const report={scope:'Actual localhost browser -> feedback API -> private durable local database. Not a public-site or cloud-persistence test.',checks:[],errors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>report.errors.push(error.message));
const check=(name,passed)=>report.checks.push({name,passed});
try{
  let ready=false;
  for(let i=0;i<30;i++){
    try{const r=await page.request.get('http://127.0.0.1:8765/api/health',{timeout:3000});if(r.ok()){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)throw new Error('Application did not become ready');
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'networkidle',timeout:90000});
  await page.waitForFunction(()=>window.__einstein?.stats.avatarReady,{},{timeout:90000});
  check('correct_page',(await page.title())==='Einstein · Mobiliar Lab');
  check('anam_ui_removed',await page.locator('#avatar-engine').count()===0);
  check('original_character_visible',await page.evaluate(()=>window.__einstein.stage.model.visible));
  await page.getByRole('button',{name:'Feedback',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#feedback-send').disabled);
  await page.locator('#feedback-form select[name=rating]').selectOption('4');
  await page.locator('#feedback-form select[name=realism]').selectOption('3');
  await page.locator('#feedback-form select[name=voice]').selectOption('4');
  await page.locator('#feedback-form select[name=kind]').selectOption('bug');
  report.testMarker='C16 automated feedback verification '+crypto.randomUUID();
  await page.locator('#feedback-message').fill(report.testMarker);
  await page.locator('#feedback-context').fill('Engineering test entry. The neck-stability regression was exercised; this is not a human quality rating.');
  await page.locator('#feedback-send').click();
  await page.waitForFunction(()=>Boolean(document.querySelector('#feedback-result').dataset.receipt));
  report.receipt=await page.locator('#feedback-result').getAttribute('data-receipt');
  check('server_confirmed_submission',Boolean(report.receipt));
  check('success_message_is_visible',await page.locator('#feedback-result').innerText()==='Your feedback was saved privately. Thank you.');
  const noRead=await page.request.get('http://127.0.0.1:8765/api/feedback');
  check('no_public_feedback_listing',[403,404,405].includes(noRead.status()));
  check('microphone_not_opened',await page.evaluate(()=>!window.__einstein.stats.microphoneActive));
  await page.screenshot({path:path.join(out,'feedback-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  check('mobile_no_horizontal_overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(out,'feedback-mobile.png')});
  await page.getByRole('button',{name:'Close feedback',exact:true}).click();
  check('dialog_closes',await page.locator('#feedback-dialog').evaluate(element=>!element.open));
  check('console_clean',report.errors.length===0);
}catch(error){report.failure=error.message;await page.screenshot({path:path.join(out,'feedback-failure.png')}).catch(()=>{});}
await browser.close();await fs.writeFile(path.join(out,'feedback-browser.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.failure||report.checks.some(item=>!item.passed))process.exitCode=1;
