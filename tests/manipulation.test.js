import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { twoHandMatrix } from '../src/xr/manipulation.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('two-hand rotation keeps the object pivot fixed',()=>{
  const start=new THREE.Matrix4().compose(
    new THREE.Vector3(1.2,.8,-2.4),
    new THREE.Quaternion(),
    new THREE.Vector3(1,1,1)
  );
  const startA=new THREE.Vector3(-.25,1,0),startB=new THREE.Vector3(.25,1,0);
  const startMid=startA.clone().add(startB).multiplyScalar(.5);
  const startVector=startB.clone().sub(startA);
  const currentA=new THREE.Vector3(-.25,1,0),currentB=new THREE.Vector3(-.25,1,.5);
  const out=new THREE.Matrix4();
  twoHandMatrix(start,startMid,startVector,currentA,currentB,out);
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  out.decompose(position,rotation,scale);
  near(position.x,1.2);near(position.y,.8);near(position.z,-2.4);
  assert.ok(Math.abs(rotation.y)>.5,'expected a substantial rotation from the changed hand baseline');
});

test('two-hand distance still scales without translating the object',()=>{
  const start=new THREE.Matrix4().compose(
    new THREE.Vector3(.4,1.1,-.7),
    new THREE.Quaternion(),
    new THREE.Vector3(2,2,2)
  );
  const startA=new THREE.Vector3(-.25,0,0),startB=new THREE.Vector3(.25,0,0);
  const startMid=new THREE.Vector3();
  const startVector=startB.clone().sub(startA);
  const currentA=new THREE.Vector3(-.5,.4,.2),currentB=new THREE.Vector3(.5,.4,.2);
  const out=new THREE.Matrix4();
  const {ratio}=twoHandMatrix(start,startMid,startVector,currentA,currentB,out);
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  out.decompose(position,rotation,scale);
  near(ratio,2);near(position.x,.4);near(position.y,1.1);near(position.z,-.7);near(scale.x,4);
});
