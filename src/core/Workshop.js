import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export class Workshop {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#202731');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = .95;
    this.renderer.xr.enabled = true; this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.xr.setFramebufferScaleFactor(1); this.renderer.xr.setFoveation(1);
    this.renderer.domElement.setAttribute('aria-label', '3D asset viewport');
    container.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(43, 1, .01, 2000); this.camera.position.set(3.4, 2.65, 3.55);
    this.cameraRig = new THREE.Group(); this.cameraRig.add(this.camera); this.scene.add(this.cameraRig);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0,1.25,-1.25); this.controls.enableDamping = true; this.controls.dampingFactor=.08;
    this.controls.minDistance=.12; this.controls.maxDistance=1000;
    const pmrem = new THREE.PMREMGenerator(this.renderer), room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, .04).texture; this.scene.environment = this.environment; this.scene.environmentIntensity=.65; pmrem.dispose(); room.dispose();
    this.ambient = new THREE.HemisphereLight('#e9f0fb', '#555c60', .65); this.scene.add(this.ambient);
    const key = new THREE.DirectionalLight('#fff6e8', 2.6); key.position.set(2,5,3); this.scene.add(key);
    const rim = new THREE.DirectionalLight('#c3ddf3', 1.5); rim.position.set(-4,3,-4); this.scene.add(rim);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.MeshStandardMaterial({color:'#111820',roughness:1,metalness:0}));
    this.floor.rotation.x=-Math.PI/2; this.floor.position.y=-.018; this.scene.add(this.floor);
    const grid = new THREE.GridHelper(40,40,'#50606b','#333f4d'); grid.material.transparent=true; grid.material.opacity=.35; grid.position.y=-.009; this.scene.add(grid);
    this.table = new THREE.Group(); this.table.position.set(0,0,-1.25); this.scene.add(this.table);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.14,1.1,.07,80),new THREE.MeshStandardMaterial({color:'#202b34',roughness:.85,metalness:.25})); plinth.position.y=.79; this.table.add(plinth);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.11,.004,6,96),new THREE.MeshBasicMaterial({color:'#93b29d'})); ring.rotation.x=Math.PI/2; ring.position.y=.828; this.table.add(ring);
    const surface = new THREE.GridHelper(1.5,15,'#52636a','#3e4c54'); surface.position.y=.829; surface.material.transparent=true; surface.material.opacity=.4; this.table.add(surface);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(.07,.14,.78,16),new THREE.MeshStandardMaterial({color:'#27323b',metalness:.65,roughness:.6})); stand.position.y=.38; this.table.add(stand);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.43,.5,.05,48),stand.material); foot.position.y=.016; this.table.add(foot);
    this.viewRig = new THREE.Group(); this.viewRig.position.set(0,.86,-1.25); this.scene.add(this.viewRig);
    this.offset = new THREE.Group(); this.viewRig.add(this.offset);
    this.viewScale = 1; this.viewMode = 'tabletop'; this.bounds = new THREE.Box3();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(container); this.resize();
  }
  resize() {
    const {width,height}=this.container.getBoundingClientRect(); if(!width||!height)return;
    this.camera.aspect=width/height; this.camera.updateProjectionMatrix();
    if(!this.renderer.xr.isPresenting)this.renderer.setSize(width,height);
  }
  setAssetBounds(bounds) {
    this.bounds.copy(bounds); const centre=bounds.getCenter(new THREE.Vector3());
    this.offset.position.set(-centre.x,-bounds.min.y,-centre.z); this.setViewMode('tabletop');
  }
  setViewMode(mode, scale) {
    this.viewMode=mode;
    this.viewScale = scale ?? (mode==='actual'?1:1.78/Math.max(...this.bounds.getSize(new THREE.Vector3()).toArray(),.01));
    this.viewRig.scale.setScalar(this.viewScale); this.viewRig.position.set(0,mode==='actual'?0:.86,-1.25); this.viewRig.quaternion.identity();
    this.table.visible=mode!=='actual';
    if(!this.renderer.xr.isPresenting)this.frame();
  }
  frame() {
    const size=this.bounds.getSize(new THREE.Vector3()).multiplyScalar(this.viewScale);
    const center=new THREE.Vector3(0,this.viewRig.position.y+size.y*.5,-1.25);
    const radius=Math.max(size.length()*.6,.3), d=radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));
    this.controls.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(.78,.53,1).normalize().multiplyScalar(d*1.2)); this.controls.update();
  }
  setBrightness(value) { this.renderer.toneMappingExposure=value; this.scene.background.set('#202731').multiplyScalar(value); }
  recenter() { this.cameraRig.position.set(0,0,0); this.cameraRig.quaternion.identity(); this.setViewMode(this.viewMode,this.viewScale); }
  enterXR() { this.controls.enabled=false; this.savedCamera={position:this.camera.position.clone(),quaternion:this.camera.quaternion.clone()}; this.camera.position.set(0,0,0); this.camera.quaternion.identity(); }
  exitXR() { this.cameraRig.position.set(0,0,0); this.cameraRig.quaternion.identity(); if(this.savedCamera){this.camera.position.copy(this.savedCamera.position);this.camera.quaternion.copy(this.savedCamera.quaternion);} this.controls.enabled=true; this.resize(); }
}
