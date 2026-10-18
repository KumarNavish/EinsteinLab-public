"""Matched application-generation checks; model selection is not an accuracy claim."""
from pathlib import Path
import json,time,gc
import mlx.core as mx
import mlx_lm
from lab_backend.runtime import LocalRuntime
from lab_backend.knowledge import Knowledge
root=Path(__file__).resolve().parent.parent;out=root/'evidence/runtime/c2';out.mkdir(parents=True,exist_ok=True)
k=Knowledge.load(root/'lab_backend/data/lab.json')
cases=[
 {'question':'What does the GenAI in VR project investigate?','source':'genai-in-vr'},
 {'question':'How do LLMs affect cognitive load?','source':'llms-and-cognitive-load'},
 {'question':'What does the lab investigate about delegating decisions to agentic AI?','source':'delegating-to-agentic-ai'},
 {'question':'Who leads the GenAI in VR project?','source':'genai-in-vr'},
 {'question':'Can you explain that in simpler terms?','source':'genai-in-vr','previous':'What does the GenAI in VR project investigate?'}]
rows=[];original=mlx_lm.stream_generate;metrics={}
def observed(*args,**kwargs):
 for token in original(*args,**kwargs):
  for key in ['prompt_tokens','prompt_tps','generation_tokens','generation_tps','peak_memory','finish_reason']:
   value=getattr(token,key,None)
   if isinstance(value,(str,int,float)) or value is None:metrics[key]=value
  yield token
mlx_lm.stream_generate=observed
for name in ['qwen2.5-1.5b','qwen3-4b']:
 runtime=LocalRuntime(root);runtime.llm_path=root/'.local-models'/name
 started=time.perf_counter();runtime.ensure_llm();load_s=time.perf_counter()-started
 previous_answer='The project uses spoken descriptions to personalize a virtual environment and is testing possible wellness benefits.'
 for case in cases:
  question=case['question'];sources=k.search(question,case.get('previous',''))
  history=[{'question':case['previous'],'answer':previous_answer}] if case.get('previous') else []
  metrics.clear();started=time.perf_counter();result=runtime.answer(question,sources,history)
  passed=result['mode']=='local-synthesis' and any(case['source'] in source['url'] for source in result['sources'])
  row={'model':name,'load_s':round(load_s,3),'question':question,'generation_s':round(time.perf_counter()-started,3),
       'answer':result['answer'],'mode':result['mode'],'sources':[source['url'] for source in result['sources']],
       'generation_rejected':result.get('generation_rejected'),'passed_structural_source_gate':passed,'runtime_metrics':dict(metrics)}
  rows.append(row);print(json.dumps(row),flush=True)
  report={'scope':'Five matched designed application questions per candidate, same current prompt/guard/unchanged retrieval. Serial runs with the app stopped. Source-presence plus generation gates are not a general factual-accuracy score. Semantic review remains necessary. System-wide unrelated workload was not controlled.','cases':cases,'results':rows}
  (out/'final-instruct-comparison.json').write_text(json.dumps(report,indent=2))
 del runtime;gc.collect();mx.clear_cache()
print('COMPARISON_COMPLETE',flush=True)
