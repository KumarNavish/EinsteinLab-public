#!/usr/bin/env python3
"""Reduce a trusted embedded GLB's transfer size without changing rig or pixels.

Only PNG textures are losslessly encoded as WebP. Every decoded RGBA byte and
non-image buffer view is verified. No resizing, geometry quantization, animation
editing, shader change, or image generation is performed. Original input is never
modified. EXT_texture_webp support is required by the resulting GLB.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import time
from PIL import Image, features

JSON_CHUNK=0x4E4F534A
BIN_CHUNK=0x004E4942
MAX_BYTES=160_000_000


def read_glb(raw: bytes):
    if not 28<=len(raw)<=MAX_BYTES:
        raise ValueError('GLB exceeds the bounded asset size')
    magic,version,total=struct.unpack_from('<4sII',raw)
    if magic!=b'glTF' or version!=2 or total!=len(raw):
        raise ValueError('Expected a complete glTF2 binary asset')
    chunks=[];offset=12
    while offset<len(raw):
        if offset+8>len(raw):raise ValueError('Truncated GLB chunk header')
        length,kind=struct.unpack_from('<II',raw,offset);offset+=8
        if length%4 or offset+length>len(raw):raise ValueError('Invalid GLB chunk bounds')
        chunks.append((kind,raw[offset:offset+length]));offset+=length
    if len(chunks)!=2 or chunks[0][0]!=JSON_CHUNK or chunks[1][0]!=BIN_CHUNK:
        raise ValueError('This optimizer requires exactly one JSON and one embedded binary chunk')
    document=json.loads(chunks[0][1].decode('utf8'))
    if len(document.get('buffers',[]))!=1 or document['buffers'][0].get('uri'):
        raise ValueError('External or multiple buffers are not supported')
    if document['buffers'][0]['byteLength']>len(chunks[1][1]):raise ValueError('Truncated binary buffer')
    return document,chunks[1][1]


def view_bytes(document, binary, index):
    view=document['bufferViews'][index]
    if view.get('buffer',0)!=0 or view.get('extensions',{}).get('EXT_meshopt_compression'):
        raise ValueError('Unsupported indirect/compressed buffer layout')
    offset=view.get('byteOffset',0);length=view['byteLength']
    if type(offset) is not int or type(length) is not int or offset<0 or length<1 or offset+length>len(binary):
        raise ValueError('Buffer view outside the embedded binary')
    return binary[offset:offset+length]


def encode_glb(document,binary):
    json_bytes=json.dumps(document,ensure_ascii=False,separators=(',',':')).encode()
    json_bytes+=b' '*(-len(json_bytes)%4)
    bin_bytes=bytes(binary)+b'\0'*(-len(binary)%4)
    total=12+8+len(json_bytes)+8+len(bin_bytes)
    return struct.pack('<4sII',b'glTF',2,total)+struct.pack('<II',len(json_bytes),JSON_CHUNK)+json_bytes+struct.pack('<II',len(bin_bytes),BIN_CHUNK)+bin_bytes


def optimize(raw: bytes):
    if not features.check('webp'):raise ValueError('Pillow was built without WebP support')
    source,binary=read_glb(raw);document=copy.deepcopy(source)
    images=document.get('images',[])
    if len(images)>128:raise ValueError('Texture-count budget exceeded')
    image_views=[image['bufferView'] for image in images if 'bufferView' in image]
    if len(set(image_views))!=len(image_views):raise ValueError('Shared image buffer views require a separate review')
    geometry_views=set()
    for accessor in document.get('accessors',[]):
        if 'bufferView' in accessor:geometry_views.add(accessor['bufferView'])
        for sparse in accessor.get('sparse',{}).values():
            if isinstance(sparse,dict) and 'bufferView' in sparse:geometry_views.add(sparse['bufferView'])
    if geometry_views.intersection(image_views):raise ValueError('An image view cannot also be geometric data')
    replacements={};converted=set();records=[]
    for index,image in enumerate(images):
        if image.get('mimeType')!='image/png' or 'bufferView' not in image:continue
        original=view_bytes(source,binary,image['bufferView'])
        with Image.open(io.BytesIO(original)) as bitmap:
            if bitmap.width*bitmap.height>16_777_216:raise ValueError('Texture pixel budget exceeded')
            if bitmap.mode not in ('RGB','RGBA','L','LA','P') or bitmap.info.get('icc_profile'):
                records.append({'image':index,'kept_original':'profile or unsupported bit depth'});continue
            rgba=bitmap.convert('RGBA');pixels=rgba.tobytes()
            encoded=io.BytesIO();rgba.save(encoded,format='WEBP',lossless=True,exact=True,quality=90,method=4)
            candidate=encoded.getvalue()
            with Image.open(io.BytesIO(candidate)) as checked:
                if checked.size!=rgba.size or checked.convert('RGBA').tobytes()!=pixels:
                    raise ValueError('Lossless texture verification failed')
            if len(candidate)+64>=len(original):
                records.append({'image':index,'kept_original':'No meaningful size saving','before_bytes':len(original)});continue
            replacements[image['bufferView']]=candidate
            image['mimeType']='image/webp';converted.add(index)
            records.append({'image':index,'width':rgba.width,'height':rgba.height,'before_bytes':len(original),
                            'after_bytes':len(candidate),'rgba_sha256':hashlib.sha256(pixels).hexdigest(),'pixels_identical':True})
    if not converted:
        return raw,{'converted_textures':0,'input_bytes':len(raw),'output_bytes':len(raw),'unchanged':True,'textures':records}
    for texture in document.get('textures',[]):
        if texture.get('source') in converted:
            index=texture.pop('source');texture.setdefault('extensions',{})['EXT_texture_webp']={'source':index}
    for field in ['extensionsUsed','extensionsRequired']:
        values=document.setdefault(field,[])
        if 'EXT_texture_webp' not in values:values.append('EXT_texture_webp')
    output=bytearray()
    for index,view in enumerate(document['bufferViews']):
        payload=replacements.get(index)
        if payload is None:payload=view_bytes(source,binary,index)
        output.extend(b'\0'*(-len(output)%4))
        view['byteOffset']=len(output);view['byteLength']=len(payload);output.extend(payload)
    document['buffers'][0]['byteLength']=len(output)
    result=encode_glb(document,output)
    verified,verified_binary=read_glb(result)
    invariant_fields=['nodes','meshes','skins','animations','accessors','materials','samplers','scenes','scene']
    for field in invariant_fields:
        if source.get(field)!=verified.get(field):raise ValueError('Rig/material invariant changed: '+field)
    compared=0
    for index in range(len(source['bufferViews'])):
        if index in replacements:continue
        if view_bytes(source,binary,index)!=view_bytes(verified,verified_binary,index):
            raise ValueError('A non-image buffer changed')
        compared+=1
    if len(result)>=len(raw):
        return raw,{'converted_textures':0,'input_bytes':len(raw),'output_bytes':len(raw),'unchanged':True,
                    'reason':'Format overhead exceeded texture savings','textures':records}
    return result,{'converted_textures':len(converted),'input_bytes':len(raw),'output_bytes':len(result),
                   'saved_bytes':len(raw)-len(result),'reduction_percent':round(100*(1-len(result)/len(raw)),3),
                   'non_image_views_identical':compared,'rig_material_json_identical':invariant_fields,
                   'textures':records,'requires':'EXT_texture_webp','appearance_change':False,
                   'gpu_texture_memory_reduction_claimed':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists() or args.report.exists() or args.input.resolve()==args.output.resolve():
        raise SystemExit('Output/report already exists, or would replace the original; reconcile before proceeding.')
    if args.input.stat().st_size>MAX_BYTES:raise SystemExit('Input exceeds the trusted-asset size budget')
    raw=args.input.read_bytes();start=time.perf_counter();result,report=optimize(raw)
    args.output.parent.mkdir(parents=True,exist_ok=True);args.report.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('xb') as file:file.write(result)
    report.update(input_sha256=hashlib.sha256(raw).hexdigest(),output_sha256=hashlib.sha256(result).hexdigest(),
                  processing_seconds=round(time.perf_counter()-start,3),
                  scope='Lossless transfer optimization of the existing private 3D asset. No new texture design, pose, geometry or realism claim.')
    with args.report.open('x') as file:json.dump(report,file,indent=2)
    print(json.dumps({key:value for key,value in report.items() if key!='textures'},indent=2))


if __name__=='__main__':main()
