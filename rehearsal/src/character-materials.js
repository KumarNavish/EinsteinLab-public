import * as THREE from 'three';

/** Preserve the original geometry/albedo. Correct opaque hair-card treatment and
 * use the source roughness/occlusion maps instead of a uniform skin surface.
 * This improves rendering; it does not turn the source into a scanned human.
 */
export function tuneCharacterMaterials(model, {anisotropy = 4} = {}) {
  const seen = new Set();
  const result = {materials: 0, hair: 0, skin: 0};
  model.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material || seen.has(material)) continue;
      seen.add(material); result.materials++;
      for (const name of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'alphaMap']) {
        if (material[name]) material[name].anisotropy = anisotropy;
      }
      const hair = /hair|sword|scalp|eyelash/i.test(material.name);
      if (hair) {
        result.hair++;
        const lash = /eyelash/i.test(material.name);
        const scalp = /scalp/i.test(material.name);
        material.side = THREE.DoubleSide;
        material.transparent = true;
        material.depthWrite = false;
        material.alphaToCoverage = false;
        material.alphaHash = false;
        material.alphaTest = scalp ? .02 : .035;
        material.roughness = .86;
        material.metalness = 0;
        material.specularIntensity = .15;
        material.specularIntensityMap = null;
        material.specularColorMap = null;
        material.envMapIntensity = .3;
        material.normalScale?.set(.12, .12);
        if (!scalp) material.color.setRGB(lash ? .32 : .46, lash ? .27 : .45, lash ? .24 : .42);
        object.castShadow = false;
      } else if (/Std_Skin/.test(material.name)) {
        result.skin++;
        material.roughness = .58;
        material.specularIntensity = .38;
        material.envMapIntensity = .48;
        material.normalScale?.set(.42, .42);
      } else if (/Std_(Eye|Cornea)/.test(material.name)) {
        material.roughness = .16;
        material.envMapIntensity = .55;
        object.castShadow = false;
      }
      material.needsUpdate = true;
    }
  });
  return result;
}

export async function loadSkinSurfaceMaps(model, renderer) {
  const loader = new THREE.TextureLoader();
  const root = new URL('assets/character-surfaces/', document.baseURI);
  const [roughness, occlusion] = await Promise.all([
    loader.loadAsync(new URL('head-roughness.png', root).href),
    loader.loadAsync(new URL('head-occlusion.png', root).href),
  ]);
  for (const map of [roughness, occlusion]) {
    map.flipY = false;
    map.colorSpace = THREE.NoColorSpace;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    map.channel = 0;
  }
  const seen = new Set();
  model.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (seen.has(material) || material.name !== 'Std_Skin_Head') continue;
      seen.add(material);
      material.roughnessMap = roughness;
      material.roughness = .95;
      material.aoMap = occlusion;
      material.aoMapIntensity = .4;
      material.needsUpdate = true;
    }
  });
  return {roughness, occlusion, materials: seen.size};
}
