// Provider-free feasibility experiment. Oracle origin labels are deliberately
// absent from the observations available to the shipped Live audio handler.
import assert from 'node:assert/strict';
const frameMs=20,thresholds=[200,400,700];
const observed=Array.from({length:101},(_,i)=>({at:i*frameMs,signal:i>=15&&i<40}));
const worlds=[{name:'delayed-old-then-fresh',origin:p=>p.at>=300&&p.at<500?'old':p.signal?'fresh':'silence'},
  {name:'fresh-from-first-syllable',origin:p=>p.signal?'fresh':'silence'}];
assert.deepEqual(worlds.map(()=>observed)[0],worlds.map(()=>observed)[1]);
const experiments=thresholds.flatMap(quietMs=>{
  // A continuously arriving packet prevents a no-delta quiet gate reopening.
  let lastPacket=0,opened=false;const packetAccepted=[];
  for(const packet of observed){if(packet.at-lastPacket>=quietMs)opened=true;if(opened)packetAccepted.push(packet);lastPacket=packet.at;}
  // Energy quiet can reopen before an old audible tail: its identity is absent.
  let lastSignal=0,energyOpen=false;const energyAccepted=[];
  for(const packet of observed){if(packet.at-lastSignal>=quietMs)energyOpen=true;if(energyOpen)energyAccepted.push(packet);if(packet.signal)lastSignal=packet.at;}
  return worlds.map(world=>({quietMs,world:world.name,
    noDelta:{acceptedSignalFrames:packetAccepted.filter(p=>p.signal).length,droppedFreshSignalFrames:observed.filter(p=>world.origin(p)==='fresh'&&!packetAccepted.includes(p)).length},
    energyQuiet:{acceptedOldSignalFrames:energyAccepted.filter(p=>world.origin(p)==='old').length,droppedFreshSignalFrames:observed.filter(p=>world.origin(p)==='fresh'&&!energyAccepted.includes(p)).length}}));
});
assert(experiments.every(row=>row.noDelta.acceptedSignalFrames===0));
assert(experiments.some(row=>row.energyQuiet.acceptedOldSignalFrames>0));
assert(experiments.some(row=>row.energyQuiet.droppedFreshSignalFrames>0));
const result={kind:'offline-synthetic-feasibility-not-live-latency-or-audibility',frameMs,observedPackets:observed.length,
  observationFields:['at','signal'],oracleOriginAvailableToApp:false,identicalObservableTracesHaveDifferentOrigins:true,
  decision:'Reject a default local quiet gate: continuous silence can prevent reopening; energy quiet cannot establish answer ownership and can discard fresh speech.',
  shippedAlternative:'Retain immediate local queue cancellation and source/tool revision guards; expose unverified continuous audio attribution in diagnostics. Written mode uses explicit accepted input IDs, cancellable backend epochs and actual Responses completion.',
  experiments,limits:['Synthetic schedules demonstrate a counterexample, not its observed frequency.','No exact audible word timing, provider completion or zero-stale-voice claim.','No provider call, credential, microphone, quota or spending change.']};
console.log(JSON.stringify(result,null,2));
