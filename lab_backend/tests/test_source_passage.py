import hashlib
import pytest
from lab_backend.source_passage import source_passage, focus_passage
from lab_backend.visual_tools import VisualSession
SOURCE={'id':'source-actual','title':'Project','url':'https://mobililab.ethz.ch/?research-proj-posts=example','fetched_at':'2026-10-14T00:00:00Z','excerpt':'Expected results\nWe are testing whether tailored explanations may reduce cognitive load. No demonstrated improvement is stated here.'}

def test_exact_source_characters_and_indices():
    quote='may reduce cognitive load'
    p=source_passage(SOURCE,quote)
    assert p['text']==SOURCE['excerpt']
    assert p['text'][slice(*p['quote_range'])]==quote
    assert p['displayed_text_sha256']==hashlib.sha256(SOURCE['excerpt'].encode()).hexdigest()

def test_long_excerpt_preserves_offsets_and_explicit_omissions():
    text=('Earlier detail. '*180)+'UNIQUE SOURCE PHRASE'+('Later detail. '*180)
    p=source_passage({**SOURCE,'excerpt':text},'UNIQUE SOURCE PHRASE')
    assert p['omitted_before'] and p['omitted_after']
    assert text[slice(*p['source_range'])]==p['text']
    assert p['text'][slice(*p['quote_range'])]=='UNIQUE SOURCE PHRASE'

@pytest.mark.parametrize('quote',['proven improvement','MAY reduce cognitive load'])
def test_not_verbatim_is_rejected(quote):
    with pytest.raises(ValueError):source_passage(SOURCE,quote)

def test_focus_does_not_change_original_text_or_hash():
    p=source_passage(SOURCE)
    focused=focus_passage(p,'Expected results')
    assert focused['text']==p['text'] and focused['displayed_text_sha256']==p['displayed_text_sha256']
    with pytest.raises(ValueError):focus_passage(p,'expected results')

def test_source_display_is_ledger_scoped_and_transactional():
    session=VisualSession()
    with pytest.raises(ValueError):session.propose('show_source_passage',{'source_id':'invented'}, {SOURCE['id']:SOURCE})
    action=session.propose('show_source_passage',{'source_id':SOURCE['id'],'quote':'may reduce cognitive load'}, {SOURCE['id']:SOURCE})
    p=action['passage']
    assert session.passage is None
    receipt={'revision':action['revision'],'status':'source-displayed','rendered_elements':1,'displayed_text_sha256':p['displayed_text_sha256'],'highlighted_quote':p['quote']}
    with pytest.raises(ValueError):session.acknowledge(action['action_id'],{**receipt,'highlighted_quote':'a paraphrase'})
    result=session.acknowledge(action['action_id'],receipt)
    assert result['passage']==p and session.graph is None
    a=session.propose('focus_source_phrase',{'quote':'Expected results'}, {})
    result=session.acknowledge(a['action_id'],{'revision':a['revision'],'status':'phrase-focused','rendered_elements':1,'displayed_text_sha256':p['displayed_text_sha256'],'highlighted_quote':'Expected results'})
    assert result['passage']['text']==SOURCE['excerpt']
    assert result['passage']['quote_range']==[0,16]

def test_source_card_cannot_be_mistaken_for_a_conceptual_graph():
    s=VisualSession();a=s.propose('show_source_passage',{'source_id':SOURCE['id']},{SOURCE['id']:SOURCE});p=a['passage']
    s.acknowledge(a['action_id'],{'revision':a['revision'],'status':'source-displayed','rendered_elements':1,'displayed_text_sha256':p['displayed_text_sha256'],'highlighted_quote':''})
    with pytest.raises(ValueError):s.propose('focus_visual',{'element_id':'node'}, {})
    a=s.propose('hide_visual',{},{});s.acknowledge(a['action_id'],{'revision':a['revision'],'status':'hidden','rendered_elements':0})
    assert s.passage is None
