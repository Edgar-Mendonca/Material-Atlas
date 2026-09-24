import { PROPERTIES, SEED } from './data.js';
import { COLUMNS, NUMBERS, EXAMPLE, UNITS, guessColumn, parseCSV, writeCSV, readXLSX, makeXLSXTemplate } from './library-io.js';
import { PRESETS, indexValue, indexLineY, derived } from './selection.js';
import { loadWorkspace, persistWorkspace } from './storage.js';

const FAMILIES = ['Metals', 'Polymers', 'Ceramics', 'Composites', 'Natural', 'Other'];
const COLORS = { Metals: '#2563eb', Polymers: '#ca6494', Ceramics: '#b98a49', Composites: '#8068c2', Natural: '#53936d', Other: '#798998' };
const $ = (s, root = document) => root.querySelector(s);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base = { custom: [], deletedSeeds: [], favorites: [], compared: [], families: [], limits: [], process: '', standard:'', productForm:'', chartX: 'density', chartY: 'modulus', chartLogX: true, chartLogY: true, chartTitle:'', chartNote:'', rankA: 'density', rankB: 'modulus', weightA: 50, view: 'explore', indexPreset:'', indexLevel:50, indexFilter:false, projects:[], activeProjectId:'' };
let state = structuredClone(base);
let search = '', sort = 'name', editing = null, tooltipTimer, importDraft=null;
const properties = Object.keys(PROPERTIES);
const searchText = m => [m.name,m.family,m.subtype,m.grade_condition,m.standard,m.product_form,m.composition,...m.processes].join(' ').toLowerCase();
const dataStatus = m => m.origin==='sample'?'Illustrative sample':m.source?'Source supplied':'Source missing';
const fmt = (n, key) => n == null || !Number.isFinite(Number(n)) ? '—' : `${new Intl.NumberFormat('en-US',{maximumFractionDigits: key === 'carbon' || key === 'cost' ? 2 : 1}).format(n)} ${PROPERTIES[key].unit}`;
const materials = () => [...SEED.filter(m => !state.deletedSeeds.includes(m.id)), ...state.custom];
const selected = () => materials().filter(m => state.compared.includes(m.id));
function save() { persistWorkspace(state,toast); }
function toast(msg) { const e = $('#toast'); e.textContent = msg; e.classList.add('show'); clearTimeout(tooltipTimer); tooltipTimer = setTimeout(() => e.classList.remove('show'), 3500); }
function matches(m) {
  if (state.families.length && !state.families.includes(m.family)) return false;
  if (state.process && !m.processes.some(p => p.toLowerCase() === state.process.toLowerCase())) return false;
  if (state.standard && m.standard!==state.standard)return false;
  if (state.productForm && m.product_form!==state.productForm)return false;
  if(!state.limits.every(l => { const v = m[`${l.key}_${l.op}`] ?? m[l.key]; const bound = Number(l.value); return l.value !== '' && Number.isFinite(v) && Number.isFinite(bound) && (l.op === 'min' ? v >= bound : v <= bound); }))return false;
  if(state.indexFilter && PRESETS[state.indexPreset]) {
    const threshold=currentIndexThreshold();const value=indexValue(m,PRESETS[state.indexPreset]);
    if(value==null || value<threshold)return false;
  }
  return true;
}
function currentIndexThreshold() {
  const preset=PRESETS[state.indexPreset];if(!preset)return 0;
  const nums=materials().map(m=>indexValue(m,preset)).filter(v=>v>0);
  if(!nums.length)return 0;
  const low=Math.min(...nums),high=Math.max(...nums);
  return low*Math.pow(high/low,Math.max(0,Math.min(100,state.indexLevel))/100);
}
const passing = () => materials().filter(matches);
function reasons(m){
  const notes=[];
  if(state.families.length && !state.families.includes(m.family))notes.push('Family excluded');
  if(state.process && !m.processes.includes(state.process))notes.push(`Process ${state.process} unavailable`);
  if(state.standard && m.standard!==state.standard)notes.push('Standard differs');
  if(state.productForm && m.product_form!==state.productForm)notes.push('Product form differs');
  for(const l of state.limits){const v=m[`${l.key}_${l.op}`]??m[l.key];if(!Number.isFinite(v))notes.push(`${PROPERTIES[l.key]?.label||l.key} missing`);else if(l.op==='min'&&v<Number(l.value))notes.push(`${PROPERTIES[l.key]?.label||l.key} below minimum`);else if(l.op==='max'&&v>Number(l.value))notes.push(`${PROPERTIES[l.key]?.label||l.key} above maximum`)}
  if(state.indexFilter && PRESETS[state.indexPreset]){const v=indexValue(m,PRESETS[state.indexPreset]);if(v==null)notes.push('Index properties missing');else if(v<currentIndexThreshold())notes.push('Below index threshold')}
  return notes;
}
function setView(v) {
  state.view = v;
  if (window.innerWidth <= 850) {
    $('.sidebar').classList.remove('filters-open');
    $('#mobileFilterToggle').setAttribute('aria-expanded', 'false');
  }
  save(); render(); $('#main').focus({preventScroll:true});
}
function render() {
  document.querySelectorAll('.tooltip').forEach(el => el.remove());
  state.compared = state.compared.filter(id => materials().some(m => m.id === id)).slice(0,4);
  document.querySelectorAll('.tab').forEach(t => { t.classList.toggle('active',t.dataset.view === state.view); t.setAttribute('aria-current', t.dataset.view === state.view ? 'page' : 'false'); });
  const meta = {
    explore: ['MATERIAL EXPLORER','Explore materials','Search, screen, and inspect material records.'],
    chart: ['VISUAL SELECTION','Selection chart','Compare properties and drag across the plot to create limits.'],
    compare: ['SHORTLIST','Compare & rank','Review up to four candidates side by side.'],
    library: ['PERSONAL RECORDS','My library','Import your data and keep selection projects on this device.'],
    about: ['ABOUT MATERIAL ATLAS','About the app','An independent open-source workspace for material selection.']
  }[state.view];
  $('#viewEyebrow').textContent = meta[0]; $('#viewTitle').textContent = meta[1]; $('#viewDescription').textContent = meta[2];
  $('#remainingCount').textContent = passing().length;
  $('#resultCount').textContent = `${passing().length} / ${materials().length} pass`;
  $('#compareCount').textContent = `${state.compared.length} / 4 compared`;
  const activeStages = state.families.length + state.limits.length + Number(Boolean(state.process)) + Number(Boolean(state.standard)) + Number(Boolean(state.productForm)) + Number(state.indexFilter);
  $('#mobileStageSummary').textContent = activeStages ? `${activeStages} active · ${passing().length} pass` : `${materials().length} materials`;
  renderSidebar();
  ['explore','chart','compare','library','about'].forEach(v => $(`#${v}View`).hidden = v !== state.view);
  ({explore:renderExplore,chart:renderChart,compare:renderCompare,library:renderLibrary,about:renderAbout})[state.view]();
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
function renderChart() {
  document.querySelectorAll('.tooltip').forEach(el => el.remove());
  const options = properties.map(k=>`<option value="${k}">${PROPERTIES[k].label} (${PROPERTIES[k].unit})</option>`).join('');
  const preset=PRESETS[state.indexPreset];
  $('#chartView').innerHTML = `<div class="panel control-bar"><div class="axis-controls"><label class="control">Horizontal axis<select id="chartX">${options}</select></label><label class="control">Vertical axis<select id="chartY">${options}</select></label><label class="check-row"><span><input type="checkbox" id="chartLogX" ${state.chartLogX?'checked':''}>Log X</span></label><label class="check-row"><span><input type="checkbox" id="chartLogY" ${state.chartLogY?'checked':''}>Log Y</span></label><button class="button outline" id="resetChart">Reset axes</button></div><div class="plot-meta-controls"><label class="control">Plot title<input id="chartTitle" maxlength="120" value="${escapeHTML(state.chartTitle||'')}" placeholder="Material property chart"></label><label class="control">Source note<input id="chartNote" maxlength="160" value="${escapeHTML(state.chartNote||'')}" placeholder="Optional source / project note"></label></div></div>
  <div class="panel index-panel"><div class="section-heading"><div><span class="eyebrow">PERFORMANCE INDEX</span><h2>Choose a design case</h2></div></div><div class="index-controls"><label class="control">Function and constraint<select id="indexPreset"><option value="">None · property chart only</option>${Object.entries(PRESETS).map(([key,p])=>`<option value="${key}" ${state.indexPreset===key?'selected':''}>${p.name}</option>`).join('')}</select></label>${preset?`<label class="control">Index threshold <strong id="thresholdLabel">${state.indexLevel}%</strong><input id="indexLevel" type="range" min="0" max="100" value="${state.indexLevel}"></label><label class="check-row"><span><input id="indexFilter" type="checkbox" ${state.indexFilter?'checked':''}>Use line as selection stage</span></label>`:''}</div>${preset?`<p class="score-note"><strong>Maximize ${preset.formula}</strong> · ${preset.assumption} The dashed line marks the chosen threshold; candidates above it have a higher index.</p>`:'<p class="score-note">Choose a design case to calculate an index and display its threshold line.</p>'}</div>
  <div class="chart-layout"><div class="panel chart-card"><div class="chart-actions"><strong>${escapeHTML(preset?.name||'Material property chart')}</strong><div><button class="tiny-button" data-action="chartSVG">Download SVG</button><button class="tiny-button" data-action="chartPNG">Download PNG</button><button class="tiny-button" data-action="chartData">Plot data CSV</button><button class="tiny-button chart-save" data-action="saveProject">Save project</button></div></div><svg id="scatter" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Interactive material property scatter plot" viewBox="0 0 860 500"></svg><p class="chart-foot">Drag on the chart to add property limits. On a phone, use Add limit in Selection filters. Click a point for its full record.</p></div><aside class="panel chart-aside"><h3>Families</h3>${FAMILIES.filter(f=>materials().some(m=>m.family===f)).map(f=>`<div class="legend-item"><i class="swatch" style="background:${COLORS[f]}"></i>${f}</div>`).join('')}<hr><p><strong>${passing().length}</strong> of ${materials().length} materials pass the current stages.</p>${preset?`<h3>Index leaders</h3>${materials().map(m=>({m,v:indexValue(m,preset)})).filter(x=>x.v!=null).sort((a,b)=>b.v-a.v).slice(0,5).map(({m,v})=>`<div class="leader-row"><span>${escapeHTML(m.name)}</span><strong>${Number(v).toPrecision(3)}</strong></div>`).join('')}<p class="score-note">Values use SI property units. Compare candidates under the same stated assumptions.</p>`:'<p>Set material families and numeric constraints to narrow the plot.</p>'}</aside></div>`;
  $('#chartX').value = state.chartX; $('#chartY').value = state.chartY;
  drawScatter();
}
function drawScatter() {
  const svg = $('#scatter'); if(!svg) return;
  svg._bubble?.remove();
  const X = state.chartX, Y = state.chartY, lx = state.chartLogX, ly = state.chartLogY;
  const entries = materials().filter(m => Number.isFinite(m[X]) && Number.isFinite(m[Y]) && (!lx || m[X]>0) && (!ly || m[Y]>0));
  const conv=(v,log)=>log?Math.log10(v):v;
  const extent=(key,log)=>{let a=entries.map(m=>conv(m[key],log));if(!a.length)return [0,1];let min=Math.min(...a),max=Math.max(...a),pad=(max-min||1)*.08;return [min-pad,max+pad]};
  const [xmin,xmax]=extent(X,lx),[ymin,ymax]=extent(Y,ly), left=86,right=815,top=28,bottom=421;
  const xx=v=>left+(conv(v,lx)-xmin)/(xmax-xmin)*(right-left), yy=v=>bottom-(conv(v,ly)-ymin)/(ymax-ymin)*(bottom-top);
  const invX=v=>lx?10**(xmin+(v-left)/(right-left)*(xmax-xmin)):xmin+(v-left)/(right-left)*(xmax-xmin);
  const invY=v=>ly?10**(ymin+(bottom-v)/(bottom-top)*(ymax-ymin)):ymin+(bottom-v)/(bottom-top)*(ymax-ymin);
  const tick=(v,log)=>new Intl.NumberFormat('en-US',{maximumSignificantDigits:3,notation:(log && Math.abs(v)>1e5)?'compact':'standard'}).format(log?10**v:v);
  let html=`<title>${escapeHTML(state.chartTitle||PROPERTIES[Y].label+' against '+PROPERTIES[X].label)}</title><desc>Material Atlas selection chart with ${entries.length} materials</desc><defs><clipPath id="rangeClip"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs><rect width="860" height="500" fill="#fff"/><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}" fill="#fafcfd" stroke="#d7e3ea"/>`;
  for(let i=0;i<=5;i++){let x=left+i*(right-left)/5,y=top+i*(bottom-top)/5;html+=`<line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" stroke="#e9f0f4"/><text x="${x}" y="${bottom+20}" text-anchor="middle" fill="#627a8c" font-size="12">${tick(xmin+i*(xmax-xmin)/5,lx)}</text><line x1="${left}" x2="${right}" y1="${y}" y2="${y}" stroke="#e9f0f4"/><text x="${left-10}" y="${y+4}" text-anchor="end" fill="#627a8c" font-size="12">${tick(ymax-i*(ymax-ymin)/5,ly)}</text>`}
  html+=`<text x="450" y="483" text-anchor="middle" fill="#314e65" font-size="14" font-weight="650">${escapeHTML(PROPERTIES[X].label)} (${escapeHTML(PROPERTIES[X].unit)})</text><text transform="translate(19,235) rotate(-90)" text-anchor="middle" fill="#314e65" font-size="14" font-weight="650">${escapeHTML(PROPERTIES[Y].label)} (${escapeHTML(PROPERTIES[Y].unit)})</text>`;
  if(state.chartTitle)html+=`<text x="450" y="19" text-anchor="middle" fill="#143754" font-size="13" font-weight="700">${escapeHTML(state.chartTitle)}</text>`;
  for(const limit of state.limits){
    if(limit.key===X){let x=xx(Number(limit.value));if(Number.isFinite(x)&&x>=left&&x<=right)html+=`<path d="M ${x} ${top} V ${bottom}" stroke="#b55d1e" stroke-width="1.5" stroke-dasharray="5 5"/>`}
    if(limit.key===Y){let y=yy(Number(limit.value));if(Number.isFinite(y)&&y>=top&&y<=bottom)html+=`<path d="M ${left} ${y} H ${right}" stroke="#b55d1e" stroke-width="1.5" stroke-dasharray="5 5"/>`}
  }
  const preset=PRESETS[state.indexPreset];
  if(preset && X==='density' && Y===preset.property){
    const threshold=currentIndexThreshold();
    const x1=invX(left),x2=invX(right),y1=indexLineY(x1,threshold,preset),y2=indexLineY(x2,threshold,preset);
    if(y1>0 && y2>0){html+=`<defs><clipPath id="plotClip"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs><g clip-path="url(#plotClip)"><path d="M ${left} ${yy(y1)} L ${right} ${yy(y2)}" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-dasharray="9 5"/></g><text x="${right-7}" y="${top+18}" text-anchor="end" fill="#2563eb" font-size="12" font-weight="700">Index threshold · ${escapeHTML(preset.formula)}</text>`}
  }
  entries.sort((a,b)=>Number(matches(a))-Number(matches(b)));
  html+=entries.map(m=>{
    const xlo=m[`${X}_min`],xhi=m[`${X}_max`],ylo=m[`${Y}_min`],yhi=m[`${Y}_max`];
    const xRange=Number.isFinite(xlo)&&Number.isFinite(xhi) && (!lx || xlo>0) && xlo<=xhi;
    const yRange=Number.isFinite(ylo)&&Number.isFinite(yhi) && (!ly || ylo>0) && ylo<=yhi;
    const stroke=COLORS[m.family]||COLORS.Other;
    return `<g clip-path="url(#rangeClip)">${xRange?`<path d="M ${xx(xlo)} ${yy(m[Y])} H ${xx(xhi)}" stroke="${stroke}" stroke-opacity=".65" stroke-width="2"/>`:''}${yRange?`<path d="M ${xx(m[X])} ${yy(ylo)} V ${yy(yhi)}" stroke="${stroke}" stroke-opacity=".65" stroke-width="2"/>`:''}</g>`;
  }).join('');
  html+=entries.map(m=>`<circle tabindex="0" role="button" aria-label="Open ${escapeHTML(m.name)}" data-point="${escapeHTML(m.id)}" cx="${xx(m[X]).toFixed(2)}" cy="${yy(m[Y]).toFixed(2)}" r="${matches(m)?7:5}" fill="${COLORS[m.family]||COLORS.Other}" fill-opacity="${matches(m)?.85:.16}" stroke="${matches(m)?'#fff':'none'}" stroke-width="1.5" style="cursor:pointer"/>`).join('');
  html+=`<rect id="brush" x="0" y="0" width="0" height="0" fill="#38b8b4" fill-opacity=".18" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="5 4" pointer-events="none"/>`;
  svg.innerHTML=html;
  let drag=null, moved=false;
  const pos=e=>{let r=svg.getBoundingClientRect();return {x:Math.min(right,Math.max(left,(e.clientX-r.left)*860/r.width)),y:Math.min(bottom,Math.max(top,(e.clientY-r.top)*500/r.height))}};
  svg.onpointerdown=e=>{if(e.pointerType==='touch'||e.target.dataset.point)return;let p=pos(e);if(p.x<=left||p.x>=right||p.y<=top||p.y>=bottom)return;drag=p;moved=false;svg.setPointerCapture(e.pointerId)};
  svg.onpointermove=e=>{if(!drag)return;let p=pos(e);moved=Math.abs(p.x-drag.x)>5&&Math.abs(p.y-drag.y)>5;let b=$('#brush',svg);b.setAttribute('x',Math.min(drag.x,p.x));b.setAttribute('y',Math.min(drag.y,p.y));b.setAttribute('width',Math.abs(drag.x-p.x));b.setAttribute('height',Math.abs(drag.y-p.y))};
  svg.onpointerup=e=>{if(!drag)return;let p=pos(e),a=drag;drag=null;if(!moved){$('#brush',svg).setAttribute('width',0);return}if(state.limits.length>8){$('#brush',svg).setAttribute('width',0);return toast('Remove limits before adding another chart selection.')}let limits=[{key:X,op:'min',value:+invX(Math.min(a.x,p.x)).toPrecision(5)},{key:X,op:'max',value:+invX(Math.max(a.x,p.x)).toPrecision(5)},{key:Y,op:'min',value:+invY(Math.max(a.y,p.y)).toPrecision(5)},{key:Y,op:'max',value:+invY(Math.min(a.y,p.y)).toPrecision(5)}];state.limits.push(...limits);save();render();toast('Chart selection added four property limits.');};
  svg.onpointercancel=()=>{drag=null;$('#brush',svg).setAttribute('width',0)};
  const bubble=document.createElement('div');bubble.className='tooltip';bubble.hidden=true;document.body.append(bubble);
  svg.onpointerover=e=>{let id=e.target.dataset.point;if(!id)return;let m=materials().find(x=>x.id===id);if(!m)return;bubble.textContent=`${m.name} · ${fmt(m[X],X)} / ${fmt(m[Y],Y)}`;bubble.hidden=false};
  svg.onpointermove=e=>{if(!bubble.hidden){bubble.style.left=Math.min(innerWidth-260,e.clientX+14)+'px';bubble.style.top=Math.max(5,e.clientY-46)+'px'}if(drag){let p=pos(e);moved=Math.abs(p.x-drag.x)>5&&Math.abs(p.y-drag.y)>5;let b=$('#brush',svg);b.setAttribute('x',Math.min(drag.x,p.x));b.setAttribute('y',Math.min(drag.y,p.y));b.setAttribute('width',Math.abs(drag.x-p.x));b.setAttribute('height',Math.abs(drag.y-p.y))}};
  svg.onpointerout=e=>{if(e.target.dataset.point)bubble.hidden=true};
  // The tooltip is scoped to this render and removed before the next SVG is drawn.
  svg._bubble=bubble;
}
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
  $('#libraryView').innerHTML=`<div class="panel"><div class="section-heading"><div><span class="eyebrow">DATA MANAGEMENT</span><h2>Materials in this browser</h2></div><strong class="pill-count">${state.custom.length} personal records</strong></div><div class="library-actions"><div class="library-action-group"><button class="button primary" data-action="add">+ Add material</button><button class="button outline" data-action="importLibrary">Import CSV / Excel</button></div><div class="library-action-group"><button class="button outline" data-action="templateXLSX">Excel template</button><button class="button outline" data-action="templateCSV">CSV template</button></div><div class="library-action-group"><button class="button outline" data-action="exportCSVAll">Export library</button><button class="button outline" data-action="backup">JSON backup</button><button class="button outline" data-action="restore">Restore</button></div></div><p class="library-note">Required columns: <code>name</code>, <code>family</code>. Download a template for all fields, units and an example. Imports are previewed before saving. Your records stay in this browser.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Material / grade</th><th>Family</th><th>Source</th><th>Actions</th></tr></thead><tbody>${state.custom.map(m=>`<tr><td><button class="name-button" data-open="${escapeHTML(m.id)}">${escapeHTML(m.name)}</button><span class="subtext">${escapeHTML(m.grade_condition||m.subtype||'Condition unspecified')}</span></td><td>${escapeHTML(m.family)}</td><td>${escapeHTML(m.source||'—')}</td><td><button class="tiny-button" data-edit="${escapeHTML(m.id)}">Edit</button> <button class="tiny-button danger" data-delete="${escapeHTML(m.id)}">Delete</button></td></tr>`).join('')}</tbody></table>${state.custom.length?'':'<div class="empty"><strong>No personal materials yet</strong>Add a material or import a library you have permission to use.</div>'}</div></div>
  <div class="panel project-panel"><div class="section-heading"><div><span class="eyebrow">SELECTION PROJECTS</span><h2>Saved design cases</h2></div><button class="button primary" data-action="saveProject">Save current setup</button></div><p class="score-note">A project saves your constraints, chart, index, ranking, shortlist and notes. It uses the current material library when reopened.</p><div class="project-list">${state.projects.map(p=>`<article class="project-item"><div><strong>${escapeHTML(p.name)}</strong><p>${escapeHTML(p.objective||'No design note')} · ${new Date(p.updatedAt).toLocaleDateString()}</p></div><div><button class="tiny-button" data-project-load="${escapeHTML(p.id)}">Open</button><button class="tiny-button danger" data-project-delete="${escapeHTML(p.id)}">Delete</button></div></article>`).join('')||'<p class="muted">No saved projects yet.</p>'}</div></div><p class="foot-note">${state.deletedSeeds.length} illustrative samples hidden. <button class="text-button" id="restoreSamples">Restore all samples</button> · Clearing browser data removes local records and projects. Keep a JSON backup.</p><input id="fileInput" type="file" accept=".csv,.xlsx,.json,text/csv,application/json" hidden>`;
}
function renderAbout(){
  $('#aboutView').innerHTML=`<div class="about-grid"><article class="panel about-card"><span class="eyebrow">THE WORKSPACE</span><h2>Material selection with a traceable path</h2><p>Browse candidate materials, apply design constraints, compare properties and explore performance indices for a stated component and load case. Import your own sourced library, save a project and export the plot for your report.</p><div class="about-stat"><strong>${materials().length}</strong><span>materials available in this browser</span></div><p>Bundled records are illustrative examples. Values, processing conditions, availability, costs and environmental figures must be checked against current sources before engineering use.</p></article><article class="panel about-card"><span class="eyebrow">CREDITS</span><h2>An independent project</h2><p>Created by <strong>Edgar Mendonca</strong> with development assistance from <strong>OpenAI GPT-6 Sol</strong>.</p><p>Open-source software under the MIT License. The included sample data is illustrative; import your own traceable records for real decisions.</p><p>Each person's material library and saved projects are stored in their own browser. Nothing is uploaded to an app server. Export a JSON backup before clearing site data or moving devices.</p><button class="button outline" data-action="backup">Export my backup</button></article><article class="panel about-card about-wide"><span class="eyebrow">HOW TO USE IT</span><div class="about-steps"><div><strong>01 · Source</strong><p>Import a CSV or Excel file using the library template. Keep each grade, condition and source identifiable.</p></div><div><strong>02 · Screen</strong><p>Filter by family, manufacturing process and numeric limits. Missing values fail active limits.</p></div><div><strong>03 · Select</strong><p>Compare up to four materials, choose a calculation preset and move its index line.</p></div><div><strong>04 · Present</strong><p>Save the design case, download an SVG or PNG plot and print a comparison report.</p></div></div></article></div>`;
}
function openDetail(id) {
  const m=materials().find(x=>x.id===id); if(!m)return;
  const d=derived(m),failed=reasons(m),index=PRESETS[state.indexPreset]?indexValue(m,PRESETS[state.indexPreset]):null;
  $('#detailContent').innerHTML=`<div class="dialog-header"><div><span class="eyebrow">${m.origin==='sample'?'ILLUSTRATIVE SAMPLE':'PERSONAL RECORD'}</span><h2>${escapeHTML(m.name)}</h2></div><button class="icon-button" data-close="detailDialog" aria-label="Close">×</button></div><div class="detail-tags"><span class="family-chip chip-${escapeHTML(m.family)}">${escapeHTML(m.family)}</span><span class="family-chip">${escapeHTML(m.subtype||'Unclassified')}</span></div><div class="detail-grid">${properties.map(k=>`<div class="property-line"><span>${PROPERTIES[k].label}</span><strong>${fmt(m[k],k)}${Number.isFinite(m[`${k}_min`])&&Number.isFinite(m[`${k}_max`])?` <small>(${m[`${k}_min`]}–${m[`${k}_max`]})</small>`:''}</strong></div>`).join('')}<div class="property-line"><span>Cost per volume</span><strong>${d.costPerVolume==null?'—':`${Math.round(d.costPerVolume).toLocaleString()} USD/m³`}</strong></div><div class="property-line"><span>Carbon per volume</span><strong>${d.carbonPerVolume==null?'—':`${Math.round(d.carbonPerVolume).toLocaleString()} kg CO₂e/m³`}</strong></div>${index!=null?`<div class="property-line"><span>${escapeHTML(PRESETS[state.indexPreset].formula)} (SI)</span><strong>${index.toPrecision(4)}</strong></div>`:''}</div><div class="detail-source"><strong>Numeric data:</strong> ${properties.filter(k=>Number.isFinite(m[k])).length} / ${properties.length} properties populated<br><strong>Grade / condition:</strong> ${escapeHTML(m.grade_condition||'Unspecified')}<br><strong>Standard / form:</strong> ${escapeHTML(m.standard||'—')} · ${escapeHTML(m.product_form||'—')}<br><strong>Processes:</strong> ${escapeHTML(m.processes.join(', ')||'Not supplied')}<br><strong>Source:</strong> ${escapeHTML(m.source||'Not supplied')} ${escapeHTML(m.source_revision||'')}<br><strong>Test temperature:</strong> ${m.test_temperature_c==null?'—':`${m.test_temperature_c} °C`}<br><strong>Composition:</strong> ${escapeHTML(m.composition||'Not supplied')}<br><strong>Corrosion notes:</strong> ${escapeHTML(m.corrosion_notes||'Not supplied')}<br><strong>Availability:</strong> ${escapeHTML(m.availability||'Not supplied')}</div>${failed.length?`<p class="failure-reasons">Current stage result: ${failed.map(escapeHTML).join(' · ')}</p>`:'<p class="success-note">Passes all current selection stages.</p>'}${m.notes?`<p class="detail-note">${escapeHTML(m.notes)}</p>`:''}<div class="dialog-actions details-actions"><button class="button outline" data-compare="${escapeHTML(m.id)}">${state.compared.includes(m.id)?'Remove comparison':'Add to comparison'}</button>${m.origin==='custom'?`<button class="button outline" data-edit="${escapeHTML(m.id)}">Edit</button><button class="button outline danger" data-delete="${escapeHTML(m.id)}">Delete</button>`:`<button class="button outline danger" data-delete="${escapeHTML(m.id)}">Hide sample</button>`}<button class="button primary" data-close="detailDialog">Close</button></div>`;
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
    ${field('test_temperature_c','Test temperature (°C)','number')}${field('composition','Chemical composition / basis')}${field('corrosion_notes','Corrosion / chemical compatibility notes')}${field('availability','Availability / location')}${field('source','Traceable source','text','Document or supplier datasheet')}${field('source_revision','Source revision / date')}<label class="field wide">Notes / test condition<textarea name="notes">${escapeHTML(m?.notes||'')}</textarea></label>`;
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
  for(const key of ['material_id','subtype','grade_condition','standard','product_form','composition','corrosion_notes','availability','source','source_revision','notes'])m[key]=String(raw[key]||'').trim();
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
const recordKey=m=>String(m.material_id||`${m.name}|${m.family}|${m.grade_condition||''}`).trim().toLowerCase();
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
  const keys=['deletedSeeds','favorites','compared','families','limits','process','standard','productForm','chartX','chartY','chartLogX','chartLogY','chartTitle','chartNote','rankA','rankB','weightA','indexPreset','indexLevel','indexFilter','projects','activeProjectId'];
  state={...structuredClone(base),...Object.fromEntries(keys.filter(k=>Object.hasOwn(json,k)).map(k=>[k,json[k]])),custom:incoming,view:'library'};
  for(const key of ['deletedSeeds','favorites','compared','families','limits','projects'])if(!Array.isArray(state[key]))state[key]=[];
  state.deletedSeeds=state.deletedSeeds.filter(id=>SEED.some(m=>m.id===id));
  state.compared=state.compared.map(id=>ids.get(String(id))||id).filter(id=>SEED.some(m=>m.id===id)||incoming.some(m=>m.id===id)).slice(0,4);
  state.families=state.families.filter(f=>FAMILIES.includes(f));
  state.limits=state.limits.filter(l=>properties.includes(l?.key)&&['min','max'].includes(l?.op)&&Number.isFinite(Number(l.value))).slice(0,12);
  state.chartX=properties.includes(state.chartX)?state.chartX:'density';state.chartY=properties.includes(state.chartY)?state.chartY:'modulus';
  state.rankA=properties.includes(state.rankA)?state.rankA:'density';state.rankB=properties.includes(state.rankB)?state.rankB:'modulus';
  state.indexPreset=PRESETS[state.indexPreset]?state.indexPreset:'';
  state.indexLevel=Number.isFinite(Number(state.indexLevel))?Math.max(0,Math.min(100,Number(state.indexLevel))):50;
  for(const key of ['process','standard','productForm','chartTitle','chartNote'])if(typeof state[key]!=='string')state[key]='';
  state.projects=Array.isArray(state.projects)?state.projects.filter(p=>p&&typeof p.name==='string'&&p.settings&&typeof p.settings==='object').slice(0,100):[];
  state.activeProjectId='';save();render();toast(`${incoming.length} records and ${state.projects.length} projects restored.`);
}
function openProjectForm(){
  const p=state.projects.find(p=>p.id===state.activeProjectId);
  $('#projectName').value=p?.name||'';$('#projectObjective').value=p?.objective||'';
  $('#projectDialog').showModal();$('#projectName').focus();
}
function projectSettings(){return Object.fromEntries(['families','limits','process','standard','productForm','compared','chartX','chartY','chartLogX','chartLogY','chartTitle','chartNote','rankA','rankB','weightA','indexPreset','indexLevel','indexFilter'].map(k=>[k,structuredClone(state[k])]))}
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
  state.activeProjectId=p.id;state.view='chart';save();render();toast(`Opened ${p.name}.`);
}
function exportPlotSVG(){
  const svg=$('#scatter');if(!svg)return '';
  const clone=svg.cloneNode(true);clone.removeAttribute('id');clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width','860');clone.setAttribute('height','565');clone.setAttribute('viewBox','0 0 860 565');clone.querySelector('#brush')?.remove();clone.querySelectorAll('[data-point]').forEach(p=>{p.removeAttribute('tabindex');p.removeAttribute('role')});
  const legend=FAMILIES.filter(f=>materials().some(m=>m.family===f)).map((f,i)=>`<circle cx="${85+(i%3)*245}" cy="${505+Math.floor(i/3)*23}" r="5" fill="${COLORS[f]}"/><text x="${99+(i%3)*245}" y="${509+Math.floor(i/3)*23}" fill="#314e65" font-size="12">${f}</text>`).join('');
  clone.insertAdjacentHTML('beforeend',`<rect x="0" y="500" width="860" height="65" fill="white"/>${legend}<text x="85" y="555" fill="#63758a" font-size="11">${escapeHTML((state.chartNote||'').slice(0,80))}</text><text x="820" y="555" text-anchor="end" fill="#63758a" font-size="11">Material Atlas</text>`);
  return new XMLSerializer().serializeToString(clone);
}
async function exportPNG(){
  const markup=exportPlotSVG();if(!markup)return;
  const src=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));const img=new Image();
  try {await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=src});const canvas=document.createElement('canvas');canvas.width=2580;canvas.height=1695;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)throw Error('Could not render the PNG.');download('material-atlas-chart.png',png,'image/png')}
  catch(e){alert(`PNG export failed: ${e.message}`)}finally{URL.revokeObjectURL(src)}
}
function init() {
  document.addEventListener('click',e=>{
    let t=e.target.closest('button');if(!t)return;
    if(t.dataset.view)return setView(t.dataset.view);
    if(t.dataset.close)return $(`#${t.dataset.close}`).close();
    if(t.dataset.open)return openDetail(t.dataset.open);
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
    if(t.id==='resetChart'){state.chartX='density';state.chartY='modulus';state.chartLogX=true;state.chartLogY=true;save();return render()}
    if(t.id==='restoreSamples'){state.deletedSeeds=[];save();render();return toast('All sample records restored.')}
    if(t.id==='printReport')return window.print();
    if(t.dataset.action==='exportCSV')return exportCSV(passing().filter(m=>searchText(m).includes(search.toLowerCase())));
    if(t.dataset.action==='exportCSVAll')return exportCSV(state.custom,'material-atlas-my-library.csv');
    if(t.dataset.action==='templateCSV')return download('material-atlas-import-template.csv',writeCSV([EXAMPLE]),'text/csv');
    if(t.dataset.action==='templateXLSX')return download('material-atlas-import-template.xlsx',makeXLSXTemplate(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if(t.dataset.action==='backup')return download('material-atlas-backup.json',JSON.stringify({format:'material-atlas-v2',exportedAt:new Date().toISOString(),...state},null,2),'application/json');
    if(t.dataset.action==='importLibrary'||t.dataset.action==='restore'){let input=$('#fileInput');if(!input){setView('library');input=$('#fileInput')}input.value='';input.accept=t.dataset.action==='restore'?'.json,application/json':'.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';input.dataset.mode=t.dataset.action==='restore'?'json':'library';input.click();return}
    if(t.dataset.action==='saveProject')return openProjectForm();
    if(t.dataset.action==='chartSVG')return download('material-atlas-chart.svg',exportPlotSVG(),'image/svg+xml');
    if(t.dataset.action==='chartPNG')return exportPNG();
    if(t.dataset.action==='chartData')return download('material-atlas-chart-data.csv',writeCSV(materials().map(m=>({name:m.name,family:m.family,[state.chartX]:m[state.chartX],[state.chartY]:m[state.chartY],index:PRESETS[state.indexPreset]?indexValue(m,PRESETS[state.indexPreset]):'',passes:matches(m)?'yes':'no'})),['name','family',state.chartX,state.chartY,'index','passes'].filter((k,i,a)=>a.indexOf(k)===i)),'text/csv');
    if(t.id==='confirmImport')return finishImport();
  });
  document.addEventListener('change',e=>{let t=e.target;
    if(t.dataset.family){state.families=t.checked?[...state.families,t.dataset.family]:state.families.filter(f=>f!==t.dataset.family);save();return render()}
    if(t.dataset.limit!==undefined){let l=state.limits[Number(t.dataset.limit)];if(!l)return;l[t.dataset.part]=t.dataset.part==='value'?t.value:t.value;save();return render()}
    if(t.id==='processFilter'){state.process=t.value;save();return render()}
    if(t.id==='standardFilter'||t.id==='formFilter'){state[t.id==='standardFilter'?'standard':'productForm']=t.value;save();return render()}
    if(t.id==='sortBox'){sort=t.value;return renderExplore()}
    if(t.id==='chartX'||t.id==='chartY'||t.id==='chartLogX'||t.id==='chartLogY'){if($('#scatter')?._bubble)$('#scatter')._bubble.remove();state[t.id]=t.type==='checkbox'?t.checked:t.value;save();return renderChart()}
    if(t.id==='chartTitle'||t.id==='chartNote'){state[t.id]=t.value.trim();save();return renderChart()}
    if(t.id==='indexPreset'){state.indexPreset=t.value;state.indexFilter=false;if(PRESETS[t.value]){state.chartX='density';state.chartY=PRESETS[t.value].property;state.chartLogX=true;state.chartLogY=true}save();return render()}
    if(t.id==='indexFilter'){state.indexFilter=t.checked;save();return render()}
    if(t.id==='indexLevel'){state.indexLevel=Number(t.value);save();return render()}
    if(t.dataset.map!==undefined){const key=t.value;const i=Number(t.dataset.map);if(key && importDraft.mapping.some((value,j)=>j!==i && value===key)){t.value=importDraft.mapping[i];return toast('Map each material field to only one column.')}importDraft.mapping[i]=key;return renderImportPreview()}
    if(t.id==='rankA'||t.id==='rankB'||t.id==='weightA'){state[t.id]=t.id==='weightA'?Math.max(0,Math.min(100,Number(t.value)||0)):t.value;save();return renderCompare()}
    if(t.id==='fileInput')return importFile(t.files[0],t.dataset.mode==='json'?'json':t.files[0]?.name.toLowerCase().endsWith('.xlsx')?'xlsx':'csv');
  });
  document.addEventListener('input',e=>{if(e.target.id==='searchBox'){search=e.target.value;let caret=e.target.selectionStart;renderExplore();$('#searchBox').focus();$('#searchBox').setSelectionRange(caret,caret)}if(e.target.id==='indexLevel'){state.indexLevel=Number(e.target.value);$('#thresholdLabel').textContent=state.indexLevel+'%';drawScatter()}});
  $('#materialForm').addEventListener('submit',e=>{e.preventDefault();try{let raw=Object.fromEntries(new FormData(e.target));let m=normalizeRecord(raw);if(editing){m.id=editing;let index=state.custom.findIndex(x=>x.id===editing);if(index<0)throw Error('Record no longer exists.');state.custom[index]=m}else state.custom.push(m);save();$('#materialDialog').close();render();toast(editing?'Material updated.':'Material saved in this browser.')}catch(err){alert(err.message)}});
  $('#projectForm').addEventListener('submit',e=>{e.preventDefault();saveProject()});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target?.dataset?.point){e.preventDefault();openDetail(e.target.dataset.point)}});
  document.addEventListener('click',e=>{if(e.target?.dataset?.point)openDetail(e.target.dataset.point)});
  render();
}
loadWorkspace().then(saved=>{
  state={...structuredClone(base),...(saved&&typeof saved==='object'?saved:{})};
  for(const key of ['custom','deletedSeeds','favorites','compared','families','limits','projects'])if(!Array.isArray(state[key]))state[key]=[];
  state.view=['explore','chart','compare','library','about'].includes(state.view)?state.view:'explore';
  state.indexPreset=PRESETS[state.indexPreset]?state.indexPreset:'';
  state.indexLevel=Number.isFinite(Number(state.indexLevel))?Math.max(0,Math.min(100,Number(state.indexLevel))):50;
  init();
});
