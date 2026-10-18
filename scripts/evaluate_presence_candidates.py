"""Matched current-pipeline versus candidate checks on a new designed scenario set.
Not a holdout, subjective voice score, or claim of general factual accuracy.
"""
from pathlib import Path
import gc,hashlib,json,time
ROOT=Path(__file__).resolve().parent.parent
import sys
sys.path.insert(0,str(ROOT))
from lab_backend.atlas import Atlas
from lab_backend.knowledge import Knowledge
from lab_backend.narrator import Narrator
import mlx.core as mx
OUT=ROOT/'evidence/runtime/c3';OUT.mkdir(parents=True,exist_ok=True)
CASES=[
 ('What connects the work being done across this lab?', 'Front Page'),
 ('Tell me about using language models when a customer is mentally overloaded.', 'LLMs & Cognitive Load'),
 ('Why would somebody let an autonomous system choose their insurance?', 'Delegating to Agentic AI'),
 ('Can a person create a virtual scene by describing it aloud?', 'GenAI in VR'),
 ('Which researcher leads GenAI in VR?', 'GenAI in VR'),
 ('What does the website say about the scientific director?', 'About Us'),
 ('How is neck muscle activity used in relaxation exercises?', 'EMG for Relaxation'),
 ('What is being learned from brain signals during emotional interactions?', 'Neuromarkers for Emotion'),
 ('Is personalised neurofeedback connected to virtual reality?', 'Neurofeedback for Relaxation'),
 ('What did the study of young drivers and telematics actually find?', 'Telematics for Road Safety'),
 ('Explain augmented reality as a tool for learning data science together.', 'AR for Collaboration'),
 ('What constraints affect language-model recommendations for small businesses?', 'LLMs for SMEs'),
 ('What did the AI for Trust project learn about decision support?', 'AI for Trust'),
 ('How are transformers and appraisal theory used to recognise emotions?', 'Transformers for Emotion Recognition'),
 ('What is the project involving robots and physiological feedback?', 'Human Robot Interaction'),
 ('What has VR for Relaxation reported?', 'VR for Relaxation'),
]
fixture=ROOT/'benchmarks/presence_cases.json'
if not fixture.exists():fixture.write_text(json.dumps({'scope':__doc__,'cases':[{'question':q,'expected_title':title} for q,title in CASES]},indent=2))
started=time.perf_counter();atlas=Atlas.load(ROOT/'lab_backend/data/lab.json',ROOT);build_s=time.perf_counter()-started
legacy=Knowledge.load(ROOT/'lab_backend/data/lab.json');retrieval=[]
for q,title in CASES:
 row={'question':q,'expected_title':title}
 for name,index in [('legacy',legacy),('semantic',atlas)]:
  t=time.perf_counter();result=index.search(q);row[name]={'ms':round((time.perf_counter()-t)*1000,2),'titles':[s['title'] for s in result],'top_page_pass':bool(result and result[0]['title']==title),'in_context':any(s['title']==title for s in result)}
 retrieval.append(row)
(OUT/'semantic-comparison.json').write_text(json.dumps({'scope':__doc__,'build_s':build_s,'paragraphs':len(atlas.chunks),'index_signature':atlas.signature,'results':retrieval},indent=2))
print('RETRIEVAL',json.dumps({'build_s':build_s,'paragraphs':len(atlas.chunks),'legacy_top':sum(r['legacy']['top_page_pass'] for r in retrieval),'semantic_top':sum(r['semantic']['top_page_pass'] for r in retrieval),'n':len(retrieval)}),flush=True)
for row in retrieval:
 if not row['semantic']['top_page_pass']:print('RETRIEVAL_MISS',json.dumps(row),flush=True)
rows=[]
for model in ['qwen2.5-1.5b','qwen3-4b']:
 narrator=Narrator(ROOT,str(ROOT/'.local-models'/model));narrator.ensure_llm()
 for q,title in CASES[:6]:
  sources=atlas.search(q);t=time.perf_counter();result=narrator.answer(q,sources,[])
  row={'model':model,'question':q,'expected_title':title,'seconds':round(time.perf_counter()-t,3),'answer':result['answer'],'mode':result['mode'],'titles':[s['title'] for s in result['sources']],'rejection':result.get('generation_rejected'),'metrics':result.get('runtime_metrics')}
  rows.append(row);print('GENERATION',json.dumps(row),flush=True)
  (OUT/'narrator-comparison.json').write_text(json.dumps({'scope':__doc__,'results':rows},indent=2))
 del narrator;gc.collect();mx.clear_cache()
# Every returned source quote must still be a byte-for-byte substring of its page.
pages={p['url']:p for p in atlas.pages}
for p in atlas.chunks:assert pages[p['url']]['text'][p['start']:p['end']]==p['excerpt'],p['id']
print('SOURCE_OFFSETS_VERIFIED',len(atlas.chunks),flush=True)
