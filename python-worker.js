// Load Python only when the user requests scientific analysis. Work off the UI thread.
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/';
let engine;

async function start() {
  const [{loadPyodide}, source] = await Promise.all([
    import(`${PYODIDE_BASE}pyodide.mjs`),
    fetch(new URL('./python/material_atlas_core.py', import.meta.url)).then(response => {
      if (!response.ok) throw Error('Could not load the Python analysis module.');
      return response.text();
    })
  ]);
  const pyodide = await loadPyodide({indexURL: PYODIDE_BASE});
  pyodide.FS.writeFile('material_atlas_core.py', source);
  pyodide.runPython('import material_atlas_core');
  return pyodide;
}

self.onmessage = async ({data}) => {
  try {
    engine ??= start();
    const pyodide = await engine;
    pyodide.globals.set('atlas_request', JSON.stringify(data.payload));
    const result = pyodide.runPython('material_atlas_core.analyse_json(atlas_request)');
    pyodide.globals.delete('atlas_request');
    self.postMessage({id:data.id, result:JSON.parse(result)});
  } catch (error) {
    engine = undefined; // retry loading on the next request after a network failure
    self.postMessage({id:data.id, error:error.message || String(error)});
  }
};
