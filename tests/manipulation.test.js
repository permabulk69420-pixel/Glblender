import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { twoHandMatrix } from '../src/xr/manipulation.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const nearVector=(a,b)=>a.toArray().forEach((v,i)=>near(v,b.getComponent(i)));

test('two-hand rotation keeps the visible pivot fixed even when the authored origin is offset',()=>{
  const start=new THREE.Matrix4().compose(
    new THREE.Vector3(10,0,0),
    new THREE.Quaternion(),
    new THREE.Vector3(1,1,1)
  );
  // The visible centre is one local metre to the right of the node origin.
  const pivot=new THREE.Vector3(11,0,0);
  const startVector=new THREE.Vector3(1,0,0);
  const currentA=new THREE.Vector3(2,3,4),currentB=new THREE.Vector3(2,3,5);
  const out=new THREE.Matrix4();
  twoHandMatrix(start,pivot,startVector,currentA,currentB,out);

  const visibleCentre=new THREE.Vector3(1,0,0).applyMatrix4(out);
  nearVector(visibleCentre,pivot);
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  out.decompose(position,rotation,scale);
  assert.ok(position.distanceTo(new THREE.Vector3(10,0,0))>.5,'node origin should move as needed to keep the visible centre anchored');
  assert.ok(Math.abs(rotation.y)>.5,'expected a substantial rotation from the changed hand baseline');
});

test('moving both hands together does not translate the object',()=>{
  const start=new THREE.Matrix4().makeTranslation(.4,1.1,-.7),pivot=new THREE.Vector3(.4,1.1,-.7),startVector=new THREE.Vector3(.5,0,0);
  const out=new THREE.Matrix4();
  twoHandMatrix(start,pivot,startVector,new THREE.Vector3(7,4,-2),new THREE.Vector3(7.5,4,-2),out);
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();out.decompose(position,rotation,scale);
  nearVector(position,pivot);near(scale.x,1);
});

test('two-hand distance scales around the fixed visual pivot',()=>{
  const start=new THREE.Matrix4().compose(
    new THREE.Vector3(10,0,0),
    new THREE.Quaternion(),
    new THREE.Vector3(2,2,2)
  );
  const pivot=new THREE.Vector3(12,0,0),startVector=new THREE.Vector3(.5,0,0);
  const currentA=new THREE.Vector3(-.5,.4,.2),currentB=new THREE.Vector3(.5,.4,.2);
  const out=new THREE.Matrix4();
  const {ratio}=twoHandMatrix(start,pivot,startVector,currentA,currentB,out);
  const position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  out.decompose(position,rotation,scale);
  near(ratio,2);near(scale.x,4);
  nearVector(new THREE.Vector3(1,0,0).applyMatrix4(out),pivot);
});
