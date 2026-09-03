export class SessionManager {
  constructor(editor) {this.editor=editor;this.timer=null;this.saving=false;this.enabled=true;this.database=null;}
  async db() {
    if(this.database)return this.database;
    this.database=await new Promise((resolve,reject)=>{const request=indexedDB.open('glblender-workshop',1);request.onupgradeneeded=()=>request.result.createObjectStore('sessions');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return this.database;
  }
  async previous() {
    try{const db=await this.db();return await new Promise((resolve,reject)=>{const r=db.transaction('sessions').objectStore('sessions').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
    catch{this.enabled=false;this.editor.ui?.setSaveStatus('Recovery unavailable');return null;}
  }
  schedule() {if(!this.enabled)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.save(),3500);this.editor.ui?.setSaveStatus('Unsaved edits');}
  async save() {
    const e=this.editor;if(this.saving||e.interacting||e.busy){this.schedule();return;}if(!this.enabled||!e.asset.root)return;
    this.saving=true;const serial=e.asset.serial,revision=e.history.revision,filename=e.asset.filename;
    try {
      e.ui.setSaveStatus('Saving on this device…');const data=await e.exporter.binary();
      if(serial!==e.asset.serial)return;
      if(data.byteLength>80*1024*1024){e.ui.setSaveStatus('Large asset · export to save');return;}
      const db=await this.db();
      await new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put({data,filename,savedAt:Date.now()},'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
      e.ui.setSaveStatus(revision===e.history.revision?'Saved on this device':'Unsaved edits');
      if(revision!==e.history.revision)this.schedule();
    } catch(error) {this.enabled=false;e.ui.setSaveStatus('Recovery unavailable · export to save');console.warn('Session recovery:',error.message);}
    finally {this.saving=false;}
  }
  async restore(record) {clearTimeout(this.timer);await this.editor.importBuffer(record.data,record.filename);this.editor.ui.setSaveStatus('Recovered from this device');}
}
