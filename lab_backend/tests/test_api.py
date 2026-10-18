import base64, json
from fastapi.testclient import TestClient
from lab_backend import app as module
from lab_backend.knowledge import Knowledge
from .test_knowledge import SNAP

def client():
    module.knowledge=Knowledge(SNAP)
    module.runtime.llm_path=module.ROOT/".nonexistent-llm"
    module.runtime.voice_path=module.ROOT/".nonexistent-voice"
    return TestClient(module.app)

def payload(**kw):
    return dict(session_id="test-session",request_id="request-0001",question="cognitive load",speak=False,**kw)

def test_health_explicit():
    j=client().get('/api/health').json()
    assert not j['paid_services_enabled'] and j['pages']==3

def test_turn_evidence_and_idempotency():
    c=client(); p=payload(); a=c.post('/api/turn',json=p); assert a.status_code==200
    b=c.post('/api/turn',json=p); assert a.json()==b.json()
    assert a.json()['sources'] and a.json()['additional_api_cost_usd']==0

def test_bad_audio():
    c=client(); p=payload(audio_base64="not base64"); p['request_id']='request-bad0'
    assert c.post('/api/turn',json=p).status_code==400

def test_cross_origin_refused():
    assert client().post('/api/turn',json=payload(),headers={'Origin':'https://malicious.test'}).status_code==403

def test_length_bounds():
    p=payload(); p['question']='x'*701
    assert client().post('/api/turn',json=p).status_code==422

def test_cancel_epoch():
    c=client(); before=module.session_epochs.get('test-session',0)
    assert c.post('/api/cancel',json={'session_id':'test-session'}).status_code==200
    assert module.session_epochs['test-session']==before+1


def test_late_cancel_does_not_invalidate_newer_turn():
    c=client(); module.active_requests['cancel-session']='new-turn-0001'
    before=module.session_epochs.get('cancel-session',0)
    r=c.post('/api/cancel',json={'session_id':'cancel-session','request_id':'old-turn-0001'})
    assert r.status_code==200 and not r.json()['cancelled']
    assert module.session_epochs.get('cancel-session',0)==before
    module.active_requests.pop('cancel-session')
