let worker;
let sequence = 0;
const waiting = new Map();

export function analyseInPython(payload) {
  worker ??= new Worker(new URL('./python-worker.js', import.meta.url), {type:'module'});
  worker.onmessage = ({data}) => {
    const pending = waiting.get(data.id);
    if (!pending) return;
    waiting.delete(data.id);
    data.error ? pending.reject(Error(data.error)) : pending.resolve(data.result);
  };
  worker.onerror = event => {
    for (const pending of waiting.values()) pending.reject(Error(event.message || 'Python worker failed.'));
    waiting.clear(); worker.terminate(); worker = undefined;
  };
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    waiting.set(id, {resolve, reject});
    worker.postMessage({id, payload});
  });
}
