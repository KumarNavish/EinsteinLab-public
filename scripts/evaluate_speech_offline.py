"""Reproduce the repaired speech path without a server or language-model inference.
The default fixture is deliberately a known retrieval failure. Exit status reflects
whole-pipeline correctness, not just successful transcription or playable speech.
Run: PYTHONPATH=. .einstein-venv/bin/python scripts/evaluate_speech_offline.py
"""
from pathlib import Path
import io,json,time,wave
from lab_backend.runtime import LocalRuntime
from lab_backend.knowledge import Knowledge,evidence_answer

root=Path(__file__).resolve().parent.parent
out=root/'evidence/runtime';out.mkdir(parents=True,exist_ok=True)
fixture=root/'evidence/2026-10-13/microphone-fixture.wav'
if not fixture.is_file():raise SystemExit('The committed synthetic speech fixture is missing')
r=LocalRuntime(root);k=Knowledge.load(root/'lab_backend/data/lab.json')
t=time.perf_counter();question=r.transcribe(fixture.read_bytes());stt_ms=(time.perf_counter()-t)*1000
answer=evidence_answer(question,k.search(question))
t=time.perf_counter();audio=r.synthesize(answer['answer']);tts_ms=(time.perf_counter()-t)*1000
with wave.open(io.BytesIO(audio),'rb') as wav:seconds=wav.getnframes()/wav.getframerate()
result={'scope':'Offline application test. Synthetic input, not a human microphone, HTTP server, or headset test.',
 'fixture_text':'How do large language models affect cognitive load?', 'transcription':question,
 'answer':answer['answer'],'sources':[s['url'] for s in answer['sources']],
 'stt_ms':round(stt_ms,1),'tts_ms':round(tts_ms,1),'reply_seconds':round(seconds,3),
 'mode':answer['mode'],'llm_called':False,
 'passed':bool('cognitive' in question.lower() and any('llms-and-cognitive-load' in s['url'] for s in answer['sources']) and len(audio)>44)}
(out/'offline-speech-regression.json').write_text(json.dumps(result,indent=2))
(out/'offline-speech-reply.wav').write_bytes(audio)
print(json.dumps(result,indent=2))
raise SystemExit(0 if result['passed'] else 1)
