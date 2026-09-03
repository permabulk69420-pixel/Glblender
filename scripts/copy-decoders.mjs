import { mkdirSync, copyFileSync } from 'node:fs';
for (const [folder, source, names] of [
  ['draco','draco/gltf',['draco_decoder.js','draco_decoder.wasm','draco_wasm_wrapper.js']],
  ['basis','basis',['basis_transcoder.js','basis_transcoder.wasm']],
]) {
  mkdirSync(`public/decoders/${folder}`, { recursive:true });
  for (const name of names) copyFileSync(`node_modules/three/examples/jsm/libs/${source}/${name}`,`public/decoders/${folder}/${name}`);
}
