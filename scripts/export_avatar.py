"""Run with Blender --background --python scripts/export_avatar.py from the repo root.
Private derivative: source asset rights are not changed and the generated GLB stays untracked.
"""
import bpy, hashlib, json, math
from pathlib import Path
from mathutils import Matrix, Vector
root=Path.cwd(); source=root/'Assets/Albert Einstein_blender.fbx'
assert source.stat().st_size>1_000_000, 'Restore the upstream FBX with Git LFS first'
cache=root/'.work/avatar-import.blend'
if cache.is_file(): bpy.ops.wm.open_mainfile(filepath=str(cache))
else:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.fbx(filepath=str(source),use_anim=False)
keep={'Basis','V_Open','V_Wide','V_Tight','V_Lip_Open','V_Tight_O','V_Explosive','V_Dental_Lip','V_Affricate','V_Tongue_up','V_Tongue_Out','Eye_Blink','Eye_Blink_L','Eye_Blink_R','Brow_Raise_Inner_L','Brow_Raise_Inner_R','Brow_Raise_Outer_L','Brow_Raise_Outer_R','Mouth_Smile_L','Mouth_Smile_R'}
removed=0
for obj in bpy.data.objects:
 if obj.type=='MESH' and obj.data.shape_keys:
  for k in list(obj.data.shape_keys.key_blocks)[::-1]:
   if k.name not in keep and 'blink' not in k.name.lower(): obj.shape_key_remove(k); removed+=1
 if obj.type=='ARMATURE':
  obj.animation_data_clear()
  for side,sign in [('L',1),('R',-1)]:
   bone=obj.pose.bones.get('CC_Base_'+side+'_Upperarm')
   if bone:
    head=bone.head.copy();rot=Matrix.Rotation(math.radians(36)*sign,4,'Y')
    bone.matrix=Matrix.Translation(head)@rot@Matrix.Translation(-head)@bone.matrix
# Keep the original packed color/normal/opacity maps. Limit texture bandwidth, not facial geometry.
for im in bpy.data.images:
 if im.size[0] and im.size[1]:
  maximum=2048 if 'skin_head' in im.name.lower() or 'hair' in im.name.lower() else 1024
  factor=min(1, maximum/max(im.size))
  if factor<1:im.scale(max(1,round(im.size[0]*factor)),max(1,round(im.size[1]*factor)))
for material in bpy.data.materials:
 if not material.use_nodes:continue
 p=next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not p:continue
 name=material.name.lower()
 if 'Metallic' in p.inputs:p.inputs['Metallic'].default_value=0
 if 'Roughness' in p.inputs:p.inputs['Roughness'].default_value=.58 if 'skin' in name else (.28 if 'eye' in name or 'cornea' in name else .78)
 if 'Specular IOR Level' in p.inputs:p.inputs['Specular IOR Level'].default_value=.28
 # Thin hair cards need two-sided shading, not expensive transmissive layers.
 material.use_backface_culling=False
out=root/'rehearsal/public/assets/einstein.glb';out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_animations=False,export_morph=True,export_morph_normal=False,export_morph_tangent=False,export_skins=True,export_yup=True,export_extras=False,export_image_format='AUTO',export_materials='EXPORT')
report={'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'glb_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'glb_bytes':out.stat().st_size,'removed_unused_morphs':removed,'blender_version':bpy.app.version_string,'license':'Private upstream asset; no new redistribution rights asserted','animation':'Retained rig, selected facial morphs, relaxed arms; no iClone clip exported in browser derivative'}
(root/'evidence/runtime/avatar-export.json').write_text(json.dumps(report,indent=2));print('GLB_READY',json.dumps(report))
