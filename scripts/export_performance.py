"""Export the upstream 22-second iClone performance with the private character.
Run from the repository root with Blender --background --python this-file.
No upstream model, animation, material, or Unity scene is overwritten.
"""
import bpy,hashlib,json
from pathlib import Path
root=Path.cwd();source=root/'Assets/Albert Einstein_blender.fbx'
assert source.stat().st_size==298128736,'Restore the original FBX before exporting'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source),use_anim=True)
scene=bpy.context.scene
print('IMPORTED_ACTIONS',[(a.name,list(a.frame_range)) for a in bpy.data.actions],flush=True)
assert len(bpy.data.actions)>0,'The source performance must be present'
scene.frame_start=1;scene.frame_end=1330;scene.render.fps=60;scene.render.fps_base=1
keep={'Basis','V_Open','V_Wide','V_Tight','V_Lip_Open','V_Tight_O','V_Explosive','V_Dental_Lip','V_Affricate','V_Tongue_up','V_Tongue_Out','Eye_Blink','Eye_Blink_L','Eye_Blink_R','Brow_Raise_Inner_L','Brow_Raise_Inner_R','Brow_Raise_Outer_L','Brow_Raise_Outer_R','Mouth_Smile_L','Mouth_Smile_R'}
for obj in list(bpy.data.objects):
 if obj.name in ('CC_Base_EyeOcclusion','CC_Base_TearLine'):
  bpy.data.objects.remove(obj,do_unlink=True);continue
 if obj.type=='MESH' and obj.data.shape_keys:
  for shape in list(obj.data.shape_keys.key_blocks)[::-1]:
   if shape.name not in keep and 'blink' not in shape.name.lower():obj.shape_key_remove(shape)
for image in bpy.data.images:
 if image.size[0] and image.size[1]:
  maximum=2048 if 'skin_head' in image.name.lower() or 'hair' in image.name.lower() else 1024
  factor=min(1,maximum/max(image.size))
  if factor<1:image.scale(max(1,round(image.size[0]*factor)),max(1,round(image.size[1]*factor)))
for material in bpy.data.materials:
 if not material.use_nodes:continue
 node=next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not node:continue
 name=material.name.lower()
 node.inputs['Metallic'].default_value=0
 node.inputs['Roughness'].default_value=.58 if 'skin' in name else (.28 if 'eye' in name or 'cornea' in name else .78)
 if 'Specular IOR Level' in node.inputs:node.inputs['Specular IOR Level'].default_value=.28
 material.use_backface_culling=False
scene.frame_set(1)
props=bpy.ops.export_scene.gltf.get_rna_type().properties
out=root/'.work/einstein-performance.glb'
kwargs=dict(filepath=str(out),export_format='GLB',export_animations=True,export_morph=True,export_morph_normal=False,export_morph_tangent=False,export_skins=True,export_yup=True,export_extras=False,export_image_format='AUTO',export_materials='EXPORT',export_animation_mode='SCENE',export_frame_range=True,export_frame_step=2,export_force_sampling=True,export_optimize_animation_size=True)
for key in list(kwargs):
 if key not in props:print('UNSUPPORTED_OPTION',key,flush=True);del kwargs[key]
bpy.ops.export_scene.gltf(**kwargs)
raw=out.read_bytes();import struct
length,kind=struct.unpack_from('<II',raw,12);doc=json.loads(raw[20:20+length])
assert doc.get('animations') and doc.get('skins'),'Export must contain both motion and skin'
report={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'glb_sha256':hashlib.sha256(raw).hexdigest(),'glb_bytes':len(raw),'animations':[a.get('name') for a in doc['animations']],'animation_channels':sum(len(a['channels']) for a in doc['animations']),'frame_range':[1,1330],'fps':60,'frame_step':2,'blender_version':bpy.app.version_string,'scope':'Original standing iClone performance. Mouth channels are overridden at playback by speech timing. Private asset rights unchanged.'}
(root/'evidence/runtime/c2/performance-export.json').write_text(json.dumps(report,indent=2));print('PERFORMANCE_EXPORT_VERIFIED',json.dumps(report),flush=True)
