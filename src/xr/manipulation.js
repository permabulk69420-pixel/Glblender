import * as THREE from 'three';

const _q=new THREE.Quaternion(),_a=new THREE.Vector3(),_b=new THREE.Vector3(),_rotation=new THREE.Matrix4(),_scale=new THREE.Matrix4(),_translation=new THREE.Matrix4();

// Move the initial object around the two-hand midpoint; rotation uses the hand
// baseline and scale uses its length. Rebase when a hand joins/leaves a grab.
export function twoHandMatrix(startWorld,startMid,startVector,currentA,currentB,out=new THREE.Matrix4()) {
  _a.subVectors(currentB,currentA);const ratio=THREE.MathUtils.clamp(_a.length()/Math.max(startVector.length(),.025),.05,20);
  _q.setFromUnitVectors(_b.copy(startVector).normalize(),_a.normalize());
  _b.addVectors(currentA,currentB).multiplyScalar(.5);
  out.makeTranslation(_b.x,_b.y,_b.z);
  out.multiply(_rotation.makeRotationFromQuaternion(_q));out.multiply(_scale.makeScale(ratio,ratio,ratio));
  out.multiply(_translation.makeTranslation(-startMid.x,-startMid.y,-startMid.z));out.multiply(startWorld);return {matrix:out,ratio};
}
