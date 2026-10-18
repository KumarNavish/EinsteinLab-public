import json
from pathlib import Path
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from lab_backend.feedback import FeedbackStore, feedback_router


def body(store, remote='visitor-a', **changes):
    return {'request_id':str(uuid4()),'permit':store.permit(remote),'rating':4,
            'realism':3,'voice':5,'kind':'bug','message':'The neck rotated unexpectedly.',
            'context':'Speaking while a diagram was open.','website':'',**changes}


def test_private_feedback_persists_across_new_store(tmp_path):
    path=tmp_path/'private/feedback.sqlite3';store=FeedbackStore(path)
    submitted=body(store);result=store.submit(submitted,'visitor-a')
    rows=FeedbackStore(path).read()
    assert result['received'] and len(rows)==1 and rows[0]['rating']==4
    assert rows[0]['message']==submitted['message']
    assert path.stat().st_mode & 0o777 == 0o600
    assert path.parent.stat().st_mode & 0o777 == 0o700
    assert 'permit' not in json.dumps(rows) and 'visitor-a' not in json.dumps(rows)


def test_repeated_submission_is_idempotent_and_conflicting_write_rejected(tmp_path):
    store=FeedbackStore(tmp_path/'feedback.db');entry=body(store)
    first=store.submit(entry,'visitor-a');second=store.submit(entry,'visitor-a')
    assert first['id']==second['id'] and second['duplicate']
    assert len(store.read())==1
    with pytest.raises(ValueError):store.submit({**entry,'rating':1},'visitor-a')


@pytest.mark.parametrize('changes',[{'rating':True},{'rating':0},{'rating':6},{'kind':'sql'},
    {'message':'x'*2001},{'context':'x'*1001},{'unexpected':'value'},{'request_id':'bad'}])
def test_bad_fields_do_not_write(tmp_path, changes):
    store=FeedbackStore(tmp_path/'feedback.db')
    with pytest.raises(ValueError):store.submit(body(store,**changes),'visitor-a')
    assert not store.read()


def test_token_bound_to_visitor_and_expiry(tmp_path):
    clock=[1000.];store=FeedbackStore(tmp_path/'feedback.db',clock=lambda:clock[0]);entry=body(store)
    with pytest.raises(ValueError):store.submit(entry,'visitor-b')
    clock[0]+=901
    with pytest.raises(ValueError):store.submit(entry,'visitor-a')
    assert not store.read()


def test_rate_and_total_budgets(tmp_path):
    clock=[1000.];store=FeedbackStore(tmp_path/'feedback.db',clock=lambda:clock[0],daily_limit=2)
    store.submit(body(store),'visitor-a')
    with pytest.raises(ValueError):store.submit(body(store),'visitor-a')
    store.submit(body(store,'visitor-b'),'visitor-b')
    with pytest.raises(ValueError):store.submit(body(store,'visitor-c'),'visitor-c')
    clock[0]+=86401
    store.submit(body(store,'visitor-c'),'visitor-c')
    assert len(store.read())==3


def test_honeypot_is_not_retained(tmp_path):
    store=FeedbackStore(tmp_path/'feedback.db');entry=body(store,website='spam.example')
    assert store.submit(entry,'visitor-a')['received']
    assert not store.read()


def test_sql_like_text_remains_inert(tmp_path):
    store=FeedbackStore(tmp_path/'feedback.db');text="'); DROP TABLE feedback;--"
    store.submit(body(store,message=text),'visitor-a')
    assert store.read()[0]['message']==text


def test_parallel_entries_remain_separate(tmp_path):
    store=FeedbackStore(tmp_path/'feedback.db')
    pairs=[(f'visitor-{i}',body(store,f'visitor-{i}',message=f'Entry {i}')) for i in range(12)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda pair:store.submit(pair[1],pair[0]),pairs))
    assert len(store.read())==12 and len({row['id'] for row in store.read()})==12


def test_http_same_origin_and_no_public_feedback_read(tmp_path):
    app=FastAPI();router,store=feedback_router(tmp_path);app.include_router(router);client=TestClient(app)
    assert client.get('/api/feedback/permit',headers={'Origin':'https://attacker.test'}).status_code==403
    token=client.get('/api/feedback/permit').json()['permit']
    payload={'request_id':str(uuid4()),'permit':token,'rating':5,'kind':'impression','message':'Test only','context':''}
    response=client.post('/api/feedback',json=payload)
    assert response.status_code==200 and response.json()['received']
    assert len(store.read())==1
    assert client.get('/api/feedback').status_code==405
    assert client.get('/api/feedback/admin').status_code==404
