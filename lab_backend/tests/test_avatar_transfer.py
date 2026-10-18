"""Synthetic binary fixtures for lossless avatar delivery, not a realism benchmark."""
import copy
import importlib.util
import io
from pathlib import Path
import struct
from PIL import Image
import pytest

SPEC=importlib.util.spec_from_file_location('avatar_transfer',Path(__file__).resolve().parents[2]/'scripts/optimize_avatar_transfer.py')
module=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(module)


def fixture(profile=False):
    image=Image.new('RGBA',(256,256))
    image.putdata([(x%256,y%256,(x+y)%256,0 if x%3==0 else 255) for y in range(256) for x in range(256)])
    encoded=io.BytesIO();image.save(encoded,format='PNG',compress_level=0,**({'icc_profile':b'profile-requires-review'} if profile else {}))
    vertices=struct.pack('<fff',1.25,-2.0,.75)
    binary=vertices+encoded.getvalue()
    doc={'asset':{'version':'2.0'},'buffers':[{'byteLength':len(binary)}],
         'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(vertices)},
                        {'buffer':0,'byteOffset':len(vertices),'byteLength':len(encoded.getvalue())}],
         'accessors':[{'bufferView':0,'componentType':5126,'count':1,'type':'VEC3'}],
         'images':[{'bufferView':1,'mimeType':'image/png','name':'existing source pixels'}],
         'textures':[{'source':0,'sampler':0}], 'samplers':[{}],
         'nodes':[{'name':'original_head','rotation':[0,0,0,1]}],
         'materials':[{'pbrMetallicRoughness':{'baseColorTexture':{'index':0}}}],
         'meshes':[],'skins':[],'animations':[]}
    return module.encode_glb(doc,binary),image


def test_all_texture_pixels_and_nonimage_geometry_are_exact():
    raw,image=fixture();output,report=module.optimize(raw)
    before,binary=module.read_glb(raw);after,packed=module.read_glb(output)
    assert report['converted_textures']==1 and len(output)<len(raw)
    assert report['non_image_views_identical']==1
    assert module.view_bytes(before,binary,0)==module.view_bytes(after,packed,0)
    for name in ['nodes','materials','accessors','animations','meshes','skins']:
        assert before[name]==after[name]
    encoded=module.view_bytes(after,packed,1)
    with Image.open(io.BytesIO(encoded)) as decoded:
        assert decoded.convert('RGBA').tobytes()==image.tobytes()
    assert after['textures'][0]['extensions']['EXT_texture_webp']['source']==0
    assert 'source' not in after['textures'][0]
    assert 'EXT_texture_webp' in after['extensionsRequired']


def test_color_profile_is_preserved_by_leaving_original_png_untouched():
    raw,_=fixture(profile=True);output,report=module.optimize(raw)
    assert output==raw and report['converted_textures']==0


@pytest.mark.parametrize('data',[b'',b'not a glb',b'x'*100])
def test_malformed_container_is_rejected(data):
    with pytest.raises(ValueError):module.read_glb(data)


def test_declared_size_must_match_actual_size():
    raw,_=fixture()
    with pytest.raises(ValueError):module.read_glb(raw[:-4])


def test_external_buffer_is_not_read():
    raw,_=fixture();doc,binary=module.read_glb(raw);doc['buffers'][0]['uri']='https://example.invalid/model'
    with pytest.raises(ValueError):module.read_glb(module.encode_glb(doc,binary))


def test_shared_image_and_geometry_view_is_rejected():
    raw,_=fixture();doc,binary=module.read_glb(raw);doc['accessors'][0]['bufferView']=1
    with pytest.raises(ValueError):module.optimize(module.encode_glb(doc,binary))


def test_buffer_bounds_are_checked():
    raw,_=fixture();doc,binary=module.read_glb(raw);doc['bufferViews'][0]['byteOffset']=-1
    with pytest.raises(ValueError):module.optimize(module.encode_glb(doc,binary))


def test_indirect_meshopt_layout_is_not_silently_repacked():
    raw,_=fixture();doc,binary=module.read_glb(raw)
    doc['bufferViews'][0]['extensions']={'EXT_meshopt_compression':{'buffer':0}}
    with pytest.raises(ValueError):module.optimize(module.encode_glb(doc,binary))
