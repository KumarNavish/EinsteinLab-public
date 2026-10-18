"""Measured recovery of the C3 candidate. Development data, not a holdout."""
from pathlib import Path
import json,time,gc,os
from lab_backend.atlas import Atlas
from lab_backend.knowledge import Knowledge
from lab_backend.narrator import Narrator
root=Path(__file__).resolve().parent.parent;out=root/os.getenv('EINSTEIN_EVAL_DIR','evidence/runtime/c4');out.mkdir(parents=True,exist_ok=True)
path=root/'lab_backend/data/lab.json';started=time.perf_counter();atlas=Atlas.load(path,root);legacy=Knowledge.load(path)
print('INDEX_READY',len(atlas.chunks),round(time.perf_counter()-started,3),flush=True)
cases=json.loads((root/'benchmarks/presence_cases.json').read_text())['cases'];retrieval=[]
for case in cases:
 row={**case}
 for label,engine in [('legacy',legacy),('semantic',atlas)]:
  t=time.perf_counter();sources=engine.search(case['question']);titles=[s['title'] for s in sources]
  row[label]={'ms':round((time.perf_counter()-t)*1000,2),'titles':titles,'top_page_pass':bool(titles and titles[0]==case['expected_title'])}
 retrieval.append(row)
 if not row['semantic']['top_page_pass']:print('SOURCE_MISS',json.dumps(row),flush=True)
(out/'retrieval-recovery.json').write_text(json.dumps({'scope':'Previously frozen 16-case development source selection, not independent accuracy evidence. Same snapshot for both methods.','results':retrieval},indent=2))
runtime=Narrator(root);runtime.ensure_llm();rows=[]
for case in cases:
 q=case['question'];s=atlas.search(q);t=time.perf_counter();r=runtime.answer(q,s,[])
 row={**case,'seconds':round(time.perf_counter()-t,3),'answer':r['answer'],'mode':r['mode'],'sources':r['sources'],'rejection':r.get('generation_rejected'),'semantic_check':r.get('semantic_check'),'metrics':r.get('runtime_metrics')}
 rows.append(row);print('ANSWER',json.dumps({k:v for k,v in row.items() if k!='sources'},ensure_ascii=False),flush=True)
 (out/'narrator-recovery.json').write_text(json.dumps({'scope':'16 designed local Q&A examples; all outputs and rejected generations retained. Source and semantic filters are not a correctness proof.','results':rows},ensure_ascii=False,indent=2))
assert all(p['excerpt']==next(page['text'] for page in atlas.pages if page['url']==p['url'])[p['start']:p['end']] for p in atlas.chunks)
print('SOURCE_OFFSETS_VERIFIED',len(atlas.chunks),flush=True)
print('DONE',sum(r['semantic']['top_page_pass'] for r in retrieval),len(retrieval),flush=True)
