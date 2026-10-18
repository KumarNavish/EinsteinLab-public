import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const origin=process.env.EINSTEIN_TEST_URL||'http://127.0.0.1:8765/';
const output=path.resolve('../.work/waveform-conservation.json');
const report={scope:'Actual browser Web Audio renderer and loaded application SpeechPlayer.schedule. Compare an unchanged waveform with sample-aligned scheduled slices. This is offline DSP evidence, not physical-device or subjective listening evidence. No microphone or model API is used.',
  origin,results:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.goto(origin,{waitUntil:'networkidle',timeout:90000});
  await page.waitForFunction(()=>Boolean(window.__einstein?.player));
  report.results=await page.evaluate(async()=>{
    const Player=window.__einstein.player.constructor;
    const results=[];
    for(const inputRate of [24000,44100]){
      const render=async sliced=>{
        const context=new OfflineAudioContext(1,Math.ceil(12.1*48000),48000);
        const buffer=context.createBuffer(1,inputRate*12,inputRate);
        const data=buffer.getChannelData(0);
        for(let i=0;i<data.length;i++){
          const t=i/inputRate;
          data[i]=.12*Math.sin(2*Math.PI*193*t)+.04*Math.cos(2*Math.PI*431*t)+.015*Math.sin(2*Math.PI*2003*t);
        }
        if(!sliced){
          const source=context.createBufferSource();source.buffer=buffer;
          source.connect(context.destination);source.start(.025);
        }else{
          const player=new Player(null,()=>{},{audioSegments:0});
          player.context=context;player.analyser=context.destination;
          for(let offset=0;offset<12;offset+=4)player.schedule(buffer,[],player.version,false,{offset,duration:4});
        }
        return (await context.startRendering()).getChannelData(0);
      };
      const reference=await render(false),actual=await render(true);
      let peak=0,sumSquares=0;
      for(let i=0;i<reference.length;i++){
        const delta=actual[i]-reference[i];
        peak=Math.max(peak,Math.abs(delta));sumSquares+=delta*delta;
      }
      results.push({inputSampleRate:inputRate,outputSampleRate:48000,comparedSamples:reference.length,
        maxAbsoluteError:peak,rmsError:Math.sqrt(sumSquares/reference.length),passed:peak<.00001});
    }
    return results;
  });
}catch(error){report.failure=error.message;}
finally{await browser.close();}
await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.failure||report.results.length!==2||report.results.some(result=>!result.passed))process.exitCode=1;
