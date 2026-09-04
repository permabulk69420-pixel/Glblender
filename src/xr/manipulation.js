import * as THREE from 'three';

const _q=new THREE.Quaternion(),_a=new THREE.Vector3(),_b=new THREE.Vector3();
const _pivotToOrigin=new THREE.Matrix4(),_originToPivot=new THREE.Matrix4(),_delta=new THREE.Matrix4();
const _deltaScale=new THREE.Vector3(),_zero=new THREE.Vector3();

// Two-hand manipulation uses a fixed world-space visual pivot captured when
// the second grip joins. Controller midpoint drift is deliberately ignored:
// changing the line between the hands rotates/scales the object, while the
// chosen pivot stays planted in space even when the GLB's authored origin is
// somewhere inconveniently far from the visible geometry.
export function twoHandMatrix(startWorld,pivotWorld,startVector,currentA,currentB,out=new THREE.Matrix4()) {
  _a.subVectors(currentB,currentA);
  const ratio=THREE.MathUtils.clamp(_a.length()/Math.max(startVector.length(),.025),.05,20);
  _q.setFromUnitVectors(_b.copy(startVector).normalize(),_a.normalize());

  _deltaScale.setScalar(ratio);
  _delta.compose(_zero,_q,_deltaScale);
  _pivotToOrigin.makeTranslation(-pivotWorld.x,-pivotWorld.y,-pivotWorld.z);
  _originToPivot.makeTranslation(pivotWorld.x,pivotWorld.y,pivotWorld.z);
  out.copy(_originToPivot).multiply(_delta).multiply(_pivotToOrigin).multiply(startWorld);
  return {matrix:out,ratio};
}
