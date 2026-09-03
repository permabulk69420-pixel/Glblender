import * as THREE from 'three';

const _q=new THREE.Quaternion(),_startQ=new THREE.Quaternion(),_position=new THREE.Vector3(),_scale=new THREE.Vector3(),_a=new THREE.Vector3(),_b=new THREE.Vector3();

// Two-hand manipulation is intentionally pivoted around the object's own
// position. Adding the second grip should rotate/scale the part in place,
// rather than orbiting it around the midpoint between the controllers.
// Rebase whenever a hand joins/leaves so switching modes never jumps.
export function twoHandMatrix(startWorld,startMid,startVector,currentA,currentB,out=new THREE.Matrix4()) {
  _a.subVectors(currentB,currentA);
  const ratio=THREE.MathUtils.clamp(_a.length()/Math.max(startVector.length(),.025),.05,20);
  _q.setFromUnitVectors(_b.copy(startVector).normalize(),_a.normalize());
  startWorld.decompose(_position,_startQ,_scale);
  _startQ.premultiply(_q);
  _scale.multiplyScalar(ratio);
  out.compose(_position,_startQ,_scale);
  return {matrix:out,ratio};
}
