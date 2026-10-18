import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EmbodiedAttention} from './embodied-attention.js';
import {PoseLayers, ExpressionLayers} from './pose-layers.js';
import {loadCharacter} from './character-transfer.js';
import {RenderQuality, SLOW_RENDER_PROFILE, reduceRenderCost, frameRate} from './render-quality.js';

const SHAPES = ['V_Explosive', 'V_Tight', 'V_Wide', 'V_Lip_Open', 'V_Open', 'V_Tight_O', 'V_Dental_Lip', 'V_Affricate', 'V_Tongue_up', 'V_Tongue_Out'];
const POSES = {
  X: {jaw: 0}, A: {jaw: 0, V_Explosive: 1},
  B: {jaw: .18, V_Wide: .35, V_Lip_Open: .35, V_Tight: .25},
  C: {jaw: .50, V_Open: .45, V_Wide: .30},
  D: {jaw: 1, V_Open: 1}, E: {jaw: .55, V_Tight_O: .45, V_Open: .4},
  F: {jaw: .22, V_Tight_O: 1}, G: {jaw: .10, V_Dental_Lip: 1},
  H: {jaw: .35, V_Lip_Open: .45, V_Tongue_up: .9},
};

/** Original rig, quiet authored rest, and output-audio-clock facial animation. */
export class EinsteinStage {
  constructor(element, onInfo) {
    this.element = element; this.onInfo = onInfo; this.ready = false;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#ecebe5');
    this.camera = new THREE.PerspectiveCamera(31, 1, .01, 60);
    this.camera.position.set(.02, 1.46, 2.82);
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.xr.enabled = true; element.appendChild(this.renderer.domElement);
    const environment = new RoomEnvironment();
    const lighting = new THREE.PMREMGenerator(this.renderer);
    this.environmentMap = lighting.fromScene(environment, .04);
    this.scene.environment = this.environmentMap.texture;
    this.scene.environmentIntensity = .32;
    environment.dispose(); lighting.dispose();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.23, 0);
    this.controls.enableDamping = true; this.controls.enablePan = false;
    this.controls.minDistance = 1.1; this.controls.maxDistance = 4;
    this.controls.minPolarAngle = .9; this.controls.maxPolarAngle = 1.75;
    this.controls.maxAzimuthAngle = .7; this.controls.minAzimuthAngle = -.7;
    this.scene.add(new THREE.HemisphereLight(0xe9f1f1, 0x6f6c63, 1.8));
    const key = new THREE.DirectionalLight(0xfff0db, 1.8); key.position.set(-3, 4, 4);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.normalBias = .035;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xcddfea, 1.2); fill.position.set(3, 2, 2); this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xe2e9d6, .8); rim.position.set(-1, 3, -2); this.scene.add(rim);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({color: 0x53614f, opacity: .13}));
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true; this.scene.add(this.floor);
    this.actor = new THREE.Group(); this.scene.add(this.actor);
    this.morphs = []; this.frames = []; this.last = performance.now(); this.performanceWeight = 0;
    this.quality = new RenderQuality();
    this.speech = {amplitude: 0, time: 0, cues: [], active: false}; this.current = {};
    this.conversationState = 'ready'; this.nextBlinkAt = 1.8; this.blinkStarted = -10; this.randomState = 92821;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(.12, .135, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({color: 0xd5e8bd}));
    this.reticle.matrixAutoUpdate = false; this.reticle.visible = false; this.scene.add(this.reticle);
    this.renderer.xr.getController(0).addEventListener('select', () => {
      if (!this.reticle.visible) return;
      this.actor.position.setFromMatrixPosition(this.reticle.matrix);
      const camera = this.renderer.xr.getCamera(this.camera).getWorldPosition(new THREE.Vector3());
      this.actor.lookAt(camera.x, this.actor.position.y, camera.z);
      this.actor.visible = true; this.placed = true;
    });
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize(); this.controls.update();
    this.renderer.domElement.addEventListener('pointerdown', () => { this.interacting = true; });
    window.addEventListener('pointerup', () => { this.interacting = false; });
    this.renderer.setAnimationLoop((time, frame) => this.update(time, frame));
    this.load();
  }

  resize() {
    const {width, height} = this.element.getBoundingClientRect();
    this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  async load() {
    try {
      const gltf = await loadCharacter(new GLTFLoader(), event => this.onInfo({loading: event.total ? Math.round(event.loaded / event.total * 100) : null}));
      const model = gltf.scene; this.actor.add(model); this.model = model;
      const originalJaw = model.getObjectByName('CC_Base_JawRoot')?.quaternion.clone();
      if (gltf.animations.length) {
        const tracks = gltf.animations.flatMap(clip => clip.tracks);
        const duration = Math.max(...gltf.animations.map(clip => clip.duration));
        this.mixer = new THREE.AnimationMixer(model);
        const clip = new THREE.AnimationClip('Original iClone standing performance', duration, tracks);
        // Keep the original clip available, but never make unrelated recorded
        // gestures follow speech volume. Hands stay in their authored rest.
        this.performance = this.mixer.clipAction(clip); this.performance.setEffectiveWeight(0);
        const held = tracks.map(track => {
          const copy = track.clone(); const size = track.getValueSize();
          copy.times = new Float32Array([0, 1]); copy.values = new Float32Array(size * 2);
          copy.values.set(track.values.slice(0, size), 0); copy.values.set(track.values.slice(0, size), size);
          return copy;
        });
        this.idle = this.mixer.clipAction(new THREE.AnimationClip('Neutral first performance frame', 1, held)).play();
        this.mixer.update(0);
        this.motionInfo = {clips: gltf.animations.map(clip => clip.name), duration, tracks: tracks.length,
          playback: 'authored rest with modest head and torso attention'};
      }
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(1.72 / size.y); model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      model.position.y -= box.min.y; model.position.x -= (box.min.x + box.max.x) / 2; model.position.z -= (box.min.z + box.max.z) / 2;
      model.updateMatrixWorld(true);
      model.traverse(object => {
        if (object.isMesh) {
          object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false;
          if (/CC_Base_(EyeOcclusion|TearLine)/.test(object.name)) object.visible = false;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (/hair|beard|sword|scalp|eyelash/i.test(material.name)) {
              material.side = THREE.DoubleSide; material.alphaTest = .25; material.alphaToCoverage = true; material.transparent = false;
              material.roughness = .96;
              material.specularIntensityMap = null;
              material.specularColorMap = null;
              material.specularIntensity = .06;
              material.alphaToCoverage = false;
              material.alphaTest = .18;
              material.color.multiplyScalar(.42);
              if ('specularColor' in material) material.specularColor.setRGB(.18, .18, .18);
              if (material.normalScale) material.normalScale.multiplyScalar(.42);
              material.envMapIntensity = .15;
            }
            if (material.name === 'Hair_Transparency') material.color.setRGB(.30, .28, .255);
            if (/Std_Skin/.test(material.name)) { material.roughness = .64; material.envMapIntensity = .30; material.normalScale?.multiplyScalar(.6); }
            if (/Std_(Eye|Cornea)/.test(material.name)) { material.roughness = .14; material.envMapIntensity = .65; }
            if (/cornea|tearline|occlusion/i.test(material.name)) object.castShadow = false;
          }
          if (object.morphTargetDictionary) this.morphs.push(object);
        }
        if (object.isBone && /CC_Base_JawRoot/.test(object.name)) this.jaw = {bone: object, rest: originalJaw || object.quaternion.clone()};
        if (object.isBone && object.name === 'CC_Base_Head') this.head = object;
        if (object.isBone && object.name === 'CC_Base_Spine02') this.chest = object;
      });
      this.poseLayers = new PoseLayers([this.chest, this.head]);
      this.expressionLayers = new ExpressionLayers(this.morphs);
      if (this.jaw) this.configureJaw();
      this.attention = new EmbodiedAttention(this); this.attention.initialize();
      this.ready = true;
      this.onInfo({ready: true, meshes: this.morphs.length, height: 1.72, motion: this.motionInfo || null});
    } catch (error) {
      this.onInfo({error: 'The character could not load: ' + error.message});
    }
  }

  configureJaw() {
    const bone = this.jaw.bone;
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const chin = new THREE.Vector3();
    for (const child of bone.children) chin.add(child.getWorldPosition(new THREE.Vector3()).sub(origin));
    if (chin.lengthSq() < 1e-10) chin.set(0, -.3, 1);
    const axis = new THREE.Vector3(0, 1, 0).cross(chin.normalize()).normalize();
    axis.applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert());
    const childHeight = () => bone.children.reduce((sum, child) => sum + child.getWorldPosition(new THREE.Vector3()).y, 0);
    const before = childHeight();
    bone.quaternion.copy(this.jaw.rest).multiply(new THREE.Quaternion().setFromAxisAngle(axis, .15));
    bone.updateWorldMatrix(true, true);
    if (childHeight() > before) axis.negate();
    bone.quaternion.copy(this.jaw.rest); bone.updateWorldMatrix(true, true);
    this.jaw.axis = axis;
  }

  view(mode) {
    if ((mode === 'portrait' || mode === 'face') && this.head) {
      const face = this.head.getWorldPosition(new THREE.Vector3());
      face.y += .025; face.z += .035;
      this.controls.minDistance = .5;
      this.controls.target.copy(face);
      this.camera.position.copy(face).add(new THREE.Vector3(.015, .025, mode === 'face' ? .68 : .90));
    } else {
      this.controls.minDistance = 1.1;
      this.controls.target.set(0, 1.06, 0);
      this.camera.position.set(0, 1.38, 3.6);
    }
    this.controls.update();
  }

  speechFrame(amplitude, time, cues, active, acousticWeights = null) {
    this.speech = {amplitude, time, cues, active, acousticWeights};
  }

  setConversationState(state) {
    if (state !== this.conversationState && (state === 'listening' || state === 'thinking')) this.nextBlinkAt = this.last / 1000 + .28;
    this.conversationState = state;
  }

  random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  articulation(amplitude) {
    this.speechFrame(amplitude, 0, [], amplitude > .001);
  }

  update(t, frame) {
    const fps = this.quality.reduced ? SLOW_RENDER_PROFILE.fps : this.speech.active || this.interacting ? 60 : 30;
    if (!this.renderer.xr.isPresenting && this.renderedAt != null && t - this.renderedAt < 1000 / fps - 1) return;
    this.renderedAt = t;
    const frameMs = Math.max(1, t - this.last);
    const seconds = t / 1000, dt = Math.min(.1, frameMs / 1000); this.last = t;
    this.frames.push(frameMs); if (this.frames.length > 90) this.frames.shift();
    if (this.quality.observe(frameMs, {ready: this.ready, visible: document.visibilityState === 'visible', xr: this.renderer.xr.isPresenting})) {
      reduceRenderCost(this.renderer, this.scene, devicePixelRatio);
    }
    this.poseLayers?.restoreAnimationPose();
    this.expressionLayers?.restoreAnimationPose();
    this.mixer?.update(dt);
    this.poseLayers?.captureAnimationPose();
    this.expressionLayers?.captureAnimationPose();
    if (seconds >= this.nextBlinkAt) {
      this.blinkStarted = seconds;
      this.nextBlinkAt = seconds + 2.8 + this.random() * 3.5;
    }
    const blinkPhase = seconds - this.blinkStarted;
    const blink = blinkPhase >= 0 && blinkPhase < .14 ? Math.sin(blinkPhase / .14 * Math.PI) : 0;
    let pose = POSES.X;
    if (this.speech.active && this.speech.amplitude > .002) {
      if (this.speech.acousticWeights) {
        pose = {jaw: 0};
        for (const [name, weight] of Object.entries(this.speech.acousticWeights)) {
          const target = POSES[name];
          if (!target || name === 'X') continue;
          for (const [key, value] of Object.entries(target)) pose[key] = Math.min(1, (pose[key] || 0) + value * weight);
        }
      } else if (this.speech.cues.length) {
        const time = this.speech.time + .025;
        const cue = this.speech.cues.find(cue => cue.start <= time && cue.end > time);
        pose = POSES[cue?.value] || POSES.X;
      } else {
        pose = {jaw: Math.min(.65, this.speech.amplitude * 9), V_Open: Math.min(.65, this.speech.amplitude * 9)};
      }
    }
    const speed = pose.V_Explosive ? 65 : 32;
    for (const name of [...SHAPES, 'jaw']) this.current[name] = THREE.MathUtils.lerp(this.current[name] || 0, pose[name] || 0, 1 - Math.exp(-speed * dt));
    for (const mesh of this.morphs) {
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        if (SHAPES.includes(name)) mesh.morphTargetInfluences[index] = this.current[name];
        else if (/eye.?blink/i.test(name)) mesh.morphTargetInfluences[index] = Math.max(mesh.morphTargetInfluences[index] || 0, blink);
        else if (/Brow_Raise_Inner/.test(name)) mesh.morphTargetInfluences[index] = Math.max(mesh.morphTargetInfluences[index] || 0, this.conversationState === 'thinking' ? .075 : .015);
        else if (/Mouth_Smile/.test(name) && !this.speech.active) mesh.morphTargetInfluences[index] = this.conversationState === 'listening' ? .045 : .02;
      }
    }
    if (this.jaw) this.jaw.bone.quaternion.copy(this.jaw.rest).multiply(new THREE.Quaternion().setFromAxisAngle(this.jaw.axis, this.current.jaw * .227));
    const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
    this.attention?.update(frameMs / 1000, {reducedMotion});
    if (this.head && !reducedMotion) {
      const idleWeight = 1 - (this.attention?.weight || 0);
      const yaw = Math.max(-.09, Math.min(.09, this.camera.position.x * .055)) * idleWeight;
      const attentive = (this.conversationState === 'listening' ? -.016 : this.conversationState === 'thinking' ? .015 : 0) * idleWeight;
      const head = this.attention?.headOffset, torso = this.attention?.torsoOffset;
      const actorRotation = this.actor.getWorldQuaternion(new THREE.Quaternion());
      // Compose once per bone: PoseLayers resets to the animation baseline on apply.
      if (this.chest) this.poseLayers.applyWorldOffset(this.chest, (torso?.pitch || 0) + Math.sin(seconds * 1.35) * .0025, torso?.yaw || 0, 0, actorRotation);
      this.poseLayers.applyWorldOffset(this.head, (head?.pitch || 0) + attentive + Math.sin(seconds * 1.1) * .006, (head?.yaw || 0) + yaw + Math.sin(seconds * .29) * .01, Math.sin(seconds * .62) * .005, actorRotation);
    }
    if (!this.renderer.xr.isPresenting) this.controls.update();
    if (frame && this.hitSource) {
      const hits = frame.getHitTestResults(this.hitSource); this.reticle.visible = hits.length > 0 && !this.placed;
      if (hits.length) this.reticle.matrix.fromArray(hits[0].getPose(this.renderer.xr.getReferenceSpace()).transform.matrix);
    }
    const submissionStarted = performance.now();
    this.renderer.render(this.scene, this.camera);
    const submissionMs = performance.now() - submissionStarted;
    if (Math.floor(t / 1000) !== this.reportSecond) {
      this.reportSecond = Math.floor(t / 1000);
      this.onInfo({fps: frameRate(this.frames), frameMs: Math.round(frameMs), submissionMs: Math.round(submissionMs),
                   renderQuality: this.quality.reduced ? 'reduced' : 'standard', pixelRatio: this.renderer.getPixelRatio(), shadows: this.renderer.shadowMap.enabled,
                   triangles: this.renderer.info.render.triangles,
                   drawCalls: this.renderer.info.render.calls, performanceWeight: this.performanceWeight, mouthOpenness: this.current.jaw || 0,
                   mouthMethod: this.speech.acousticWeights ? 'audio-viseme-estimate' : this.speech.cues.length ? 'phoneme-duration' : 'amplitude', conversationState: this.conversationState});
    }
  }

  async enterAR() {
    if (!this.ready) throw new Error('The character must finish loading before entering AR.');
    const session = await navigator.xr.requestSession('immersive-ar', {requiredFeatures: ['hit-test'], optionalFeatures: ['local-floor', 'dom-overlay'], domOverlay: {root: document.querySelector('#app')}});
    this.renderer.xr.setReferenceSpaceType('local'); await this.renderer.xr.setSession(session);
    this.scene.background = null; this.renderer.setClearAlpha(0); this.floor.visible = false;
    this.actor.visible = false; this.placed = false;
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({space: viewer});
    session.addEventListener('end', () => {
      this.hitSource?.cancel(); this.hitSource = null; this.reticle.visible = false;
      this.actor.position.set(0, 0, 0); this.actor.quaternion.identity(); this.actor.visible = true;
      this.floor.visible = true; this.scene.background = new THREE.Color('#ecebe5'); this.renderer.setClearAlpha(1);
    });
  }
}
