"""Exercise real multi-turn generation and streaming without a rendering workload.

This is a small designed integration check, not a retrieval benchmark or holdout.
It preserves exact answers so an evaluator can inspect whether findings are overstated.
"""
from pathlib import Path
import json,time,uuid
import httpx
root=Path(__file__).resolve().parent.parent
out=root/'evidence/runtime/c2';out.mkdir(parents=True,exist_ok=True)
client=httpx.Client(base_url='http://127.0.0.1:8765',timeout=120,trust_env=False)
health=client.get('/api/health');health.raise_for_status()
rows=[]
for repetition in range(2):
 session=uuid.uuid4().hex
 for turn,question in enumerate(['What does the GenAI in VR project investigate?','Can you explain that in simpler terms?','Have improved relaxation outcomes already been demonstrated?']):
  payload={'session_id':session,'request_id':uuid.uuid4().hex,'question':question,'speak':turn==0,'voice_mode':'expressive'}
  began=time.perf_counter();events=[]
  with client.stream('POST','/api/turn/stream',json=payload) as response:
   response.raise_for_status()
   for line in response.iter_lines():
    if not line:continue
    event=json.loads(line)
    event['observed_ms']=round((time.perf_counter()-began)*1000,1)
    if event.get('audio_base64'):
     import base64
     event['audio_bytes']=len(base64.b64decode(event.pop('audio_base64')))
    events.append(event)
  answer=next((event for event in events if event['event']=='answer'),None)
  row={'repetition':repetition,'turn':turn,'question':question,'answer':answer,'events':events,
       'complete':bool(any(e['event']=='done' for e in events) and answer),
       'server_error':next((event for event in events if event['event']=='error'),None)}
  rows.append(row)
  (out/'conversation-repeatability.json').write_text(json.dumps({'scope':'Two independent three-turn sequences against the live local service, no headless browser or recording running. Voice may hit an in-memory cache after the first occurrence; no unqualified speedup claim. Exact source-groundedness still requires semantic review.','results':rows},indent=2))
  print(json.dumps({'repetition':repetition,'question':question,'mode':answer.get('mode') if answer else None,'answer':answer.get('answer') if answer else None,'complete':row['complete'],'first_audio_observed_ms':next((e['observed_ms'] for e in events if e['event']=='audio'),None),'total_ms':round((time.perf_counter()-began)*1000,1)}),flush=True)
print('CONVERSATION_CHECK_FINISHED',flush=True)
if any(not row['complete'] for row in rows):raise SystemExit(1)
