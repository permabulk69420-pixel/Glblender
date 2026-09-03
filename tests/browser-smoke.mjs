import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createDemo } from '../src/core/demo.js';
import { ExportManager } from '../src/core/ExportManager.js';

// This is a repository CI test, run in GitHub Actions against the production
// build. It uses synthetic sample files and never accesses personal assets.
globalThis.FileReader=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.({target:this});});}
  readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.({target:this});});}
};
await mkdir('test-results',{recursive:true});
const sample=createDemo(),sourceFrame=sample.scene.getObjectByName('CanopyFrame').geometry.attributes.position.array.slice();
await writeFile('test-results/import-fixture.glb',Buffer.from(await new ExportManager({root:sample.scene,animations:[]}).binary()));
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4179','--strictPort'],{stdio:'pipe'});
let serverLog='';server.stdout.on('data',data=>serverLog+=data);server.stderr.on('data',data=>serverLog+=data);
const errors=[],checks=[];let browser,page;
try{
  let available=false;for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:4179/');if(r.ok){available=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,200));}
  assert.ok(available,`Production preview did not start: ${serverLog}`);
  browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,acceptDownloads:true});page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.setDefaultTimeout(20000);await page.goto('http://127.0.0.1:4179/',{waitUntil:'load'});
  await page.getByRole('button',{name:'Hull',exact:true}).waitFor();await page.waitForTimeout(1000);
  assert.equal(await page.locator('.startup-error').count(),0);assert.equal(await page.locator('#viewport canvas').count(),1);checks.push('Production app starts and renders its sample');
  await page.screenshot({path:'test-results/workshop-initial.png'});

  await page.locator('#file-input').setInputFiles('test-results/import-fixture.glb');
  await page.getByRole('button',{name:'Hull',exact:true}).waitFor();await page.locator('#busy-overlay').waitFor({state:'hidden'});
  assert.equal(await page.locator('#asset-name').textContent(),'import-fixture.glb');checks.push('File input imports a real binary GLB');
  await page.getByRole('button',{name:'Hull',exact:true}).click();
  await page.getByLabel('position X',{exact:true}).fill('0.35');await page.getByLabel('position X',{exact:true}).press('Tab');
  assert.equal(Number(await page.getByLabel('position X',{exact:true}).inputValue()),.35);
  await page.locator('.history-actions [data-action="undo"]').click();assert.equal(Number(await page.getByLabel('position X',{exact:true}).inputValue()),0);
  await page.locator('.history-actions [data-action="redo"]').click();assert.equal(Number(await page.getByLabel('position X',{exact:true}).inputValue()),.35);checks.push('Transform fields, undo and redo work');
  await page.locator('.inspector-tabs [data-tab="material"]').click();await page.getByLabel('Base colour hex',{exact:true}).fill('#41bca5');await page.getByLabel('Base colour hex',{exact:true}).press('Tab');
  assert.equal(await page.getByLabel('Base colour hex',{exact:true}).inputValue(),'#41bca5');checks.push('Material inspector edits a selected mesh');
  await page.screenshot({path:'test-results/material-editor.png'});

  await page.getByRole('button',{name:'CanopyFrame',exact:true}).click();await page.locator('.app-header [data-action="shape"]').click();
  await page.locator('[data-shape-tool="bend"]').click();await page.locator('[data-shape-axis="Z"]').click();
  await page.getByLabel('Bend angle',{exact:true}).fill('25');await page.locator('[data-action="apply-bend"]').click();
  await page.locator('[data-action="lock"]').click();assert.equal(await page.getByLabel('Bend angle',{exact:true}).isDisabled(),true);await page.locator('[data-action="lock"]').click();
  await page.locator('[data-action="isolate"]').click();checks.push('Shape controls, bend, isolation and locking work');
  await page.screenshot({path:'test-results/shape-editor.png'});

  const pending=page.waitForEvent('download');await page.locator('.app-header [data-action="export"]').click();const download=await pending;assert.equal(download.suggestedFilename(),'import-fixture-edited.glb');await download.saveAs('test-results/roundtrip.glb');
  const bytes=await readFile('test-results/roundtrip.glb'),loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const hull=loaded.scene.getObjectByName('Hull'),frame=loaded.scene.getObjectByName('CanopyFrame');assert.ok(hull&&frame);assert.ok(Math.abs(hull.position.x-.35)<1e-5);assert.equal(hull.material.color.getHexString(),'41bca5');
  assert.ok(frame.geometry.attributes.position.array.some((v,i)=>Math.abs(v-sourceFrame[i])>1e-4));assert.ok(loaded.scene.getObjectByName('EngineHousingLeft'));checks.push('Exported GLB contains real transformed, recoloured and bent data, including isolated-away parts');

  await page.locator('#file-input').setInputFiles('test-results/roundtrip.glb');await page.locator('#busy-overlay').waitFor({state:'hidden'});await page.getByRole('button',{name:'Hull',exact:true}).click();await page.locator('.app-header [data-action="object"]').click();
  await page.locator('.inspector-tabs [data-tab="transform"]').click();assert.equal(Number(await page.getByLabel('position X',{exact:true}).inputValue()),.35);checks.push('The edited GLB reimports correctly');
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent==='Saved on this device',null,{timeout:20000});
  await page.reload({waitUntil:'load'});await page.locator('[data-action="recover"]').waitFor();await page.locator('[data-action="recover"]').click();await page.locator('#busy-overlay').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Hull',exact:true}).click();await page.locator('.inspector-tabs [data-tab="transform"]').click();assert.equal(Number(await page.getByLabel('position X',{exact:true}).inputValue()),.35);checks.push('IndexedDB restores the last edited asset after reload');
  await page.locator('.inspector-tabs [data-tab="material"]').click();await page.waitForTimeout(300);await page.screenshot({path:'test-results/workshop-final.png'});
  await page.setViewportSize({width:390,height:844});await page.locator('[data-action="inspector-panel"]').click();await page.screenshot({path:'test-results/mobile-inspector.png'});
  assert.equal(await page.locator('.inspector-panel').isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push('Phone layout exposes import and inspector without horizontal overflow');
  assert.deepEqual(errors,[]);checks.push('No JavaScript runtime errors or console errors');
  await writeFile('test-results/results.json',JSON.stringify({passed:true,checks,errors},null,2));console.log(checks.map(c=>'PASS '+c).join('\n'));
}catch(error){
  await writeFile('test-results/results.json',JSON.stringify({passed:false,error:error.stack,checks,errors,serverLog},null,2));
  if(page){await page.screenshot({path:'test-results/failure.png'}).catch(()=>{});await writeFile('test-results/failure.html',await page.content().catch(()=>''));}
  throw error;
}finally{await browser?.close();server.kill('SIGTERM');}
