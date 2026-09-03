export function smoothFalloff(distance,radius,exponent=1) {
  if(radius<=0||distance>=radius)return 0;
  const t=1-Math.max(0,distance/radius);return Math.pow(t*t*(3-2*t),exponent);
}

// Constant-curvature bend along an axis. The minimum end is anchored and the
// neutral axis keeps its arc length. For k -> 0 use the original coordinates.
export function bendPoint(x,y,z,axis,angle,min,length,crossCenter,out) {
  out[0]=x;out[1]=y;out[2]=z;
  if(Math.abs(angle)<1e-5||length<1e-7)return out;
  const radial=(axis+1)%3,u=out[axis]-min,v=out[radial]-crossCenter;
  const k=angle/length,theta=k*u,r=1/k;
  out[axis]=min+Math.sin(theta)*(r+v);
  out[radial]=crossCenter+Math.cos(theta)*(r+v)-r;
  return out;
}
