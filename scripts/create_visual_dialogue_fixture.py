"""Prepare a synthetic three-question microphone track; no microphone is accessed."""
from pathlib import Path
import io,json,wave,hashlib,sys
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from lab_backend.runtime import LocalRuntime
out=ROOT/'evidence/runtime/c11/spoken-fixture';out.mkdir(parents=True,exist_ok=True)
target=out/'questions.wav';meta=out/'questions.json'
if target.exists() or meta.exists():
    if not target.is_file() or not meta.is_file():raise SystemExit('Incomplete existing fixture; reconcile rather than overwrite.')
    saved=json.loads(meta.read_text())
    if hashlib.sha256(target.read_bytes()).hexdigest()!=saved['sha256']:raise SystemExit('Existing fixture hash mismatch')
    print('EXISTING_SYNTHETIC_FIXTURE_VERIFIED');raise SystemExit(0)
questions=[
    ('Please check the Mobiliar Lab project about language models and cognitive load, then sketch a simple conceptual mechanism. Show the uncertain causal links as hypotheses.',35),
    ('Please highlight the part representing the person in your diagram, and explain why it matters.',25),
    ('Thank you. Put the whiteboard away now, please.',90)]
runtime=LocalRuntime(ROOT);parts=[];records=[];elapsed=2;fmt=None
for question,gap in questions:
    audio=runtime.synthesize(question)
    with wave.open(io.BytesIO(audio),'rb') as w:
        params=(w.getnchannels(),w.getsampwidth(),w.getframerate());frames=w.readframes(w.getnframes());seconds=w.getnframes()/w.getframerate()
    if fmt is not None and params!=fmt:raise SystemExit('Inconsistent fixture audio format')
    fmt=params;records.append({'question':question,'speech_start_s':elapsed,'speech_duration_s':seconds,'following_silence_s':gap});parts.extend([frames,bytes(gap*fmt[0]*fmt[1]*fmt[2])]);elapsed+=seconds+gap
with wave.open(str(target),'wb') as w:
    w.setnchannels(fmt[0]);w.setsampwidth(fmt[1]);w.setframerate(fmt[2]);w.writeframes(bytes(2*fmt[0]*fmt[1]*fmt[2])+b''.join(parts))
record={'scope':'Locally generated synthetic questions for an isolated browser microphone test. No human speech was captured. These questions are not prepared assistant answers.','questions':records,'duration_s':elapsed,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
meta.write_text(json.dumps(record,indent=2));print(json.dumps(record,indent=2))
