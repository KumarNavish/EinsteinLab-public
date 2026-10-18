import base64
import av
import numpy as np
import pytest
from lab_backend.visual_tools import VisualSession, visual_declarations

def graph():
    return {'title':'A conceptual intervention','nodes':[{'id':'x','label':'Cause','x':.25,'y':.5},{'id':'y','label':'Response','x':.75,'y':.5}], 'edges':[{'from':'x','to':'y','kind':'causal-hypothesis'}]}

def ready():
    session=VisualSession();action=session.propose('sketch_mechanism',graph(),{})
    session.acknowledge(action['action_id'],{'revision':action['revision'],'status':'displayed','rendered_elements':3})
    return session

def jpeg():
    codec=av.CodecContext.create('mjpeg','w');codec.width=128;codec.height=100;codec.pix_fmt='yuvj420p'
    frame=av.VideoFrame.from_ndarray(np.full((100,128,3),235,dtype=np.uint8),format='rgb24')
    data=b''.join(bytes(p) for p in codec.encode(frame))+b''.join(bytes(p) for p in codec.encode(None))
    return {'mime_type':'image/jpeg','width':128,'height':100,'data':base64.b64encode(data).decode()}

def test_inspection_returns_real_pixels_without_replacing_graph():
    session=ready();old=session.graph
    action=session.propose('inspect_visual',{},{});image=jpeg()
    result=session.acknowledge(action['action_id'],{'revision':action['revision'],'status':'inspected','rendered_elements':3,'image':image})
    assert result['status']=='inspected' and session.graph is old
    assert result['_render_image']['sha256'] and result['inspection_scope'].startswith('Only the actual')
    with pytest.raises(ValueError):session.acknowledge(action['action_id'],{'revision':action['revision'],'status':'inspected','rendered_elements':3,'image':image})

def test_inspection_requires_visible_graph():
    with pytest.raises(ValueError):VisualSession().propose('inspect_visual',{}, {})

@pytest.mark.parametrize('change',[{'image':None},{'rendered_elements':2},{'image':{'mime_type':'image/jpeg','width':128,'height':100,'data':base64.b64encode(b'\xff\xd8\xffbad\xff\xd9').decode()}}])
def test_missing_fake_and_incomplete_inspections_are_not_accepted(change):
    session=ready();a=session.propose('inspect_visual',{}, {})
    receipt={'revision':a['revision'],'status':'inspected','rendered_elements':3,'image':jpeg(),**change}
    with pytest.raises(ValueError):session.acknowledge(a['action_id'],receipt)
    assert a['action_id'] in session.pending

def test_inspection_is_explicitly_not_a_general_source_reader():
    declaration=next(d for d in visual_declarations() if d['name']=='inspect_visual')
    assert 'no browser tab, video, paper or computer file' in declaration['description']
