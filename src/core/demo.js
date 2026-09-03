import * as THREE from 'three';

// A real editable, exportable sample: separate named parts, metres, and a
// moderately tessellated hull/canopy so proportional edits have room to work.
export function createDemo() {
  const root = new THREE.Group(); root.name = 'Kestrel Survey Shuttle';
  const material = (name, color, metalness = .25, roughness = .4) => new THREE.MeshStandardMaterial({ name, color, metalness, roughness });
  const ceramic = material('Ceramic · warm white', '#d4d9d2', .38, .32);
  const graphite = material('Graphite · titanium', '#303d48', .7, .35);
  const orange = material('Safety · ochre', '#d4913f', .4, .36);
  const glass = new THREE.MeshPhysicalMaterial({ name: 'Canopy · smoked glass', color: '#183a43', metalness: .55, roughness: .17, clearcoat: 1, clearcoatRoughness: .13 });
  const light = material('Ion · cyan', '#70e1d3', .15, .3); light.emissive.set('#4accc3'); light.emissiveIntensity = 1.3;
  const add = (name, geometry, mat, position, parent = root) => {
    const node = new THREE.Mesh(geometry, mat); node.name = name;
    if (position) node.position.set(...position);
    parent.add(node); return node;
  };
  const section = (t, points) => {
    for (let i = 1; i < points.length; i++) if (t <= points[i][0]) {
      const [a, x] = points[i - 1], [b, y] = points[i];
      const s = (t - a) / (b - a); return THREE.MathUtils.lerp(x, y, s * s * (3 - 2 * s));
    }
    return points.at(-1)[1];
  };
  function bodyGeometry() {
    const g = new THREE.SphereGeometry(1, 40, 48);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = (z + 1) / 2;
      const width = section(t, [[0,.38],[.22,.9],[.55,1.2],[.84,1.05],[1,.7]]);
      p.setXYZ(i, x * width, y * (y > 0 ? .49 : .31), z * 2.5);
    }
    g.computeVertexNormals(); return g;
  }
  add('Hull', bodyGeometry(), ceramic, [0,.79,0]);
  const belly = add('BellyPanel', new THREE.SphereGeometry(1, 32, 20), graphite, [0,.61,.27]); belly.scale.set(.8,.22,1.97);
  const canopy = add('Canopy', new THREE.SphereGeometry(1, 36, 28, 0, Math.PI * 2, 0, Math.PI / 2), glass, [0,1.02,-.6]); canopy.scale.set(.67,.51,1.17);
  const framePoints = [];
  for (let i=0;i<=48;i++) { const a=i/48*Math.PI*2; framePoints.push(new THREE.Vector3(Math.cos(a)*.68,1.045,-.6+Math.sin(a)*1.18)); }
  add('CanopyFrame', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(framePoints), 96, .045, 8, true), graphite);
  const spine = new THREE.CatmullRomCurve3([new THREE.Vector3(0,1.06,-1.76),new THREE.Vector3(0,1.46,-1.2),new THREE.Vector3(0,1.54,-.55),new THREE.Vector3(0,1.4,.2),new THREE.Vector3(0,1.06,.56)]);
  add('CanopySpine', new THREE.TubeGeometry(spine, 64, .035, 8, false), ceramic);
  add('Dashboard', new THREE.BoxGeometry(.9,.11,.28,10,2,4), graphite, [0,1.05,-1.32]);
  const wings = new THREE.Group(); wings.name = 'WingAssembly'; root.add(wings);
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'Left' : 'Right';
    const shape = new THREE.Shape();
    shape.moveTo(.58,-.7); shape.lineTo(1.03,-.52); shape.lineTo(2.58,1.05); shape.lineTo(2.37,1.69); shape.lineTo(.69,1.22); shape.closePath();
    const wingGeometry = new THREE.ExtrudeGeometry(shape, { depth: .14, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .04, bevelThickness: .04 });
    wingGeometry.rotateX(Math.PI / 2);
    if (side < 0) { wingGeometry.scale(-1,1,1); const index=wingGeometry.index; if (!index) { const p=wingGeometry.attributes; for(const a of Object.values(p)){ for(let i=0;i<a.count;i+=3)for(let c=0;c<a.itemSize;c++){const v=a.array[(i+1)*a.itemSize+c];a.array[(i+1)*a.itemSize+c]=a.array[(i+2)*a.itemSize+c];a.array[(i+2)*a.itemSize+c]=v;}} } wingGeometry.computeVertexNormals(); }
    add(`Wing${suffix}`, wingGeometry, ceramic, [0,.77,0], wings);
    const trim = add(`WingTrim${suffix}`, new THREE.BoxGeometry(.18,.035,1.08,2,1,12), orange, [side*1.85,.815,1.05], wings); trim.rotation.y = side * -.67;
    const pod = new THREE.Group(); pod.name = `Engine${suffix}`; pod.position.set(side*1.53,.87,.95); root.add(pod);
    const housing = add(`EngineHousing${suffix}`, new THREE.CylinderGeometry(.31,.25,1.86,32,22), graphite, [0,0,0], pod); housing.rotation.x = Math.PI/2;
    const shell = add(`EngineCowl${suffix}`, new THREE.CylinderGeometry(.33,.32,1.2,32,16, true), ceramic, [0,0,-.17], pod); shell.rotation.x = Math.PI/2;
    const collar = add(`EngineCollar${suffix}`, new THREE.TorusGeometry(.313,.045,8,32), orange, [0,0,.43], pod);
    const nozzle = add(`Thruster${suffix}`, new THREE.CylinderGeometry(.17,.26,.32,32,4), graphite, [0,0,1.03], pod); nozzle.rotation.x = Math.PI/2;
    add(`IonRing${suffix}`, new THREE.TorusGeometry(.19,.03,8,32), light, [0,0,1.17], pod);
    const rail = new THREE.CatmullRomCurve3([new THREE.Vector3(side*.65,.38,-.75),new THREE.Vector3(side*.65,.13,-.45),new THREE.Vector3(side*.65,.12,.86),new THREE.Vector3(side*.65,.39,1.1)]);
    add(`LandingSkid${suffix}`, new THREE.TubeGeometry(rail,40,.047,8), graphite);
  }
  const tail = add('RearServicePanel', new THREE.BoxGeometry(.7,.06,.76,12,1,12), orange, [0,1.205,1.15]);
  const finGeometry = new THREE.BoxGeometry(.055,.64,.67,1,16,16);
  const fin = add('Stabilizer', finGeometry, graphite, [0,1.44,1.75]); fin.rotation.x = -.26;
  for(let i=0;i<5;i++) add(`CoolingVent${i+1}`, new THREE.BoxGeometry(.52,.02,.032), graphite, [0,1.247,.91+i*.115]);
  root.userData.sample = true;
  return { scene: root, animations: [] };
}
