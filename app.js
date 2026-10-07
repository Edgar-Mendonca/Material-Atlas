import { PROPERTIES, SEED } from './data.js';
import { COLUMNS, NUMBERS, EXAMPLE, UNITS, guessColumn, parseCSV, writeCSV, readXLSX, makeXLSXTemplate } from './library-io.js';
import { PRESETS, indexValue, indexLineY, derived } from './selection.js';
import { loadWorkspace, persistWorkspace, clearWorkspace } from './storage.js';
import { buildHistogram, validWindow } from './plot-math.js';
import { analyseInPython } from './python-analysis.js';

const FAMILIES = ['Metals', 'Polymers', 'Elastomers', 'Foams', 'Ceramics', 'Composites', 'Natural', 'Other'];
const COLORS = { Metals: '#2563eb', Polymers: '#c05c91', Elastomers:'#c27639', Foams:'#8b6ab9', Ceramics: '#af8547', Composites: '#6555b3', Natural: '#479272', Other: '#798998' };
const transparentColor=(hex,alpha)=>`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${alpha})`;
const $ = (s, root = document) => root.querySelector(s);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const VERSION = '2.3.0';
const base = { custom: [], deletedSeeds: [], favorites: [], compared: [], families: [], limits: [], process: '', standard:'', productForm:'', chartX: 'density', chartY: 'modulus', chartLogX: true, chartLogY: true, chartTitle:'', chartNote:'', showEnvelopes:false, showLabels:false, showExcluded:true, chartType:'scatter', chartWindow:null, chartBins:10, annotations:[], chartSelected:[], rankA: 'density', rankB: 'modulus', weightA: 50, view: 'home', indexPreset:'', indexLevel:50, indexFilter:false, projects:[], activeProjectId:'' };
let state = structuredClone(base);
let search = '', sort = 'name', editing = null, tooltipTimer, importDraft=null, reportOpen=false, thresholdMemo=null, plotHost=null, plotResize=null, chartGeneration=0, chartHistory=[];
let pythonResult=null, analysisGeneration=0;
const CHART_PRESETS = [
  {label:'Stiffness / weight',x:'density',y:'modulus',logX:true,logY:true},
  {label:'Tensile / weight',x:'density',y:'tensile',logX:true,logY:true},
  {label:'Cost / stiffness',x:'cost',y:'modulus',logX:true,logY:true},
  {label:'Thermal service',x:'temp',y:'thermal',logX:false,logY:true},
  {label:'Carbon / strength',x:'carbon',y:'tensile',logX:true,logY:true}
];
const properties = Object.keys(PROPERTIES);
const searchText = m => [m.name,m.family,m.subtype,m.grade_condition,m.standard,m.product_form,m.composition,...m.processes].join(' ').toLowerCase();
const dataStatus = m => m.origin==='sample'?'Illustrative sample':`${evidenceLabel(m)} · ${m.source?'source supplied':'source missing'}`;
const evidenceLabel = m => m.origin==='sample'?'Illustrative':({supplier:'Supplier stated',test:'Test report',reference:'Published reference',unverified:'User entered'}[m.evidence_level]||'Unclassified');
function similarMaterials(target){
  const keys=['density','modulus','yield','tensile','thermal','temp'];
  return materials().filter(m=>m.id!==target.id&&m.family===target.family).map(m=>{
    const common=keys.filter(k=>m[k]>0&&target[k]>0);
    if(common.length<3)return null;
    const distance=common.reduce((sum,k)=>sum+Math.min(2,Math.abs(Math.log(m[k]/target[k]))),0)/common.length;
    return {m,common:common.length,score:Math.round(100*Math.exp(-distance))};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||b.common-a.common).slice(0,3);
}
const fmt = (n, key) => n == null || !Number.isFinite(Number(n)) ? '—' : `${new Intl.NumberFormat('en-US',{maximumFractionDigits: key === 'carbon' || key === 'cost' ? 2 : 1}).format(n)} ${PROPERTIES[key].unit}`;
const materials = () => [...SEED.filter(m => !state.deletedSeeds.includes(m.id)), ...state.custom];
const selected = () => materials().filter(m => state.compared.includes(m.id));
function sanitizePlotState(){
  state.chartType=['scatter','histogram'].includes(state.chartType)?state.chartType:'scatter';
  state.chartBins=Math.max(4,Math.min(30,Number(state.chartBins)||10));
  state.showEnvelopes=state.showEnvelopes===true;state.showLabels=state.showLabels===true;
  state.showExcluded=state.showExcluded!==false;
  const w=state.chartWindow;
  state.chartWindow=validWindow(w)?w:null;
  state.annotations=Array.isArray(state.annotations)?state.annotations.filter(a=>a&&Number.isFinite(a.x)&&Number.isFinite(a.y)&&typeof a.text==='string').slice(0,12).map(a=>({x:a.x,y:a.y,text:a.text.slice(0,60)})):[];
  state.chartSelected=Array.isArray(state.chartSelected)?state.chartSelected.filter(id=>typeof id==='string').slice(0,1500):[];
}
function save() { thresholdMemo=null; pythonResult=null; analysisGeneration++; persistWorkspace(state,toast); }
function toast(msg) { const e = $('#toast'); e.textContent = msg; e.classList.add('show'); clearTimeout(tooltipTimer); tooltipTimer = setTimeout(() => e.classList.remove('show'), 3500); }
function stageChecks(m) {
  const checks=[];
  if(state.families.length)checks.push({label:'Family',pass:state.families.includes(m.family),detail:m.family});
  if(state.process)checks.push({label:'Process',pass:m.processes.some(p=>p.toLowerCase()===state.process.toLowerCase()),detail:m.processes.join(', ')||'Missing'});
  if(state.standard)checks.push({label:'Standard',pass:m.standard===state.standard,detail:m.standard||'Missing'});
  if(state.productForm)checks.push({label:'Product form',pass:m.product_form===state.productForm,detail:m.product_form||'Missing'});
  for(const l of state.limits){
    const bound=l.value===''?NaN:Number(l.value),v=m[`${l.key}_${l.op}`]??m[l.key];
    const pass=Number.isFinite(bound)&&Number.isFinite(v)&&(l.op==='min'?v>=bound:v<=bound);
    checks.push({label:`${PROPERTIES[l.key]?.label||l.key} ${l.op==='min'?'≥':'≤'} ${l.value} ${PROPERTIES[l.key]?.unit||''}`,pass,detail:Number.isFinite(v)?`${v} ${PROPERTIES[l.key]?.unit||''}`:'Missing'});
  }
  if(state.indexFilter&&PRESETS[state.indexPreset]){
    const v=indexValue(m,PRESETS[state.indexPreset]);
    checks.push({label:`Index ${PRESETS[state.indexPreset].formula}`,pass:v!=null&&v>=currentIndexThreshold(),detail:v==null?'Missing input':v.toPrecision(4)});
  }
  return checks;
}
function matches(m) {return stageChecks(m).every(c=>c.pass)}
function currentIndexThreshold() {
  if(thresholdMemo!==null)return thresholdMemo;
  const preset=PRESETS[state.indexPreset];if(!preset)return 0;
  const nums=materials().map(m=>indexValue(m,preset)).filter(v=>v>0);
  if(!nums.length)return 0;
  const low=Math.min(...nums),high=Math.max(...nums);
  thresholdMemo=low*Math.pow(high/low,Math.max(0,Math.min(100,state.indexLevel))/100);
  return thresholdMemo;
}
const passing = () => materials().filter(matches);
function reasons(m){return stageChecks(m).filter(c=>!c.pass).map(c=>`${c.label} (value: ${c.detail})`)}
function setView(v) {
  state.view = v;
  if(v!=='chart')chartSelectionRange=null;
  if (window.innerWidth <= 850) {
    $('.sidebar').classList.remove('filters-open');
    $('#mobileFilterToggle').setAttribute('aria-expanded', 'false');
  }
  save(); render(); $('#main').focus({preventScroll:true});
}
function disposeChart(){chartGeneration++;plotResize?.disconnect();plotResize=null;if(plotHost&&window.Plotly)Plotly.purge(plotHost);plotHost=null}
function render() {
  if(state.view!=='chart'&&plotHost)disposeChart();
  document.querySelectorAll('.tooltip').forEach(el => el.remove());
  state.compared = state.compared.filter(id => materials().some(m => m.id === id)).slice(0,4);
  document.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active',t.dataset.view === state.view); t.setAttribute('aria-current', t.dataset.view === state.view ? 'page' : 'false'); });
  const meta = {
    home: ['MATERIAL ATLAS','Welcome','An independent workspace for traceable material selection.'],
    explore: ['MATERIAL EXPLORER','Explore materials','Search, screen, and inspect material records.'],
    chart: ['VISUAL SELECTION','Selection chart','Compare properties, explore indices and export publication-ready plots.'],
    results: ['SELECTION RESULTS','Stage results','See why each material passes or fails the active requirements.'],
    compare: ['SHORTLIST','Compare & rank','Review up to four candidates side by side.'],
    library: ['PERSONAL RECORDS','My library','Import your data and keep selection projects on this device.'],
    about: ['ABOUT MATERIAL ATLAS','About the app','An independent open-source workspace for material selection.']
  }[state.view];
  $('#viewEyebrow').textContent = meta[0]; $('#viewTitle').textContent = meta[1]; $('#viewDescription').textContent = meta[2];
  $('.shell').classList.toggle('home-mode',state.view==='home');
  $('.shell').classList.toggle('chart-mode',state.view==='chart');
  $('#remainingCount').textContent = passing().length;
  $('#resultCount').textContent = `${passing().length} / ${materials().length} pass`;
  $('#compareCount').textContent = `${state.compared.length} / 4 compared`;
  const activeStages = state.families.length + state.limits.length + Number(Boolean(state.process)) + Number(Boolean(state.standard)) + Number(Boolean(state.productForm)) + Number(state.indexFilter);
  $('#mobileStageSummary').textContent = activeStages ? `${activeStages} active · ${passing().length} pass` : `${materials().length} materials`;
  renderSidebar();
  ['home','explore','chart','results','compare','library','about'].forEach(v => $(`#${v}View`).hidden = v !== state.view);
  ({home:renderHome,explore:renderExplore,chart:renderChart,results:renderResults,compare:renderCompare,library:renderLibrary,about:renderAbout})[state.view]();
}
function renderHome(){
  $('#homeView').innerHTML=`<div class="home-hero"><div><span class="home-kicker">MATERIAL ATLAS <span>VERSION ${VERSION}</span></span><h1>Explore materials.<br><em>Explain the choice.</em></h1><p>A browser-based engineering workspace for screening material properties, comparing candidates and documenting the assumptions behind a selection.</p><div class="home-actions"><button class="button primary" data-view="explore">Open material explorer</button><button class="button outline" data-view="chart">Open selection chart</button></div><p class="home-credit">Created by <strong>Edgar Mendonca</strong> with development assistance from <strong>OpenAI GPT-6 Sol</strong>.</p></div><div class="home-diagram" aria-label="Selection workflow"><div class="home-step"><span>01</span><strong>Define</strong><small>Set properties and constraints</small></div><div class="home-step"><span>02</span><strong>Explore</strong><small>Inspect charts and ranges</small></div><div class="home-step"><span>03</span><strong>Decide</strong><small>Compare evidence and export</small></div></div></div><div class="home-lower"><article class="panel"><span class="eyebrow">YOUR WORKSPACE</span><h2>Continue with your materials</h2><p><strong>${materials().length}</strong> records available · <strong>${passing().length}</strong> pass the current stages · <strong>${state.projects.length}</strong> saved selection projects</p><div class="home-quick"><button class="tiny-button" data-view="results">Review stage results</button><button class="tiny-button" data-view="library">Manage library</button></div></article><article class="panel"><span class="eyebrow">DATA NOTE</span><h2>Know what a record represents</h2><p>The ${SEED.length} bundled records are illustrative. Add a specific grade, condition, test temperature and source before using a value as engineering evidence.</p><button class="text-button" data-view="about">About the app</button></article></div>`;
}
function renderResults(){
  const all=materials(),active=all.filter(matches),fail=all.filter(m=>!matches(m));
  const stages=stageChecks(all[0]||{}).map((c,i)=>({label:c.label,pass:all.filter(m=>stageChecks(m)[i]?.pass).length}));
  const analysis=pythonResult?.result;
  const pythonHTML=analysis?`<p><strong>${analysis.passing} / ${analysis.total}</strong> pass the Python screening rules. ${pythonResult.agrees?'Matches the selection above.':'A calculation difference was found; review the inputs before using these results.'}</p><p>Performance index: <strong>${escapeHTML(analysis.formula)}</strong> · SI units · ${escapeHTML(analysis.preset.replaceAll('_',' '))}</p>${analysis.ranking.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Passing material</th><th>Index value</th></tr></thead><tbody>${analysis.ranking.slice(0,10).map((row,i)=>`<tr><td>${i+1}</td><td><button class="name-button" data-open="${escapeHTML(row.id)}">${escapeHTML(row.name)}</button></td><td>${Number(row.index).toPrecision(4)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No passing material has the properties required for this index.</p>'}<p class="muted">Illustrative data and comparative indices; verify grade, condition and source before engineering use.</p>`:'<p>Run the same selection stages in the new Python engine and rank passing records by the chosen performance index. Python downloads on first use; an internet connection is needed.</p>';
  $('#resultsView').innerHTML=`<div class="results-overview panel"><div><span class="eyebrow">CURRENT SELECTION</span><h2>${active.length} of ${all.length} materials pass</h2><p>Each stage is evaluated independently below. A material must pass every active stage to enter the shortlist.</p></div><div class="results-actions"><button class="button outline" data-action="resultsCSV">Export results CSV</button><button class="button primary" data-action="selectionReport">${reportOpen?'Hide report':'Selection report'}</button></div></div><div class="stage-grid">${stages.map(s=>`<div class="panel stage-tile"><span>${escapeHTML(s.label)}</span><strong>${s.pass} / ${all.length}</strong><small>pass this requirement</small></div>`).join('')||'<div class="panel stage-tile"><strong>No stages set</strong><span>Add limits in Selection filters to screen candidates.</span></div>'}</div><div class="panel results-table"><div class="section-heading"><h2>Python analysis</h2><button class="button outline" data-action="runPythonAnalysis">${analysis?'Recalculate':'Run Python analysis'}</button></div><div id="pythonAnalysisStatus" role="status" aria-live="polite">${pythonHTML}</div></div><div class="panel results-table"><div class="section-heading"><h2>Material outcomes</h2><span class="pill-count">${active.length} pass · ${fail.length} excluded</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Material</th><th>Outcome</th><th>Evidence</th><th>Stage details</th></tr></thead><tbody>${[...active,...fail].map(m=>`<tr><td><button class="name-button" data-open="${escapeHTML(m.id)}">${escapeHTML(m.name)}</button><span class="subtext">${escapeHTML(m.grade_condition||m.subtype||'Condition unspecified')}</span></td><td><span class="result-status ${matches(m)?'passed':'failed'}">${matches(m)?'Pass':'Excluded'}</span></td><td>${escapeHTML(evidenceLabel(m))}</td><td><div class="result-checks">${stageChecks(m).map(c=>`<span class="check-chip ${c.pass?'passed':'failed'}" title="Value: ${escapeHTML(c.detail)}">${c.pass?'✓':'×'} ${escapeHTML(c.label)} <small>${escapeHTML(c.detail)}</small></span>`).join('')||'<span class="muted">No active stages</span>'}</div></td></tr>`).join('')}</tbody></table></div></div>${reportOpen?selectionReportHTML(active,stages):''}`;
}
async function runPythonAnalysis(button){
  button.disabled=true;
  $('#pythonAnalysisStatus').textContent='Loading Python and analysing materials…';
  const generation=analysisGeneration, all=materials();
  const settings=Object.fromEntries(['families','limits','process','standard','productForm','indexPreset','indexLevel','indexFilter'].map(key=>[key,state[key]]));
  try {
    const result=await analyseInPython({materials:all,settings});
    if(generation!==analysisGeneration||state.view!=='results')return;
    const browserPass=new Set(all.filter(matches).map(m=>m.id));
    const agrees=result.outcomes.length===all.length&&result.outcomes.every(row=>row.pass===browserPass.has(row.id));
    pythonResult={result,agrees};renderResults();
  } catch(error) {
    if(generation!==analysisGeneration||state.view!=='results')return;
    button.disabled=false;
    $('#pythonAnalysisStatus').textContent=`Python analysis could not start: ${error.message}. Check your connection and try again.`;
  }
}
function selectionReportHTML(active,stages){
  const project=state.projects.find(p=>p.id===state.activeProjectId),preset=PRESETS[state.indexPreset];
  return `<article class="panel selection-report" id="selectionReport"><div class="report-top"><div><span class="eyebrow">MATERIAL ATLAS · VERSION ${VERSION}</span><h2>Material selection report</h2><p>${escapeHTML(project?.name||'Current selection')} · ${new Date().toLocaleDateString()}</p></div><button class="button outline print-control" id="printReport">Print / save PDF</button></div><p><strong>Design objective:</strong> ${escapeHTML(project?.objective||'No project objective saved. Add one using Save project.')}</p><p><strong>Selection stages:</strong> ${stages.map(s=>escapeHTML(s.label)).join(' · ')||'None applied'}</p>${preset?`<p><strong>Performance index:</strong> ${escapeHTML(preset.formula)} — ${escapeHTML(preset.assumption)} ${state.indexFilter?'Threshold included as a selection stage.':'Displayed for reference only.'}</p>`:''}<h3>Passing candidates (${active.length})</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Material and condition</th><th>Evidence</th><th>Source / revision</th><th>Density</th><th>Modulus</th><th>Yield</th></tr></thead><tbody>${active.slice(0,100).map(m=>`<tr><td>${escapeHTML(m.name)}<span class="subtext">${escapeHTML(m.grade_condition||'Condition unspecified')}</span></td><td>${escapeHTML(evidenceLabel(m))}</td><td>${escapeHTML(m.source||'Missing')} · ${escapeHTML(m.source_revision||'No revision')}</td><td>${fmt(m.density,'density')}</td><td>${fmt(m.modulus,'modulus')}</td><td>${fmt(m.yield,'yield')}</td></tr>`).join('')}</tbody></table></div>${active.length>100?'<p>Showing the first 100 candidates. Export the full results CSV for all records.</p>':''}<p class="report-note">Bundled examples are illustrative. Evidence labels are user supplied and do not validate a property. Check the material grade, condition, service environment, source and applicable standards before design use.</p></article>`;
}
function renderSidebar() {
  $('#familyFilters').innerHTML = FAMILIES.map(f => `<label class="check-row"><span><input type="checkbox" data-family="${f}" ${state.families.includes(f)?'checked':''}>${f}</span><span class="pill-count">${materials().filter(m => m.family === f).length}</span></label>`).join('');
  const processes = [...new Set(materials().flatMap(m => m.processes))].sort((a,b)=>a.localeCompare(b));
  $('#processFilter').innerHTML = '<option value="">Any process</option>' + processes.map(p=>`<option value="${escapeHTML(p)}" ${state.process===p?'selected':''}>${escapeHTML(p)}</option>`).join('');
  for(const [id,key] of [['standardFilter','standard'],['formFilter','product_form']]) {
    const current=id==='standardFilter'?state.standard:state.productForm;
    const options=[...new Set(materials().map(m=>m[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    $(`#${id}`).innerHTML=`<option value="">Any ${id==='standardFilter'?'standard':'product form'}</option>`+options.map(v=>`<option value="${escapeHTML(v)}" ${current===v?'selected':''}>${escapeHTML(v)}</option>`).join('');
  }
  $('#limits').innerHTML = state.limits.map((l,i) => `<div class="limit-row"><div class="limit-top"><select aria-label="Property for limit ${i+1}" data-limit="${i}" data-part="key">${properties.map(k=>`<option value="${k}" ${l.key===k?'selected':''}>${PROPERTIES[k].label}</option>`).join('')}</select><button class="icon-button" aria-label="Remove limit ${i+1}" data-remove-limit="${i}">×</button></div><div class="limit-bottom"><select aria-label="Limit direction ${i+1}" data-limit="${i}" data-part="op"><option value="min" ${l.op==='min'?'selected':''}>At least</option><option value="max" ${l.op==='max'?'selected':''}>At most</option></select><input type="number" step="any" aria-label="Limit value ${i+1}" data-limit="${i}" data-part="value" value="${escapeHTML(l.value)}" placeholder="${PROPERTIES[l.key]?.unit||''}"></div></div>`).join('') || '<p class="muted" style="font-size:.78rem">No property limits added.</p>';
}
function renderExplore() {
  let rows = passing().filter(m => searchText(m).includes(search.toLowerCase()));
  rows.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'family' ? a.family.localeCompare(b.family)||a.name.localeCompare(b.name) : (Number.isFinite(a[sort])?a[sort]:Infinity)-(Number.isFinite(b[sort])?b[sort]:Infinity));
  const compareButton = m => `<button class="tiny-button ${state.compared.includes(m.id)?'selected':''}" data-compare="${escapeHTML(m.id)}">${state.compared.includes(m.id)?'✓ Added':'+ Compare'}</button>`;
  const empty = '<div class="empty"><strong>No matching materials</strong>Adjust your selection stages or search.</div>';
  const tableRows = rows.map(m => `<tr><td><button class="name-button" data-open="${escapeHTML(m.id)}">${escapeHTML(m.name)}</button><span class="subtext">${escapeHTML(m.grade_condition||m.subtype||'Condition unspecified')} · ${escapeHTML(dataStatus(m))}</span></td><td><span class="family-chip chip-${escapeHTML(m.family)}">${escapeHTML(m.family)}</span></td><td>${fmt(m.density,'density')}</td><td>${fmt(m.modulus,'modulus')}</td><td>${fmt(m.yield,'yield')}</td><td>${fmt(m.cost,'cost')}</td><td>${compareButton(m)}</td></tr>`).join('');
  const cards = rows.map(m => `<article class="mobile-material-card"><div class="mobile-card-top"><div><button class="name-button" data-open="${escapeHTML(m.id)}">${escapeHTML(m.name)}</button><span class="subtext">${escapeHTML(m.grade_condition||m.subtype||'Condition unspecified')} · ${escapeHTML(dataStatus(m))}</span></div><span class="family-chip chip-${escapeHTML(m.family)}">${escapeHTML(m.family)}</span></div><div class="mobile-properties"><div><span>Density</span><strong>${fmt(m.density,'density')}</strong></div><div><span>Modulus</span><strong>${fmt(m.modulus,'modulus')}</strong></div><div><span>Yield</span><strong>${fmt(m.yield,'yield')}</strong></div><div><span>Cost*</span><strong>${fmt(m.cost,'cost')}</strong></div></div><div class="mobile-card-actions">${compareButton(m)}<button class="text-button" data-open="${escapeHTML(m.id)}">Full record →</button></div></article>`).join('');
  $('#exploreView').innerHTML = `<div class="panel"><div class="toolbar"><input id="searchBox" class="search" type="search" value="${escapeHTML(search)}" placeholder="Search name, family, process…" aria-label="Search materials"><select id="sortBox" aria-label="Sort materials"><option value="name" ${sort==='name'?'selected':''}>Name A–Z</option><option value="family" ${sort==='family'?'selected':''}>Family</option><option value="density" ${sort==='density'?'selected':''}>Density: low first</option><option value="cost" ${sort==='cost'?'selected':''}>Cost: low first</option><option value="carbon" ${sort==='carbon'?'selected':''}>Carbon: low first</option></select><button class="button outline" data-action="exportCSV">Export visible CSV</button></div><div class="table-wrap explore-table-wrap"><table class="data-table"><thead><tr><th>Material / condition</th><th>Family</th><th>Density</th><th>Modulus</th><th>Yield</th><th>Cost*</th><th>Compare</th></tr></thead><tbody>${tableRows}</tbody></table>${rows.length?'':empty}</div><div class="mobile-material-list">${cards || empty}</div></div><p class="foot-note">* Indicative example values only. Open a record for its source and limitations.</p>`;
}
function chartOption(key){return properties.map(k=>`<option value="${k}" ${state[key]===k?'selected':''}>${escapeHTML(PROPERTIES[k].label)} · ${escapeHTML(PROPERTIES[k].unit)}</option>`).join('')}
function renderChart(){
  const optionsOpen=$('#chartOptions')?.open??false,indexOpen=$('#chartIndex')?.open??false;
  disposeChart();
  const active=passing(),selectedIds=new Set(state.chartSelected),preset=PRESETS[state.indexPreset];
  $('#chartView').innerHTML=`<div class="chart-workspace">
    <div class="chart-workspace-top"><div><span class="eyebrow">CHART WORKSPACE · ${active.length} OF ${materials().length} PASS</span><h2>Explore the material space</h2></div><button class="tiny-button" data-action="saveProject">Save selection project</button></div>
    <div class="chart-preset-row" role="group" aria-label="Suggested property charts">${CHART_PRESETS.map((p,i)=>`<button class="chart-preset ${state.chartType==='scatter'&&state.chartX===p.x&&state.chartY===p.y?'active':''}" data-chart-preset="${i}" aria-pressed="${state.chartType==='scatter'&&state.chartX===p.x&&state.chartY===p.y}">${p.label}</button>`).join('')}</div>
    <div class="chart-primary-controls"><label class="control">View<select id="chartType"><option value="scatter" ${state.chartType==='scatter'?'selected':''}>Property map</option><option value="histogram" ${state.chartType==='histogram'?'selected':''}>Distribution</option></select></label><label class="control">X property<select id="chartX">${chartOption('chartX')}</select></label>${state.chartType==='scatter'?`<label class="control">Y property<select id="chartY">${chartOption('chartY')}</select></label><button class="tiny-button" data-action="chartBack" ${chartHistory.length?'':'disabled'}>Back</button><button class="tiny-button" data-action="chartAxis">Axis limits</button><button class="tiny-button" data-action="chartFit">Fit data</button>`:''}</div>
    <div class="chart-main-grid"><div class="chart-visual panel"><div class="chart-visual-head"><div><strong>${escapeHTML(state.chartTitle|| (state.chartType==='histogram'?PROPERTIES[state.chartX].label+' distribution':PROPERTIES[state.chartY].label+' vs '+PROPERTIES[state.chartX].label))}</strong><span>${state.chartType==='histogram'?`${active.length} passing records`:`${selectedIds.size?`${selectedIds.size} graph-selected · `:''}${active.length} passing · ${materials().length-active.length} excluded`}</span></div><div class="chart-export"><button class="tiny-button" data-action="chartSVG">SVG</button><button class="tiny-button" data-action="chartPNG">PNG</button><button class="tiny-button" data-action="chartData">Data CSV</button></div></div><div id="plotlyChart" class="plotly-chart" role="img" aria-label="Interactive material property chart"></div><div class="chart-plot-hint">Drag to zoom. Use the graph toolbar for pan or box selection. Hover to inspect a material; click a point for its record.</div></div>
    <aside class="chart-shortlist panel"><div class="chart-shortlist-head"><span class="eyebrow">${selectedIds.size?'GRAPH SELECTION':'PASSING MATERIALS'}</span><h3>${selectedIds.size?`${selectedIds.size} selected`:`${active.length} candidates`}</h3><p>${selectedIds.size?'Selected points are linked to the rows below.':'Box-select points to build a focused list.'}</p></div><div class="chart-shortlist-actions"><button class="tiny-button" data-action="clearChartSelection" ${selectedIds.size?'':'disabled'}>Clear selection</button><button class="tiny-button" data-action="applyPlotSelection" ${chartSelectionRange?'':'disabled'} title="Create property limits from a rectangular graph selection">Use box as limits</button></div><div id="chartShortlistRows" class="chart-shortlist-rows"></div></aside></div>
    <div class="chart-secondary"><details id="chartOptions" class="chart-settings panel" ${optionsOpen?'open':''}><summary>Plot settings <small>Scale, labels and appearance</small></summary><div class="chart-settings-grid"><label class="check-row"><span><input type="checkbox" id="chartLogX" ${state.chartLogX?'checked':''}>Logarithmic X</span></label>${state.chartType==='scatter'?`<label class="check-row"><span><input type="checkbox" id="chartLogY" ${state.chartLogY?'checked':''}>Logarithmic Y</span></label><label class="check-row"><span><input type="checkbox" id="showExcluded" ${state.showExcluded?'checked':''}>Show excluded points</span></label><label class="check-row"><span><input type="checkbox" id="showEnvelopes" ${state.showEnvelopes?'checked':''}>Family envelopes</span></label><label class="check-row"><span><input type="checkbox" id="showLabels" ${state.showLabels?'checked':''}>Label passing points</span></label>`:`<label class="control">Bins<input type="number" id="chartBins" min="4" max="30" value="${state.chartBins}"></label>`}<label class="control">Title<input id="chartTitle" maxlength="120" value="${escapeHTML(state.chartTitle)}" placeholder="Optional chart title"></label><label class="control">Source / project note<input id="chartNote" maxlength="160" value="${escapeHTML(state.chartNote)}" placeholder="Appears on exported plot"></label><button class="tiny-button" data-action="clearChartNotes" ${state.annotations.length?'':'disabled'}>Clear point notes (${state.annotations.length})</button></div></details>
    <details id="chartIndex" class="chart-settings panel" ${indexOpen?'open':''}><summary>Performance index <small>${preset?escapeHTML(preset.formula):'Optional design case'}</small></summary><div class="chart-index-grid"><label class="control">Function and constraint<select id="indexPreset"><option value="">None</option>${Object.entries(PRESETS).map(([key,p])=>`<option value="${key}" ${state.indexPreset===key?'selected':''}>${escapeHTML(p.name)}</option>`).join('')}</select></label>${preset?`<label class="control">Threshold · <strong id="thresholdLabel">${state.indexLevel}%</strong><input id="indexLevel" type="range" min="0" max="100" value="${state.indexLevel}"></label><label class="check-row"><span><input type="checkbox" id="indexFilter" ${state.indexFilter?'checked':''}>Use threshold as selection stage</span></label><p>${escapeHTML(preset.assumption)} Line appears when density and ${escapeHTML(PROPERTIES[preset.property].label)} are plotted.</p>`:''}</div></details></div></div>`;
  renderChartShortlist();
  renderPlotlyChart();
}
let chartSelectionRange=null;
function renderChartShortlist(){
  const holder=$('#chartShortlistRows');if(!holder)return;
  const selection=new Set(state.chartSelected);
  const list=(selection.size?materials().filter(m=>selection.has(m.id)):passing()).sort((a,b)=>a.name.localeCompare(b.name));
  holder.innerHTML=list.slice(0,60).map(m=>`<div class="chart-candidate"><div><span class="chart-candidate-dot" style="background:${COLORS[m.family]||COLORS.Other}"></span><button class="name-button" data-open="${escapeHTML(m.id)}">${escapeHTML(m.name)}</button></div><small>${escapeHTML(m.family)} · ${matches(m)?'Pass':'Excluded'} · ${escapeHTML(evidenceLabel(m))}</small><div class="chart-candidate-values">${fmt(m[state.chartX],state.chartX)}${state.chartType==='scatter'?` · ${fmt(m[state.chartY],state.chartY)}`:''}</div><div class="chart-candidate-actions"><button class="tiny-button" data-chart-focus="${escapeHTML(m.id)}">Locate</button><button class="tiny-button" data-compare="${escapeHTML(m.id)}">${state.compared.includes(m.id)?'✓ Compared':'+ Compare'}</button>${state.chartType==='scatter'?`<button class="tiny-button" data-chart-label="${escapeHTML(m.id)}">Label</button>`:''}</div></div>`).join('')||'<div class="empty">No materials here. Adjust the selection stages or choose different axes.</div>';
  if(list.length>60)holder.insertAdjacentHTML('beforeend',`<p class="chart-list-more">Showing 60 of ${list.length}. Export the data CSV for all records.</p>`);
}
function chartHull(items,x,y,logX,logY){
  const pts=items.map(m=>({x:logX?Math.log10(m[x]):m[x],y:logY?Math.log10(m[y]):m[y]})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)).sort((a,b)=>a.x-b.x||a.y-b.y);
  if(pts.length<3)return [];
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[],upper=[];
  for(const p of pts){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
  for(const p of [...pts].reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}
  const hull=[...lower.slice(0,-1),...upper.slice(0,-1)];
  return hull.length>=3?hull.map(p=>[logX?10**p.x:p.x,logY?10**p.y:p.y]):[];
}
function plotlyWindow(){
  if(!validWindow(state.chartWindow,state.chartLogX,state.chartLogY))return {};
  const w=state.chartWindow,convert=(v,log)=>log?Math.log10(v):v;
  return {xaxis:{range:[convert(w.xmin,state.chartLogX),convert(w.xmax,state.chartLogX)]},yaxis:{range:[convert(w.ymin,state.chartLogY),convert(w.ymax,state.chartLogY)]}};
}
function renderPlotlyChart(){
  const host=$('#plotlyChart');if(!host)return;
  if(!window.Plotly){host.textContent='The bundled plotting library could not load.';return}
  const generation=chartGeneration,X=state.chartX,Y=state.chartY,lx=state.chartLogX,ly=state.chartLogY;
  const valid=m=>Number.isFinite(m[X])&&(!lx||m[X]>0)&&(state.chartType==='histogram'||(Number.isFinite(m[Y])&&(!ly||m[Y]>0)));
  const entries=materials().filter(valid),selectedIds=new Set(state.chartSelected),traces=[];
  if(!entries.length){host.innerHTML='<div class="empty"><strong>No plottable values</strong>Choose another property pair or turn off logarithmic scale for non-positive values.</div>';return}
  if(state.chartType==='histogram'){
    const {bins}=histogramData(),tick=v=>new Intl.NumberFormat('en-US',{maximumSignificantDigits:3}).format(lx?10**v:v);
    traces.push({type:'bar',name:'Passing materials',x:bins.map(b=>`${tick(b.lo)}–${tick(b.hi)}`),y:bins.map(b=>b.n),marker:{color:'#2563eb'},hovertemplate:'%{x}<br>%{y} materials<extra></extra>'});
  }else{
    if(state.showEnvelopes)for(const f of FAMILIES){
      const hull=chartHull(entries.filter(m=>m.family===f&&matches(m)),X,Y,lx,ly);
      if(hull.length<3)continue;
      traces.push({type:'scatter',mode:'lines',x:[...hull.map(p=>p[0]),hull[0][0]],y:[...hull.map(p=>p[1]),hull[0][1]],fill:'toself',fillcolor:transparentColor(COLORS[f],.1),line:{color:COLORS[f],width:1,dash:'dot'},name:`${f} range`,legendgroup:f,showlegend:false,hoverinfo:'skip'});
    }
    for(const f of FAMILIES){let shown=false;
      for(const pass of [true,false]){
        if(!pass&&!state.showExcluded)continue;
        const group=entries.filter(m=>m.family===f&&matches(m)===pass);if(!group.length)continue;
        const showLegend=!shown;shown=true;
        const selectedpoints=selectedIds.size?group.flatMap((m,i)=>selectedIds.has(m.id)?[i]:[]):undefined;
        traces.push({type:'scatter',mode:state.showLabels&&pass?'markers+text':'markers',name:f,legendgroup:f,showlegend:showLegend,
          x:group.map(m=>m[X]),y:group.map(m=>m[Y]),text:state.showLabels&&pass?group.map(m=>escapeHTML(m.name.length>24?m.name.slice(0,23)+'…':m.name)):undefined,textposition:'top center',textfont:{size:10,color:'#334155'},customdata:group.map(m=>m.id),
          marker:{color:COLORS[f],size:group.map(m=>state.compared.includes(m.id)?14:pass?10:7),opacity:pass?.9:.22,line:{color:group.map(m=>state.compared.includes(m.id)?'#17345b':'#fff'),width:group.map(m=>state.compared.includes(m.id)?2:1)}},
          selectedpoints,selected:{marker:{opacity:1,size:15}},unselected:{marker:{opacity:pass?.22:.10}},
          hovertemplate:group.map(m=>`<b>${escapeHTML(m.name)}</b><br>${escapeHTML(PROPERTIES[X].label)}: %{x} ${escapeHTML(PROPERTIES[X].unit)}<br>${escapeHTML(PROPERTIES[Y].label)}: %{y} ${escapeHTML(PROPERTIES[Y].unit)}<br>${pass?'Passes stages':escapeHTML(reasons(m).slice(0,2).join('; ')||'Excluded')}<br>${escapeHTML(evidenceLabel(m))}<extra>${escapeHTML(f)}</extra>`),
          error_x:{type:'data',symmetric:false,visible:pass,array:group.map(m=>Math.max(0,(m[`${X}_max`]??m[X])-m[X])),arrayminus:group.map(m=>Math.max(0,m[X]-(m[`${X}_min`]??m[X]))),color:COLORS[f],thickness:1,width:2},
          error_y:{type:'data',symmetric:false,visible:pass,array:group.map(m=>Math.max(0,(m[`${Y}_max`]??m[Y])-m[Y])),arrayminus:group.map(m=>Math.max(0,m[Y]-(m[`${Y}_min`]??m[Y]))),color:COLORS[f],thickness:1,width:2}
        });
      }
    }
    const preset=PRESETS[state.indexPreset],xs=entries.map(m=>m[X]);
    if(preset&&X==='density'&&Y===preset.property&&xs.length){
      const lo=Math.min(...xs),hi=Math.max(...xs),steps=35,points=Array.from({length:steps},(_,i)=>lo*(hi/lo)**(i/(steps-1)));
      traces.push({type:'scatter',mode:'lines',name:`Index ${preset.formula}`,x:points,y:points.map(x=>indexLineY(x,currentIndexThreshold(),preset)),line:{color:'#17345b',width:2,dash:'dash'},hoverinfo:'skip',showlegend:true});
    }
  }
  const shapes=state.chartType==='scatter'?state.limits.filter(l=>[X,Y].includes(l.key)&&Number.isFinite(Number(l.value))&&(!((l.key===X&&lx)||(l.key===Y&&ly))||Number(l.value)>0)).map(l=>l.key===X?{type:'line',x0:Number(l.value),x1:Number(l.value),yref:'paper',y0:0,y1:1,line:{color:'#b56a30',dash:'dash',width:1.5}}:{type:'line',y0:Number(l.value),y1:Number(l.value),xref:'paper',x0:0,x1:1,line:{color:'#b56a30',dash:'dash',width:1.5}}):[];
  const annotations=state.chartType==='scatter'?state.annotations.map(a=>({x:a.x,y:a.y,text:escapeHTML(a.text),showarrow:true,arrowhead:2,ax:25,ay:-28,bgcolor:'#fff',bordercolor:'#d8e1ed',font:{color:'#824f19',size:11}})):[];
  const windowRanges=plotlyWindow();
  const layout={paper_bgcolor:'#fff',plot_bgcolor:'#fbfcfe',font:{family:'Inter, system-ui, sans-serif',color:'#334155',size:12},margin:{l:74,r:24,t:state.chartTitle?70:46,b:state.chartNote?142:120},autosize:true,
    title:state.chartTitle?{text:escapeHTML(state.chartTitle),font:{size:16,color:'#172b4a'},x:.5,y:.98}:undefined,
    legend:{orientation:'h',x:0,y:-.25,tracegroupgap:4,groupclick:'togglegroup',font:{size:11}},hovermode:'closest',dragmode:'zoom',clickmode:'event+select',showlegend:state.chartType==='scatter',
    xaxis:state.chartType==='histogram'?{title:{text:`${escapeHTML(PROPERTIES[X].label)} (${escapeHTML(PROPERTIES[X].unit)})`},type:'category',tickangle:-30,gridcolor:'#e9eef5',zeroline:false}:{title:{text:`${escapeHTML(PROPERTIES[X].label)} (${escapeHTML(PROPERTIES[X].unit)})`},type:lx?'log':'linear',gridcolor:'#e9eef5',zeroline:false,automargin:true,...windowRanges.xaxis},
    yaxis:{title:{text:state.chartType==='histogram'?'Number of materials':`${escapeHTML(PROPERTIES[Y].label)} (${escapeHTML(PROPERTIES[Y].unit)})`},type:state.chartType==='histogram'?'linear':ly?'log':'linear',gridcolor:'#e9eef5',zeroline:false,automargin:true,...(state.chartType==='scatter'?windowRanges.yaxis:{})},
    shapes,annotations:state.chartNote?[...annotations,{text:escapeHTML(state.chartNote),xref:'paper',yref:'paper',x:0,y:-.39,xanchor:'left',showarrow:false,font:{size:10,color:'#64748b'}}]:annotations};
  const config={responsive:true,displaylogo:false,displayModeBar:true,scrollZoom:true,modeBarButtonsToRemove:['toImage'],doubleClick:'reset'};
  Plotly.newPlot(host,traces,layout,config).then(()=>{
    if(generation!==chartGeneration||!host.isConnected){Plotly.purge(host);return}
    plotHost=host;
    host.on('plotly_click',event=>{const id=event.points?.[0]?.customdata;if(id&&materials().some(m=>m.id===id))openDetail(id)});
    host.on('plotly_selected',event=>{
      state.chartSelected=[...new Set((event?.points||[]).map(p=>p.customdata).filter(id=>typeof id==='string'))];
      chartSelectionRange=event?.range?.x&&event?.range?.y?{x:event.range.x,y:event.range.y}:null;
      save();renderChartShortlist();updateChartSelectionHeader();
    });
    host.on('plotly_deselect',()=>{state.chartSelected=[];chartSelectionRange=null;save();renderChartShortlist();updateChartSelectionHeader()});
    host.on('plotly_relayout',event=>{
      const old=state.chartWindow;
      if(event['xaxis.autorange']||event['yaxis.autorange']){if(old)chartHistory.push(old);state.chartWindow=null;const back=$('[data-action="chartBack"]');if(back)back.disabled=!chartHistory.length;save();return}
      if(!Object.keys(event).some(key=>key.startsWith('xaxis.range')||key.startsWith('yaxis.range')))return;
      const x=event['xaxis.range']||[event['xaxis.range[0]'],event['xaxis.range[1]']],y=event['yaxis.range']||[event['yaxis.range[0]'],event['yaxis.range[1]']];
      if(!x.every(Number.isFinite))x.splice(0,2,...host._fullLayout.xaxis.range);
      if(!y.every(Number.isFinite))y.splice(0,2,...host._fullLayout.yaxis.range);
      if(x.every(Number.isFinite)&&y.every(Number.isFinite)){
        const w={xmin:lx?10**x[0]:x[0],xmax:lx?10**x[1]:x[1],ymin:ly?10**y[0]:y[0],ymax:ly?10**y[1]:y[1]};
        if(validWindow(w,lx,ly)){chartHistory.push(old);if(chartHistory.length>20)chartHistory.shift();state.chartWindow=w;const back=$('[data-action="chartBack"]');if(back)back.disabled=false;save()}
      }
    });
    if(typeof ResizeObserver!=='undefined'){plotResize=new ResizeObserver(()=>{if(plotHost===host)Plotly.Plots.resize(host)});plotResize.observe(host.parentElement)}
  }).catch(error=>{if(generation===chartGeneration)host.textContent=`Could not draw the chart: ${error.message}`});
}
function histogramData(){return buildHistogram(passing().map(m=>m[state.chartX]),state.chartBins,state.chartLogX)}
function updateChartSelectionHeader(){const el=$('.chart-shortlist-head');if(!el)return;const n=state.chartSelected.length;el.innerHTML=`<span class="eyebrow">${n?'GRAPH SELECTION':'PASSING MATERIALS'}</span><h3>${n?`${n} selected`:`${passing().length} candidates`}</h3><p>${n?'Selected points are linked to the rows below.':'Box-select points to build a focused list.'}</p>`;const clear=$('[data-action="clearChartSelection"]'),apply=$('[data-action="applyPlotSelection"]');if(clear)clear.disabled=!n;if(apply)apply.disabled=!chartSelectionRange;const label=$('.chart-visual-head span');if(label&&state.chartType==='scatter')label.textContent=`${n?`${n} graph-selected · `:''}${passing().length} passing · ${materials().length-passing().length} excluded`}

function renderCompare() {
  const s=selected();
  const a=state.rankA,b=state.rankB, wa=Math.max(0,Math.min(100,Number(state.weightA)||0));
  const usable=s.filter(m=>Number.isFinite(m[a])&&Number.isFinite(m[b])&&matches(m));
  const normalize=(v,key)=>{let vals=usable.map(m=>m[key]),lo=Math.min(...vals),hi=Math.max(...vals);if(hi===lo)return 0.5;let raw=(v-lo)/(hi-lo);return PROPERTIES[key].better==='low'?1-raw:raw};
  const scores=new Map(usable.map(m=>[m.id,Math.round(100*(normalize(m[a],a)*wa/100+normalize(m[b],b)*(100-wa)/100))]));
  const opts=key=>properties.map(p=>`<option value="${p}" ${key===p?'selected':''}>${PROPERTIES[p].label}</option>`).join('');
  $('#compareView').innerHTML=`<div class="panel score-panel"><h2>Ranking setup</h2><div class="score-controls"><label class="score-control">First objective<select id="rankA">${opts(a)}</select></label><label class="score-control">Weight %<input id="weightA" type="number" min="0" max="100" value="${wa}"></label><label class="score-control">Second objective<select id="rankB">${opts(b)}</select></label><div class="kpi"><strong>${100-wa}%</strong> second objective</div><button class="button outline" id="printReport">Print report</button><button class="button outline" data-action="saveProject">Save project</button></div><p class="score-note">Scores normalize only the ${usable.length} selected candidates that pass the stages and have both properties. They are comparative scores, not design certification.</p></div>${s.length ? `<div class="compare-grid">${[...s].sort((x,y)=>(scores.get(y.id)??-1)-(scores.get(x.id)??-1)).map(m=>{let d=derived(m);let failed=reasons(m);return `<article class="panel compare-card"><h3><button class="name-button" data-open="${escapeHTML(m.id)}">${escapeHTML(m.name)}</button></h3><span class="family-chip chip-${escapeHTML(m.family)}">${escapeHTML(m.family)}</span><div class="property-line"><span>Stage result</span><strong>${failed.length?'Does not pass':'Passes'}</strong></div>${failed.length?`<p class="failure-reasons">${failed.map(escapeHTML).join(' · ')}</p>`:''}<div class="property-line"><span>Objective score</span><strong>${scores.has(m.id)?`${scores.get(m.id)} / 100`:'Not ranked'}</strong></div>${scores.has(m.id)?`<div class="score-bar"><i style="width:${scores.get(m.id)}%"></i></div>`:''}${properties.map(k=>`<div class="property-line"><span>${PROPERTIES[k].label}</span><strong>${fmt(m[k],k)}</strong></div>`).join('')}<div class="property-line"><span>Cost per volume</span><strong>${d.costPerVolume==null?'—':`${Math.round(d.costPerVolume).toLocaleString()} USD/m³`}</strong></div><div class="property-line"><span>Carbon per volume</span><strong>${d.carbonPerVolume==null?'—':`${Math.round(d.carbonPerVolume).toLocaleString()} kg CO₂e/m³`}</strong></div><div class="property-line"><span>Source</span><strong>${escapeHTML(m.source)}</strong></div><button class="tiny-button" data-compare="${escapeHTML(m.id)}">Remove from comparison</button></article>`}).join('')}</div>`:'<div class="panel empty"><strong>No materials in your comparison</strong>Use + Compare in Explore or open a chart point. You can select up to four.</div>'}`;
}
function renderLibrary() {
  $('#libraryView').innerHTML=`<div class="panel"><div class="section-heading"><div><span class="eyebrow">DATA MANAGEMENT</span><h2>Materials in this browser</h2></div><strong class="pill-count">${state.custom.length} personal records</strong></div><div class="library-actions"><div class="library-action-group"><button class="button primary" data-action="add">+ Add material</button><button class="button outline" data-action="importLibrary">Import CSV / Excel</button></div><div class="library-action-group"><button class="button outline" data-action="templateXLSX">Excel template</button><button class="button outline" data-action="templateCSV">CSV template</button></div><div class="library-action-group"><button class="button outline" data-action="exportCSVAll">Export library</button><button class="button outline" data-action="backup">JSON backup</button><button class="button outline" data-action="restore">Restore</button></div></div><p class="library-note">Required columns: <code>name</code>, <code>family</code>. Download a template for all fields, units and an example. Imports are previewed before saving. Your records stay in this browser.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Material / grade</th><th>Family</th><th>Evidence</th><th>Source</th><th>Actions</th></tr></thead><tbody>${state.custom.map(m=>`<tr><td><button class="name-button" data-open="${escapeHTML(m.id)}">${escapeHTML(m.name)}</button><span class="subtext">${escapeHTML(m.grade_condition||m.subtype||'Condition unspecified')}</span></td><td>${escapeHTML(m.family)}</td><td>${escapeHTML(evidenceLabel(m))}</td><td>${escapeHTML(m.source||'—')}</td><td><button class="tiny-button" data-edit="${escapeHTML(m.id)}">Edit</button> <button class="tiny-button danger" data-delete="${escapeHTML(m.id)}">Delete</button></td></tr>`).join('')}</tbody></table>${state.custom.length?'':'<div class="empty"><strong>No personal materials yet</strong>Add a material or import a library you have permission to use.</div>'}</div></div>
  <div class="panel project-panel"><div class="section-heading"><div><span class="eyebrow">SELECTION PROJECTS</span><h2>Saved design cases</h2></div><button class="button primary" data-action="saveProject">Save current setup</button></div><p class="score-note">A project saves your constraints, chart, index, ranking, shortlist and notes. It uses the current material library when reopened.</p><div class="project-list">${state.projects.map(p=>`<article class="project-item"><div><strong>${escapeHTML(p.name)}</strong><p>${escapeHTML(p.objective||'No design note')} · ${new Date(p.updatedAt).toLocaleDateString()}</p></div><div><button class="tiny-button" data-project-load="${escapeHTML(p.id)}">Open</button><button class="tiny-button danger" data-project-delete="${escapeHTML(p.id)}">Delete</button></div></article>`).join('')||'<p class="muted">No saved projects yet.</p>'}</div></div><div class="panel project-panel local-data-panel"><div><span class="eyebrow">DEVICE STORAGE</span><h2>Saved data on this browser</h2><p>Your materials and projects are local to this browser. Export a backup before clearing them or moving devices.</p></div><button class="button outline danger" data-action="clearSaved">Clear saved data</button></div><p class="foot-note">${state.deletedSeeds.length} illustrative samples hidden. <button class="text-button" id="restoreSamples">Restore all samples</button></p><input id="fileInput" type="file" accept=".csv,.xlsx,.json,text/csv,application/json" hidden>`;
}
function renderAbout(){
  $('#aboutView').innerHTML=`<div class="about-grid"><article class="panel about-card"><span class="eyebrow">THE WORKSPACE · VERSION ${VERSION}</span><h2>Material selection with a traceable path</h2><p>Browse candidate materials, apply design constraints, compare properties and explore performance indices for a stated component and load case. Import your own sourced library, save a project and export the plot for your report.</p><div class="about-stat"><strong>${materials().length}</strong><span>materials available in this browser</span></div><p>Bundled records are illustrative examples. Values, processing conditions, availability, costs and environmental figures must be checked against current sources before engineering use.</p></article><article class="panel about-card"><span class="eyebrow">CREDITS</span><h2>An independent project</h2><p>Created by <strong>Edgar Mendonca</strong> with development assistance from <strong>OpenAI GPT-6 Sol</strong>.</p><p>Charts use locally bundled Plotly.js Basic, and Excel import uses fflate. The optional Results analysis runs the included Python selection module with Pyodide, downloaded on first use. App source is MIT-licensed; bundled dependencies retain their own licenses. The included sample data is illustrative; import your own traceable records for real decisions.</p><p>Each person's material library and saved projects are stored in their own browser. Nothing is uploaded to an app server. Export a JSON backup before clearing site data or moving devices.</p><button class="button outline" data-action="backup">Export my backup</button></article><article class="panel about-card about-wide"><span class="eyebrow">HOW TO USE IT</span><div class="about-steps"><div><strong>01 · Source</strong><p>Import a CSV or Excel file using the library template. Keep each grade, condition and source identifiable.</p></div><div><strong>02 · Screen</strong><p>Filter by family, manufacturing process and numeric limits. Missing values fail active limits.</p></div><div><strong>03 · Select</strong><p>Review every pass/fail result, compare candidates and explore index lines on the chart. Run Python analysis in Results to check the screening and rank passing materials.</p></div><div><strong>04 · Present</strong><p>Save the design case, download a chart and print a selection report.</p></div></div></article></div>`;
}
function openDetail(id) {
  const m=materials().find(x=>x.id===id); if(!m)return;
  const d=derived(m),failed=reasons(m),index=PRESETS[state.indexPreset]?indexValue(m,PRESETS[state.indexPreset]):null;
  const close=similarMaterials(m);
  $('#detailContent').innerHTML=`<div class="dialog-header"><div><span class="eyebrow">${m.origin==='sample'?'ILLUSTRATIVE SAMPLE':'PERSONAL RECORD'}</span><h2>${escapeHTML(m.name)}</h2></div><button class="icon-button" data-close="detailDialog" aria-label="Close">×</button></div><div class="detail-tags"><span class="family-chip chip-${escapeHTML(m.family)}">${escapeHTML(m.family)}</span><span class="family-chip">${escapeHTML(m.subtype||'Unclassified')}</span></div><div class="detail-grid">${properties.map(k=>`<div class="property-line"><span>${PROPERTIES[k].label}</span><strong>${fmt(m[k],k)}${Number.isFinite(m[`${k}_min`])&&Number.isFinite(m[`${k}_max`])?` <small>(${m[`${k}_min`]}–${m[`${k}_max`]})</small>`:''}</strong></div>`).join('')}<div class="property-line"><span>Cost per volume</span><strong>${d.costPerVolume==null?'—':`${Math.round(d.costPerVolume).toLocaleString()} USD/m³`}</strong></div><div class="property-line"><span>Carbon per volume</span><strong>${d.carbonPerVolume==null?'—':`${Math.round(d.carbonPerVolume).toLocaleString()} kg CO₂e/m³`}</strong></div>${index!=null?`<div class="property-line"><span>${escapeHTML(PRESETS[state.indexPreset].formula)} (SI)</span><strong>${index.toPrecision(4)}</strong></div>`:''}</div><div class="detail-source"><strong>Numeric data:</strong> ${properties.filter(k=>Number.isFinite(m[k])).length} / ${properties.length} properties populated<br><strong>Grade / condition:</strong> ${escapeHTML(m.grade_condition||'Unspecified')}<br><strong>Standard / form:</strong> ${escapeHTML(m.standard||'—')} · ${escapeHTML(m.product_form||'—')}<br><strong>Processes:</strong> ${escapeHTML(m.processes.join(', ')||'Not supplied')}<br><strong>Evidence:</strong> ${escapeHTML(evidenceLabel(m))}<br><strong>Source:</strong> ${escapeHTML(m.source||'Not supplied')} · revision ${escapeHTML(m.source_revision||'unspecified')} · date ${escapeHTML(m.source_date||'unspecified')}${m.source_url?` · <a href="${escapeHTML(m.source_url)}" target="_blank" rel="noopener noreferrer">Open source</a>`:''}<br><strong>Test method:</strong> ${escapeHTML(m.test_standard||'Not supplied')}<br><strong>Test temperature:</strong> ${m.test_temperature_c==null?'—':`${m.test_temperature_c} °C`}<br><strong>Composition:</strong> ${escapeHTML(m.composition||'Not supplied')}<br><strong>Corrosion notes:</strong> ${escapeHTML(m.corrosion_notes||'Not supplied')}<br><strong>Availability:</strong> ${escapeHTML(m.availability||'Not supplied')}</div>${failed.length?`<p class="failure-reasons">Current stage result: ${failed.map(escapeHTML).join(' · ')}</p>`:'<p class="success-note">Passes all current selection stages.</p>'}${m.notes?`<p class="detail-note">${escapeHTML(m.notes)}</p>`:''}<div class="similar-section"><h3>Potential alternatives</h3><p class="score-note">Same-family proximity from shared positive numeric properties. Similarity is exploratory; verify condition, process and service environment.</p>${close.length?close.map(({m:other,score,common})=>`<button class="similar-item" data-similar="${escapeHTML(other.id)}"><strong>${escapeHTML(other.name)}</strong><span>${score}% proximity · ${common} shared properties</span></button>`).join(''):'<p class="muted">Not enough comparable records in this family.</p>'}</div><div class="dialog-actions details-actions"><button class="button outline" data-compare="${escapeHTML(m.id)}">${state.compared.includes(m.id)?'Remove comparison':'Add to comparison'}</button>${m.origin==='custom'?`<button class="button outline" data-edit="${escapeHTML(m.id)}">Edit</button><button class="button outline danger" data-delete="${escapeHTML(m.id)}">Delete</button>`:`<button class="button outline danger" data-delete="${escapeHTML(m.id)}">Hide sample</button>`}<button class="button primary" data-close="detailDialog">Close</button></div>`;
  $('#detailDialog').showModal();
}
function openForm(id) {
  editing=id||null;const m=materials().find(x=>x.id===id);
  $('#formTitle').textContent=m?'Edit material':'Add a material';
  const field=(key,label,type='text',hint='')=>`<label class="field">${label}<input name="${key}" type="${type}" ${type==='number'?`step="any" ${['temp','test_temperature_c'].includes(key)?'':'min="0"'}`:''} value="${escapeHTML(m?.[key]??'')}" placeholder="${escapeHTML(hint)}" ${key==='name'?'required':''}></label>`;
  $('#materialFields').innerHTML=`${field('name','Material name / grade')}
    <label class="field">Family<select name="family">${FAMILIES.map(f=>`<option ${m?.family===f?'selected':''}>${f}</option>`).join('')}</select></label>
    ${field('material_id','Library record ID')}${field('subtype','Material subtype')}${field('grade_condition','Grade / heat treatment')}${field('standard','Standard / specification')}${field('product_form','Product form')}${field('processes','Manufacturing processes','text','Separate with semicolons')}
    ${properties.map(k=>field(k,`${PROPERTIES[k].label} (${PROPERTIES[k].unit})`,'number')).join('')}
    ${['density','modulus','yield'].flatMap(k=>[field(`${k}_min`,`${PROPERTIES[k].label} minimum (${PROPERTIES[k].unit})`,'number'),field(`${k}_max`,`${PROPERTIES[k].label} maximum (${PROPERTIES[k].unit})`,'number')]).join('')}
    ${field('test_temperature_c','Test temperature (°C)','number')}${field('test_standard','Test method / standard')}${field('composition','Chemical composition / basis')}${field('corrosion_notes','Corrosion / chemical compatibility notes')}${field('availability','Availability / location')}${field('source','Traceable source','text','Document or supplier datasheet')}${field('source_revision','Source revision')}${field('source_date','Source date (YYYY-MM-DD)')}<label class="field">Evidence label<select name="evidence_level"><option value="unverified">User entered</option><option value="supplier" ${m?.evidence_level==='supplier'?'selected':''}>Supplier stated</option><option value="test" ${m?.evidence_level==='test'?'selected':''}>Test report</option><option value="reference" ${m?.evidence_level==='reference'?'selected':''}>Published reference</option></select></label>${field('source_url','Source URL','url','https://…')}<label class="field wide">Notes / test condition<textarea name="notes">${escapeHTML(m?.notes||'')}</textarea></label>`;
  if(m) $('#materialForm').querySelector('[name="processes"]').value=m.processes.join('; ');
  $('#materialDialog').showModal();
}
function toggleCompare(id) {let i=state.compared.indexOf(id);if(i>=0)state.compared.splice(i,1);else if(state.compared.length<4)state.compared.push(id);else return toast('Comparison is limited to four materials.');save();render();if($('#detailDialog').open)openDetailRefresh(id);}
function openDetailRefresh(id) {$('#detailDialog').close();openDetail(id)}
function removeMaterial(id) {let m=materials().find(x=>x.id===id);if(!m)return;if(!confirm(`${m.origin==='sample'?'Hide sample':'Delete material'} “${m.name}” from this browser?`))return;if(m.origin==='sample')state.deletedSeeds.push(id);else state.custom=state.custom.filter(x=>x.id!==id);state.compared=state.compared.filter(x=>x!==id);save();$('#detailDialog').close();render();toast(m.origin==='sample'?'Sample hidden. You can restore samples in My library.':'Material deleted.');}
function download(name,contents,type){const url=URL.createObjectURL(contents instanceof Blob?contents:new Blob([contents],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
function exportCSV(list,name='material-atlas-selection.csv'){download(name,writeCSV(list),'text/csv;charset=utf-8')}
function normalizeRecord(raw) {
  const name=String(raw.name||'').trim();if(!name)throw Error('Every row needs a material name.');
  const family=String(raw.family||'').trim();if(!FAMILIES.includes(family))throw Error(`${name}: family must be ${FAMILIES.join(', ')}.`);
  const m={id:crypto.randomUUID?.()||`personal-${Date.now()}-${Math.random()}`,origin:'custom',name,family,
    processes:Array.isArray(raw.processes)?raw.processes.map(String):String(raw.processes||'').split(';').map(s=>s.trim()).filter(Boolean)};
  for(const key of ['material_id','subtype','grade_condition','standard','product_form','composition','corrosion_notes','availability','source','source_revision','source_date','source_url','test_standard','notes'])m[key]=String(raw[key]||'').trim();
  m.evidence_level=String(raw.evidence_level||'unverified').trim().toLowerCase();
  if(!['unverified','supplier','test','reference'].includes(m.evidence_level))throw Error(`${name}: evidence_level must be unverified, supplier, test or reference.`);
  if(m.source_date && !/^\d{4}-\d{2}-\d{2}$/.test(m.source_date))throw Error(`${name}: source_date must be YYYY-MM-DD.`);
  if(m.source_url){try{const u=new URL(m.source_url);if(!['http:','https:'].includes(u.protocol))throw Error()}catch{throw Error(`${name}: source_url must be an http or https URL.`)}}
  for(const key of NUMBERS){const rawNumber=raw[key];if(rawNumber===''||rawNumber==null){m[key]=null;continue}const n=Number(rawNumber);if(!Number.isFinite(n)||(!['temp','test_temperature_c'].includes(key) && n<0))throw Error(`${name}: ${key} must be a ${['temp','test_temperature_c'].includes(key)?'number':'non-negative number'} or blank.`);m[key]=n}
  for(const key of ['density','modulus','yield']){
    const lo=m[`${key}_min`],hi=m[`${key}_max`];
    if((lo==null)!==(hi==null))throw Error(`${name}: provide both ${key}_min and ${key}_max, or leave both blank.`);
    if(lo!=null&&m[key]==null)throw Error(`${name}: provide a representative ${key} value when entering its range.`);
    if(lo!=null&&hi!=null&&lo>hi)throw Error(`${name}: ${key}_min exceeds ${key}_max.`);
    if(m[key]!=null&&((lo!=null&&m[key]<lo)||(hi!=null&&m[key]>hi)))throw Error(`${name}: ${key} must be inside its min/max range.`);
  }
  return m;
}
const recordKey=m=>String(m.material_id||`${m.name}|${m.family}|${m.grade_condition||''}|${m.product_form||''}`).trim().toLowerCase();
async function importFile(file,mode) {
  if(!file)return;
  try {
    if(file.size>12_000_000)throw Error('Choose a file smaller than 12 MB.');
    if(mode==='json')return restoreBackup(JSON.parse(await file.text()));
    const matrix=mode==='xlsx'?readXLSX(new Uint8Array(await file.arrayBuffer())).rows:parseCSV(await file.text());
    const [headers,...rows]=matrix;
    if(!headers?.length||!rows.length)throw Error('The file needs a header row and at least one material.');
    if(rows.length>1500)throw Error('Import up to 1,500 records per file.');
    const used=new Set();
    const mapping=headers.map(label=>{const key=guessColumn(label);if(key&&used.has(key))return '';if(key)used.add(key);return key});
    importDraft={headers,rows,mapping,filename:file.name};
    renderImportPreview();$('#importDialog').showModal();
  }catch(e){alert(`Import failed: ${e.message}`)}
}
function mappedRows(){return importDraft.rows.map((row,i)=>{
  try {const raw=Object.fromEntries(importDraft.mapping.map((key,j)=>[key,row[j]??'']).filter(([key])=>key));return {number:i+2,record:normalizeRecord(raw)}}
  catch(e){return {number:i+2,error:e.message}}
})}
function renderImportPreview(){
  const {headers,mapping,filename}=importDraft,results=mappedRows(),errors=results.filter(r=>r.error);
  $('#importContent').innerHTML=`<div class="dialog-header"><div><span class="eyebrow">IMPORT PREVIEW</span><h2>${escapeHTML(filename)}</h2></div><button class="icon-button" data-close="importDialog" aria-label="Close">×</button></div><p class="score-note">${results.length} rows · ${errors.length} with errors. Map your headers below; every row must be valid before import. No data is saved until you confirm.</p><div class="mapping-grid">${headers.map((header,i)=>`<label class="field">${escapeHTML(header||`Column ${i+1}`)}<select data-map="${i}"><option value="">Ignore column</option>${COLUMNS.map(key=>`<option value="${key}" ${mapping[i]===key?'selected':''}>${key}${UNITS[key]?` (${UNITS[key]})`:''}</option>`).join('')}</select></label>`).join('')}</div><div class="import-sample"><strong>First rows</strong>${results.slice(0,6).map(r=>`<p class="${r.error?'failure-reasons':''}">Row ${r.number}: ${r.error?escapeHTML(r.error):`${escapeHTML(r.record.name)} · ${escapeHTML(r.record.family)} · ${escapeHTML(r.record.grade_condition||'condition unspecified')}`}</p>`).join('')}${errors.length>6?`<p class="failure-reasons">First error after preview: row ${errors[6]?.number||errors[0].number}, ${escapeHTML(errors[6]?.error||errors[0].error)}</p>`:''}</div><label class="field">If an existing material has the same record ID or name + grade<select id="duplicateMode"><option value="skip">Skip duplicates</option><option value="replace">Replace duplicates</option><option value="add">Add separate records</option></select></label><div class="dialog-actions"><button class="button outline" data-close="importDialog">Cancel</button><button class="button primary" id="confirmImport" ${errors.length?'disabled':''}>Import ${results.length} records</button></div>`;
}
function finishImport(){
  const rows=mappedRows();if(rows.some(x=>x.error))return toast('Fix the highlighted import errors first.');
  const mode=$('#duplicateMode').value;
  const incoming=rows.map(r=>r.record),seen=new Set();let added=0,replaced=0,skipped=0;
  for(const m of incoming){let key=recordKey(m);const at=state.custom.findIndex(existing=>recordKey(existing)===key);
    if(seen.has(key) && mode!=='add'){skipped++;continue}seen.add(key);
    if(at>=0 && mode==='skip'){skipped++;continue}
    if(at>=0 && mode==='replace'){m.id=state.custom[at].id;state.custom[at]=m;replaced++}
    else {state.custom.push(m);added++}
  }
  importDraft=null;$('#importDialog').close();save();render();toast(`${added} added · ${replaced} replaced · ${skipped} skipped.`);
}
function restoreBackup(json){
  if(!Array.isArray(json.custom))throw Error('This is not a Material Atlas JSON backup.');
  const incoming=json.custom.map(normalizeRecord);
  if(!confirm(`Replace ${state.custom.length} personal materials and ${state.projects.length} projects in this browser with this backup?`))return;
  const ids=new Map(incoming.map((m,i)=>[String(json.custom[i].id),m.id]));
  const keys=['deletedSeeds','favorites','compared','families','limits','process','standard','productForm','chartX','chartY','chartLogX','chartLogY','chartTitle','chartNote','showEnvelopes','showLabels','showExcluded','chartType','chartWindow','chartBins','annotations','chartSelected','rankA','rankB','weightA','indexPreset','indexLevel','indexFilter','projects','activeProjectId'];
  state={...structuredClone(base),...Object.fromEntries(keys.filter(k=>Object.hasOwn(json,k)).map(k=>[k,json[k]])),custom:incoming,view:'library'};
  for(const key of ['deletedSeeds','favorites','compared','families','limits','projects','chartSelected'])if(!Array.isArray(state[key]))state[key]=[];
  state.deletedSeeds=state.deletedSeeds.filter(id=>SEED.some(m=>m.id===id));
  state.compared=state.compared.map(id=>ids.get(String(id))||id).filter(id=>SEED.some(m=>m.id===id)||incoming.some(m=>m.id===id)).slice(0,4);
  state.chartSelected=state.chartSelected.map(id=>ids.get(String(id))||id).filter(id=>SEED.some(m=>m.id===id)||incoming.some(m=>m.id===id));
  state.families=state.families.filter(f=>FAMILIES.includes(f));
  state.limits=state.limits.filter(l=>properties.includes(l?.key)&&['min','max'].includes(l?.op)&&Number.isFinite(Number(l.value))).slice(0,12);
  state.chartX=properties.includes(state.chartX)?state.chartX:'density';state.chartY=properties.includes(state.chartY)?state.chartY:'modulus';
  state.rankA=properties.includes(state.rankA)?state.rankA:'density';state.rankB=properties.includes(state.rankB)?state.rankB:'modulus';
  state.indexPreset=PRESETS[state.indexPreset]?state.indexPreset:'';
  state.indexLevel=Number.isFinite(Number(state.indexLevel))?Math.max(0,Math.min(100,Number(state.indexLevel))):50;
  for(const key of ['process','standard','productForm','chartTitle','chartNote'])if(typeof state[key]!=='string')state[key]='';
  state.projects=Array.isArray(state.projects)?state.projects.filter(p=>p&&typeof p.name==='string'&&p.settings&&typeof p.settings==='object').slice(0,100):[];
  for(const p of state.projects)for(const key of ['compared','chartSelected'])if(Array.isArray(p.settings[key]))p.settings[key]=p.settings[key].map(id=>ids.get(String(id))||id).filter(id=>SEED.some(m=>m.id===id)||incoming.some(m=>m.id===id));
  sanitizePlotState();state.activeProjectId='';save();render();toast(`${incoming.length} records and ${state.projects.length} projects restored.`);
}
function openProjectForm(){
  const p=state.projects.find(p=>p.id===state.activeProjectId);
  $('#projectName').value=p?.name||'';$('#projectObjective').value=p?.objective||'';
  $('#projectDialog').showModal();$('#projectName').focus();
}
function projectSettings(){return Object.fromEntries(['families','limits','process','standard','productForm','compared','chartX','chartY','chartLogX','chartLogY','chartTitle','chartNote','showEnvelopes','showLabels','showExcluded','chartType','chartWindow','chartBins','annotations','chartSelected','rankA','rankB','weightA','indexPreset','indexLevel','indexFilter'].map(k=>[k,structuredClone(state[k])]))}
function saveProject(){
  const name=$('#projectName').value.trim(),objective=$('#projectObjective').value.trim();if(!name)return;
  let p=state.projects.find(p=>p.id===state.activeProjectId);
  if(!p){p={id:crypto.randomUUID(),name,objective,settings:{},updatedAt:''};state.projects.unshift(p)}
  p.name=name;p.objective=objective;p.settings=projectSettings();p.updatedAt=new Date().toISOString();state.activeProjectId=p.id;
  save();$('#projectDialog').close();render();toast('Selection project saved in this browser.');
}
function loadProject(id){let p=state.projects.find(x=>x.id===id);if(!p)return;const s=p.settings;
  for(const key of Object.keys(projectSettings()))if(Object.hasOwn(s,key))state[key]=structuredClone(s[key]);
  state.families=Array.isArray(state.families)?state.families.filter(f=>FAMILIES.includes(f)):[];
  state.limits=Array.isArray(state.limits)?state.limits.filter(l=>properties.includes(l?.key)&&['min','max'].includes(l.op)&&Number.isFinite(Number(l.value))).slice(0,12):[];
  for(const key of ['process','standard','productForm','chartTitle','chartNote'])if(typeof state[key]!=='string')state[key]='';
  state.chartX=properties.includes(state.chartX)?state.chartX:'density';state.chartY=properties.includes(state.chartY)?state.chartY:'modulus';
  state.rankA=properties.includes(state.rankA)?state.rankA:'density';state.rankB=properties.includes(state.rankB)?state.rankB:'modulus';
  state.indexPreset=PRESETS[state.indexPreset]?state.indexPreset:'';
  state.indexLevel=Number.isFinite(Number(state.indexLevel))?Math.max(0,Math.min(100,Number(state.indexLevel))):50;
  if(!Array.isArray(state.compared))state.compared=[];
  state.compared=state.compared.filter(id=>materials().some(m=>m.id===id)).slice(0,4);
  sanitizePlotState();state.activeProjectId=p.id;state.view='chart';save();render();toast(`Opened ${p.name}.`);
}
async function exportChart(format){
  if(!plotHost||!window.Plotly)return toast('Wait for the chart to finish drawing.');
  try {await Plotly.downloadImage(plotHost,{format,filename:'material-atlas-chart',width:1200,height:720,scale:format==='png'?2:1})}
  catch(error){alert(`Chart export failed: ${error.message}`)}
}
function init() {
  document.addEventListener('click',e=>{
    let t=e.target.closest('button');if(!t)return;
    if(t.dataset.view)return setView(t.dataset.view);
    if(t.dataset.close)return $(`#${t.dataset.close}`).close();
    if(t.dataset.open)return openDetail(t.dataset.open);
    if(t.dataset.similar){$('#detailDialog').close();return openDetail(t.dataset.similar)}
    if(t.dataset.compare)return toggleCompare(t.dataset.compare);
    if(t.dataset.edit){$('#detailDialog').close();return openForm(t.dataset.edit)}
    if(t.dataset.delete)return removeMaterial(t.dataset.delete);
    if(t.dataset.projectLoad)return loadProject(t.dataset.projectLoad);
    if(t.dataset.projectDelete){const p=state.projects.find(p=>p.id===t.dataset.projectDelete);if(!p||!confirm(`Delete saved project “${p.name}” from this browser?`))return;state.projects=state.projects.filter(x=>x.id!==p.id);if(state.activeProjectId===p.id)state.activeProjectId='';save();return render()}
    if(t.dataset.removeLimit!==undefined){state.limits.splice(Number(t.dataset.removeLimit),1);save();return render()}
    if(t.id==='helpButton')return $('#infoDialog').showModal();
    if(t.id==='mobileFilterToggle'){const open=$('.sidebar').classList.toggle('filters-open');t.setAttribute('aria-expanded',String(open));return}
    if(t.id==='addButton'||t.dataset.action==='add')return openForm();
    if(t.id==='resetFilters'||t.id==='clearStages'){state.families=[];state.limits=[];state.process='';state.standard='';state.productForm='';state.indexFilter=false;save();return render()}
    if(t.id==='addLimit'){if(state.limits.length>=12)return toast('Maximum of 12 numeric limits.');state.limits.push({key:'density',op:'max',value:10000});save();return render()}
    if(t.dataset.chartPreset!==undefined){const p=CHART_PRESETS[Number(t.dataset.chartPreset)];if(!p)return;state.chartType='scatter';state.chartX=p.x;state.chartY=p.y;state.chartLogX=p.logX;state.chartLogY=p.logY;state.chartWindow=null;state.chartSelected=[];chartSelectionRange=null;chartHistory=[];save();return renderChart()}
    if(t.dataset.chartFocus){state.chartSelected=[t.dataset.chartFocus];chartSelectionRange=null;save();return renderChart()}
    if(t.dataset.chartLabel){const m=materials().find(m=>m.id===t.dataset.chartLabel);if(!m||!Number.isFinite(m[state.chartX])||!Number.isFinite(m[state.chartY]))return;if(state.annotations.length>=12)return toast('Maximum of 12 point notes.');const label=prompt(`Note for ${m.name} (up to 60 characters):`);if(!label?.trim())return;state.annotations.push({x:m[state.chartX],y:m[state.chartY],text:label.trim().slice(0,60)});save();return renderChart()}
    if(t.dataset.action==='clearChartNotes'){state.annotations=[];save();return renderChart()}
    if(t.dataset.action==='clearChartSelection'){state.chartSelected=[];chartSelectionRange=null;save();return renderChart()}
    if(t.dataset.action==='applyPlotSelection'){
      const r=chartSelectionRange;if(!r)return toast('Use the graph toolbar to box-select a region first.');
      if(state.limits.length>8)return toast('Remove some numeric limits before adding four from this box.');
      const bounds=[['chartX',r.x],['chartY',r.y]];
      if(bounds.some(([,range])=>!range?.every(Number.isFinite)))return toast('The selected box has invalid axis values.');
      for(const [key,range] of bounds){const [lo,hi]=[...range].sort((a,b)=>a-b);state.limits.push({key:state[key],op:'min',value:Number(lo.toPrecision(6))},{key:state[key],op:'max',value:Number(hi.toPrecision(6))})}
      chartSelectionRange=null;save();render();return toast('Four property limits added from the chart box.');
    }
    if(t.dataset.action==='chartBack'){if(!chartHistory.length)return;state.chartWindow=chartHistory.pop();save();return renderChart()}
    if(t.dataset.action==='chartFit'){if(state.chartWindow)chartHistory.push(state.chartWindow);state.chartWindow=null;save();return renderChart()}
    if(t.dataset.action==='chartAxis'){
      const entries=materials().filter(m=>Number.isFinite(m[state.chartX])&&Number.isFinite(m[state.chartY])&&(!state.chartLogX||m[state.chartX]>0)&&(!state.chartLogY||m[state.chartY]>0));
      const extent=key=>{const values=entries.map(m=>m[key]);if(!values.length)return [1,10];const lo=Math.min(...values),hi=Math.max(...values);return [lo,hi>lo?hi:lo+1]};
      const [xmin,xmax]=extent(state.chartX),[ymin,ymax]=extent(state.chartY),w=state.chartWindow||{xmin,xmax,ymin,ymax};
      for(const [id,key] of [['axisXMin','xmin'],['axisXMax','xmax'],['axisYMin','ymin'],['axisYMax','ymax']])$(`#${id}`).value=Number(w[key].toPrecision(6));
      return $('#axisDialog').showModal();
    }
    if(t.id==='restoreSamples'){state.deletedSeeds=[];save();render();return toast('All sample records restored.')}
    if(t.id==='printReport')return window.print();
    if(t.dataset.action==='runPythonAnalysis')return runPythonAnalysis(t);
    if(t.dataset.action==='selectionReport'){reportOpen=!reportOpen;return renderResults()}
    if(t.dataset.action==='resultsCSV'){
      const stageLabels=stageChecks(materials()[0]||{}).map((c,i)=>`Stage ${i+1}: ${c.label}`);
      const rows=materials().map(m=>({name:m.name,family:m.family,grade_condition:m.grade_condition||'',outcome:matches(m)?'Pass':'Excluded',evidence:evidenceLabel(m),source:m.source||'',source_revision:m.source_revision||'',...Object.fromEntries(stageChecks(m).map((c,i)=>[stageLabels[i],`${c.pass?'Pass':'Fail'}: ${c.detail}`]))}));
      return download('material-atlas-results.csv',writeCSV(rows,['name','family','grade_condition','outcome','evidence','source','source_revision',...stageLabels]),'text/csv');
    }
    if(t.dataset.action==='exportCSV')return exportCSV(passing().filter(m=>searchText(m).includes(search.toLowerCase())));
    if(t.dataset.action==='exportCSVAll')return exportCSV(state.custom,'material-atlas-my-library.csv');
    if(t.dataset.action==='templateCSV')return download('material-atlas-import-template.csv',writeCSV([EXAMPLE]),'text/csv');
    if(t.dataset.action==='templateXLSX')return download('material-atlas-import-template.xlsx',makeXLSXTemplate(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if(t.dataset.action==='backup')return download('material-atlas-backup.json',JSON.stringify({format:'material-atlas-v2',exportedAt:new Date().toISOString(),...state},null,2),'application/json');
    if(t.dataset.action==='clearSaved')return $('#clearDialog').showModal();
    if(t.id==='confirmClear')return clearWorkspace().then(()=>{state=structuredClone(base);search='';sort='name';thresholdMemo=null;reportOpen=false;$('#clearDialog').close();render();toast('Saved app data cleared from this browser.')}).catch(error=>alert(error.message));
    if(t.dataset.action==='importLibrary'||t.dataset.action==='restore'){let input=$('#fileInput');if(!input){setView('library');input=$('#fileInput')}input.value='';input.accept=t.dataset.action==='restore'?'.json,application/json':'.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';input.dataset.mode=t.dataset.action==='restore'?'json':'library';input.click();return}
    if(t.dataset.action==='saveProject')return openProjectForm();
    if(t.dataset.action==='chartSVG')return exportChart('svg');
    if(t.dataset.action==='chartPNG')return exportChart('png');
    if(t.dataset.action==='chartData'){
      if(state.chartType==='histogram'){const log=state.chartLogX;return download('material-atlas-histogram-data.csv',writeCSV(histogramData().bins.map(b=>({bin_min:log?10**b.lo:b.lo,bin_max:log?10**b.hi:b.h,count:b.n})),['bin_min','bin_max','count']),'text/csv')}
      return download('material-atlas-chart-data.csv',writeCSV(materials().map(m=>({name:m.name,family:m.family,[state.chartX]:m[state.chartX],[state.chartY]:m[state.chartY],index:PRESETS[state.indexPreset]?indexValue(m,PRESETS[state.indexPreset]):'',passes:matches(m)?'yes':'no'})),['name','family',state.chartX,state.chartY,'index','passes'].filter((k,i,a)=>a.indexOf(k)===i)),'text/csv');
    }
    if(t.id==='confirmImport')return finishImport();
  });
  document.addEventListener('change',e=>{let t=e.target;
    if(t.dataset.family){state.families=t.checked?[...state.families,t.dataset.family]:state.families.filter(f=>f!==t.dataset.family);save();return render()}
    if(t.dataset.limit!==undefined){let l=state.limits[Number(t.dataset.limit)];if(!l)return;l[t.dataset.part]=t.dataset.part==='value'?t.value:t.value;save();return render()}
    if(t.id==='processFilter'){state.process=t.value;save();return render()}
    if(t.id==='standardFilter'||t.id==='formFilter'){state[t.id==='standardFilter'?'standard':'productForm']=t.value;save();return render()}
    if(t.id==='sortBox'){sort=t.value;return renderExplore()}
    if(['chartX','chartY','chartLogX','chartLogY','showEnvelopes','showLabels','showExcluded','chartType','chartBins'].includes(t.id)){state[t.id]=t.type==='checkbox'?t.checked:t.id==='chartBins'?Math.max(4,Math.min(30,Number(t.value)||10)):t.value;if(['chartX','chartY','chartLogX','chartLogY','chartType'].includes(t.id)){state.chartWindow=null;state.chartSelected=[];chartSelectionRange=null;chartHistory=[]}save();return renderChart()}
    if(t.id==='chartTitle'||t.id==='chartNote'){state[t.id]=t.value.trim();save();return renderChart()}
    if(t.id==='indexPreset'){state.indexPreset=t.value;state.indexFilter=false;if(PRESETS[t.value]){state.chartX='density';state.chartY=PRESETS[t.value].property;state.chartLogX=true;state.chartLogY=true;state.chartWindow=null;chartHistory=[]}save();return render()}
    if(t.id==='indexFilter'){state.indexFilter=t.checked;save();return render()}
    if(t.id==='indexLevel'){state.indexLevel=Number(t.value);save();return render()}
    if(t.dataset.map!==undefined){const key=t.value;const i=Number(t.dataset.map);if(key && importDraft.mapping.some((value,j)=>j!==i && value===key)){t.value=importDraft.mapping[i];return toast('Map each material field to only one column.')}importDraft.mapping[i]=key;return renderImportPreview()}
    if(t.id==='rankA'||t.id==='rankB'||t.id==='weightA'){state[t.id]=t.id==='weightA'?Math.max(0,Math.min(100,Number(t.value)||0)):t.value;save();return renderCompare()}
    if(t.id==='fileInput')return importFile(t.files[0],t.dataset.mode==='json'?'json':t.files[0]?.name.toLowerCase().endsWith('.xlsx')?'xlsx':'csv');
  });
  document.addEventListener('input',e=>{if(e.target.id==='searchBox'){search=e.target.value;let caret=e.target.selectionStart;renderExplore();$('#searchBox').focus();$('#searchBox').setSelectionRange(caret,caret)}if(e.target.id==='indexLevel')$('#thresholdLabel').textContent=e.target.value+'%'});
  $('#materialForm').addEventListener('submit',e=>{e.preventDefault();try{let raw=Object.fromEntries(new FormData(e.target));let m=normalizeRecord(raw);if(editing){m.id=editing;let index=state.custom.findIndex(x=>x.id===editing);if(index<0)throw Error('Record no longer exists.');state.custom[index]=m}else state.custom.push(m);save();$('#materialDialog').close();render();toast(editing?'Material updated.':'Material saved in this browser.')}catch(err){alert(err.message)}});
  $('#projectForm').addEventListener('submit',e=>{e.preventDefault();saveProject()});
  $('#axisForm').addEventListener('submit',e=>{e.preventDefault();const w={xmin:Number($('#axisXMin').value),xmax:Number($('#axisXMax').value),ymin:Number($('#axisYMin').value),ymax:Number($('#axisYMax').value)};if(!validWindow(w,state.chartLogX,state.chartLogY))return alert('Enter increasing axis limits; logarithmic axes require positive limits.');chartHistory.push(state.chartWindow);state.chartWindow=w;save();$('#axisDialog').close();renderChart()});
  render();
}
loadWorkspace().then(saved=>{
  state={...structuredClone(base),...(saved&&typeof saved==='object'?saved:{})};
  for(const key of ['custom','deletedSeeds','favorites','compared','families','limits','projects'])if(!Array.isArray(state[key]))state[key]=[];
  state.view='home';
  state.indexPreset=PRESETS[state.indexPreset]?state.indexPreset:'';
  state.indexLevel=Number.isFinite(Number(state.indexLevel))?Math.max(0,Math.min(100,Number(state.indexLevel))):50;
  sanitizePlotState();
  init();
});
