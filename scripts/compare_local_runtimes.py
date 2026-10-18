"""Matched local application comparisons. No browser, service, API, or agent runner.
Results are a designed diagnostic suite, not a holdout or general factual score.
"""
from pathlib import Path
import gc,json,time,hashlib,wave
import numpy as np
root=Path(__file__).resolve().parent.parent;out=root/'evidence/runtime/c2';out.mkdir(parents=True,exist_ok=True)
import onnxruntime as ort
from kokoro_onnx import Kokoro
text='The project is testing whether tailored virtual environments can improve relaxation.'
voice_rows=[]
for variant in ['kokoro-v1.0.onnx','kokoro-v1.0.int8.onnx']:
 options=ort.SessionOptions();options.intra_op_num_threads=3;options.inter_op_num_threads=1
 p=root/'.local-models/kokoro'/variant;t=time.perf_counter()
 session=ort.InferenceSession(str(p),sess_options=options,providers=['CPUExecutionProvider'])
 model=Kokoro.from_session(session,str(root/'.local-models/kokoro/voices-v1.0.bin'));load_s=time.perf_counter()-t
 timings=[]
 for i in range(3):
  t=time.perf_counter();audio,rate,cues=model.create_timed(text,'bm_george',speed=.96,lang='en-gb');seconds=time.perf_counter()-t
  timings.append(round(seconds,3))
  if i==2:
   with wave.open(str(out/(variant+'.wav')),'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes((np.clip(audio,-1,1)*32767).astype('<i2').tobytes())
 row={'variant':variant,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'load_s':round(load_s,3),'generation_s':timings,'audio_s':round(len(audio)/rate,3),'phoneme_count':len(cues),'all_finite':bool(np.isfinite(audio).all())}
 voice_rows.append(row);print('VOICE',json.dumps(row),flush=True)
 del model,session;gc.collect()
(out/'matched-voice-comparison.json').write_text(json.dumps({'text':text,'voice':'bm_george','threads':3,'scope':'Sequential CPU runs, same text and voice, no app/browser running. System-wide background workload was not controlled. First synthesis is cold, subsequent two warm.','results':voice_rows},indent=2))
from lab_backend.runtime import LocalRuntime
from lab_backend.knowledge import Knowledge
import mlx.core as mx
k=Knowledge.load(root/'lab_backend/data/lab.json')
cases=[('What does the GenAI in VR project investigate?','genai-in-vr'),('How do LLMs affect cognitive load?','llms-and-cognitive-load'),('What does the lab investigate about delegating decisions to agentic AI?','delegating-to-agentic-ai')]
rows=[]
for model_name in ['qwen3-1.7b','qwen3-4b']:
 runtime=LocalRuntime(root);runtime.llm_path=root/'.local-models'/model_name
 t=time.perf_counter();runtime.ensure_llm();load_s=time.perf_counter()-t
 for question,expected in cases:
  sources=k.search(question);t=time.perf_counter();result=runtime.answer(question,sources,[]);elapsed=time.perf_counter()-t
  row={'model':model_name,'load_s':round(load_s,3),'question':question,'seconds':round(elapsed,3),'answer':result['answer'],'mode':result['mode'],'sources':[s['url'] for s in result['sources']],'generation_rejected':result.get('generation_rejected'),'tokens':result.get('generation_tokens'),'expected_source_present':any(expected in s['url'] for s in result['sources'])}
  rows.append(row);print('LANGUAGE',json.dumps(row),flush=True)
  (out/'matched-language-comparison.json').write_text(json.dumps({'scope':'Same local runtime/prompt/unchanged retrieval, three designed questions per model, sequential runs with no app/browser. No semantic accuracy claim or representative benchmark.','results':rows},indent=2))
 del runtime;gc.collect();mx.clear_cache()
print('MATCHED_COMPARISON_COMPLETE',flush=True)
