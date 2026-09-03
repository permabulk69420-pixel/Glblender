import * as THREE from 'three';
import { isEditableMesh, clamp } from '../core/utils.js';
import { smoothFalloff, bendPoint } from './deformationMath.js';

export class DeformationTool {
  constructor(history,scene) {
    this.history=history;this.radius=.8;this.strength=1;this.falloff=1;this.kind='pull';this.axis='Y';this.active=null;this.uniqueGeometry=new WeakSet();
    this.delta=new THREE.Vector3();this.localDelta=new THREE.Vector3();this.scratch=new Float64Array(3);
    this.brush=new THREE.Group();this.brush.visible=false;scene.add(this.brush);
    for(let axis=0;axis<3;axis++) {
      const pts=[];for(let i=0;i<=64;i++){const a=i/64*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a),Math.sin(a),0));}
      const ring=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:'#b5e890',transparent:true,opacity:axis===0?.8:.3,depthTest:false}));
      if(axis===1)ring.rotation.y=Math.PI/2;if(axis===2)ring.rotation.x=Math.PI/2;ring.renderOrder=20;this.brush.add(ring);
    }
  }
  hover(point,worldScale=1) {this.brush.visible=!!point;if(point){this.brush.position.copy(point);this.brush.scale.setScalar(this.radius*worldScale);}}
  begin(mesh,point,handle,viewScale=1,normal=null) {
    if(this.active)return false;
    if(!isEditableMesh(mesh))throw new Error('Shape tools need a static mesh. Select a mesh without a rig, morph targets or instances.');
    if(mesh.geometry.attributes.position.count>1000000)throw new Error('This mesh has over one million vertices. Simplify it before shaping on Quest.');
    if(!this.uniqueGeometry.has(mesh)){mesh.geometry=mesh.geometry.clone();this.uniqueGeometry.add(mesh);}
    const geometry=mesh.geometry,attr=geometry.attributes.position;
    // Convert interleaved/quantized positions once; edits then use a writable,
    // tightly packed Float32 buffer without changing UVs, indices or materials.
    if(attr.isInterleavedBufferAttribute||!(attr.array instanceof Float32Array)||attr.normalized){
      const packed=new Float32Array(attr.count*3);for(let i=0;i<attr.count;i++){packed[i*3]=attr.getX(i);packed[i*3+1]=attr.getY(i);packed[i*3+2]=attr.getZ(i);}geometry.setAttribute('position',new THREE.BufferAttribute(packed,3));
    }
    const positions=geometry.attributes.position; positions.setUsage(THREE.DynamicDrawUsage);
    mesh.updateWorldMatrix(true,false);const inverse=mesh.matrixWorld.clone().invert(),center=point.clone().applyMatrix4(inverse),linear=new THREE.Matrix3().setFromMatrix4(inverse),worldRadius=this.radius*viewScale;
    const indices=[],before=[],weights=[],v=new THREE.Vector3();
    for(let i=0;i<positions.count;i++) {
      v.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
      const weight=this.kind==='bend'?1:smoothFalloff(v.distanceTo(point),worldRadius,this.falloff);
      if(weight>.00001){indices.push(i);before.push(positions.getX(i),positions.getY(i),positions.getZ(i));weights.push(weight);}
    }
    if(!indices.length)return false;
    if(indices.length>300000)throw new Error('This brush covers over 300,000 vertices. Use a smaller radius or simplify the mesh.');
    geometry.computeBoundingBox();const box=geometry.boundingBox.clone(),axis='XYZ'.indexOf(this.axis),radial=(axis+1)%3;
    const scale=mesh.getWorldScale(new THREE.Vector3());
    this.active={mesh,indices:Uint32Array.from(indices),before:Float32Array.from(before),weights:Float32Array.from(weights),center,linear,start:handle.clone(),worldRadius,localRadius:worldRadius/Math.max(Math.abs(scale.getComponent(axis)),.00001),normal:normal?.clone().normalize()||new THREE.Vector3(0,1,0),kind:this.kind,axis,box,min:box.min.getComponent(axis),length:box.max.getComponent(axis)-box.min.getComponent(axis),crossCenter:(box.min.getComponent(radial)+box.max.getComponent(radial))/2,lastNormals:0,changed:false};
    this.hover(point,viewScale);return true;
  }
  update(handle,now=performance.now()) {
    const a=this.active;if(!a)return;
    this.delta.subVectors(handle,a.start);this.localDelta.copy(this.delta).applyMatrix3(a.linear);
    const dx=this.localDelta.x*this.strength,dy=this.localDelta.y*this.strength,dz=this.localDelta.z*this.strength;
    if(this.delta.lengthSq()>1e-10)a.changed=true;
    const axisDelta=this.localDelta.getComponent(a.axis)*this.strength;
    const factor=clamp(1+axisDelta/Math.max(a.localRadius,.00001),.15,4);
    const flatten=clamp(this.delta.length()/a.worldRadius*this.strength,0,1);
    const bendAngle=clamp(this.localDelta.getComponent((a.axis+1)%3)/Math.max(a.localRadius,.00001)*this.strength,-Math.PI,Math.PI);
    this.write(a,(i,x,y,z,w)=> {
      const out=this.scratch;out[0]=x;out[1]=y;out[2]=z;
      if(a.kind==='pull'){out[0]+=dx*w;out[1]+=dy*w;out[2]+=dz*w;}
      else if(a.kind==='stretch'||a.kind==='squash') {
        for(let c=0;c<3;c++){const mult=c===a.axis?factor:a.kind==='squash'?1/Math.sqrt(factor):1;out[c]+=(out[c]-a.center.getComponent(c))*(mult-1)*w;}
      } else if(a.kind==='flatten') {
        const distance=(x-a.center.x)*a.normal.x+(y-a.center.y)*a.normal.y+(z-a.center.z)*a.normal.z;
        out[0]-=a.normal.x*distance*w*flatten;out[1]-=a.normal.y*distance*w*flatten;out[2]-=a.normal.z*distance*w*flatten;
      } else bendPoint(x,y,z,a.axis,bendAngle,a.min,a.length,a.crossCenter,out);
      return out;
    });
    if(now-a.lastNormals>80){this.recompute(a.mesh);a.lastNormals=now;}
  }
  write(a,operation) {
    const p=a.mesh.geometry.attributes.position,arr=p.array;
    for(let j=0;j<a.indices.length;j++){const k=j*3,i=a.indices[j]*3,out=operation(j,a.before[k],a.before[k+1],a.before[k+2],a.weights[j]);arr[i]=out[0];arr[i+1]=out[1];arr[i+2]=out[2];}
    p.clearUpdateRanges();const first=a.indices[0]*3,last=a.indices.at(-1)*3+3;p.addUpdateRange(first,last-first);p.needsUpdate=true;
  }
  recompute(mesh) {mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
  end(cancel=false) {
    const a=this.active;if(!a)return;this.active=null;this.brush.visible=false;
    const apply=data=>{const p=a.mesh.geometry.attributes.position;for(let j=0;j<a.indices.length;j++)p.setXYZ(a.indices[j],data[j*3],data[j*3+1],data[j*3+2]);p.clearUpdateRanges();p.needsUpdate=true;this.recompute(a.mesh);};
    if(cancel){apply(a.before);return;}
    this.recompute(a.mesh);if(!a.changed)return;
    const after=new Float32Array(a.before.length),p=a.mesh.geometry.attributes.position;
    for(let j=0;j<a.indices.length;j++){after[j*3]=p.getX(a.indices[j]);after[j*3+1]=p.getY(a.indices[j]);after[j*3+2]=p.getZ(a.indices[j]);}
    this.history.commit({label:`${a.kind[0].toUpperCase()+a.kind.slice(1)} ${a.mesh.name||'mesh'}`,bytes:a.before.byteLength+after.byteLength+a.indices.byteLength,undo:()=>apply(a.before),redo:()=>apply(after)});
  }
  applyBend(mesh,angle,viewScale=1) {
    const kind=this.kind;this.kind='bend';mesh.updateWorldMatrix(true,false);
    const point=new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    try {if(!this.begin(mesh,point,point,viewScale))return;const a=this.active;this.write(a,(_i,x,y,z)=>bendPoint(x,y,z,a.axis,angle,a.min,a.length,a.crossCenter,this.scratch));a.changed=Math.abs(angle)>.00001;this.end();}
    finally {this.kind=kind;}
  }
}
