import './style.css';
import { Editor } from './core/Editor.js';

try { new Editor(document.querySelector('#app')); }
catch(error) {
  console.error(error);
  const panel=document.createElement('div');panel.className='startup-error';panel.style.cssText='position:fixed;inset:15%;z-index:100;background:#1b242e;padding:35px;border:1px solid #986f59;border-radius:12px;line-height:1.8';
  const title=document.createElement('h2');title.textContent='The workshop could not start.';const text=document.createElement('p');text.textContent=`${error.message}. Please enable WebGL and reload in a current browser.`;panel.append(title,text);document.body.append(panel);
}
