// Migrate the earlier localStorage snapshot once, then use IndexedDB for larger libraries.
const DB='material-atlas';
const NEW_KEY='material-atlas-v2';
const OLD_KEY='material-atlas-v1';
let connection;
async function database() {
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,2);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('workspace'))request.result.createObjectStore('workspace')};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });return connection;
}
export async function loadWorkspace() {
  try {
    const db=await database();
    const saved=await new Promise((resolve,reject)=>{const req=db.transaction('workspace').objectStore('workspace').get('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    if(saved)return saved;
  } catch(error) { console.warn('Browser database unavailable',error) }
  try {return JSON.parse(localStorage.getItem(NEW_KEY)||localStorage.getItem(OLD_KEY)||'{}')} catch {return {}}
}
let pending=Promise.resolve();
export function persistWorkspace(value,onError) {
  const snapshot=structuredClone(value);
  pending=pending.catch(()=>{}).then(async()=>{
    try {
      const db=await database();
      await new Promise((resolve,reject)=>{const req=db.transaction('workspace','readwrite').objectStore('workspace').put(snapshot,'state');req.onsuccess=resolve;req.onerror=()=>reject(req.error)});
    } catch(error) {
      try {localStorage.setItem(NEW_KEY,JSON.stringify(snapshot))}
      catch {onError?.('Browser storage is full or unavailable. Export a JSON backup now.');throw error}
    }
  });return pending;
}
