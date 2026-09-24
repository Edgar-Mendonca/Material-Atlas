// Browser-only CSV and XLSX interchange. XLSX files are ZIP containers of XML.
// The bundled fflate library decompresses them; no workbook macros are executed.
const FIELDS = [
  'material_id','name','family','subtype','grade_condition','standard','product_form',
  'density','density_min','density_max','modulus','modulus_min','modulus_max',
  'yield','yield_min','yield_max','tensile','temp','thermal','cost','carbon',
  'elongation_pct','hardness_hb','fatigue_strength_mpa',
  'fracture_toughness_mpa_sqrt_m','cte_per_k','heat_capacity_j_kg_k',
  'electrical_resistivity_ohm_m','recyclability_pct',
  'processes','composition','corrosion_notes','availability','source','source_revision','test_temperature_c','notes'
];
export const COLUMNS = FIELDS;
export const NUMBERS = new Set([
  'density','density_min','density_max','modulus','modulus_min','modulus_max',
  'yield','yield_min','yield_max','tensile','temp','thermal','cost','carbon',
  'elongation_pct','hardness_hb','fatigue_strength_mpa',
  'fracture_toughness_mpa_sqrt_m','cte_per_k','heat_capacity_j_kg_k',
  'electrical_resistivity_ohm_m','recyclability_pct','test_temperature_c'
]);
export const UNITS = {
  density:'kg/m³', density_min:'kg/m³',density_max:'kg/m³',modulus:'GPa',modulus_min:'GPa',modulus_max:'GPa',yield:'MPa',yield_min:'MPa',yield_max:'MPa',tensile:'MPa', temp:'°C',
  thermal:'W/(m·K)', cost:'USD/kg', carbon:'kg CO₂e/kg', elongation_pct:'%',
  hardness_hb:'HB', fatigue_strength_mpa:'MPa',
  fracture_toughness_mpa_sqrt_m:'MPa√m', cte_per_k:'1/K',
  heat_capacity_j_kg_k:'J/(kg·K)', electrical_resistivity_ohm_m:'Ω·m',
  recyclability_pct:'%',test_temperature_c:'°C'
};
export const EXAMPLE = {
  material_id:'EXAMPLE-01', name:'Example alloy — replace this row', family:'Metals',
  subtype:'Aluminium alloy', grade_condition:'Example temper', standard:'Example only',
  product_form:'Plate', density:2700, modulus:69, yield:275, tensile:310, temp:150,
  thermal:167, cost:4, carbon:9, processes:'Rolling;Machining',
  source:'Illustrative example — replace with traceable datasheet',
  notes:'Delete or replace this example row before importing your real library.'
};

export function parseCSV(input) {
  const s = input.replace(/^\uFEFF/, '');
  const out=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<s.length;i++) {
    const c=s[i];
    if(quoted) {
      if(c==='"' && s[i+1]==='"') {cell+='"'; i++}
      else if(c==='"') quoted=false;
      else cell+=c;
    } else if(c==='"' && !cell) quoted=true;
    else if(c===',') {row.push(cell); cell=''}
    else if(c==='\n') {row.push(cell.replace(/\r$/,'')); out.push(row); row=[]; cell=''}
    else cell+=c;
  }
  if(quoted) throw Error('Unclosed quotation mark in the CSV.');
  if(cell || row.length) {row.push(cell); out.push(row)}
  return out.filter(r=>r.some(v=>String(v).trim()));
}
function csvCell(value) {
  let s=String(value??'');
  // Protect people opening exported data in spreadsheet programs.
  if(/^\s*[=+@\-\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s="'"+s;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}
export function writeCSV(rows, columns=COLUMNS) {
  return '\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(k=>csvCell(k==='processes' && Array.isArray(r[k])?r[k].join(';'):r[k])).join(','))].join('\r\n')+'\r\n';
}

const xmlEscape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const xmlDoc = text => {const doc=new DOMParser().parseFromString(text,'application/xml'); if(doc.querySelector('parsererror'))throw Error('Invalid Excel workbook XML.'); return doc};
const children = (el,name) => [...el.childNodes].filter(n=>n.nodeType===1 && n.localName===name);
const first = (el,name) => children(el,name)[0];
const cellColumn = ref => {let n=0; for(const c of (ref.match(/^[A-Z]+/i)?.[0]||''))n=n*26+c.toUpperCase().charCodeAt(0)-64;return n-1};
const readXML = (files,path) => {let data=files[path]; if(!data)throw Error(`Missing workbook component: ${path}`);return xmlDoc(fflate.strFromU8(data))};

export function readXLSX(bytes) {
  if(!window.fflate)throw Error('Spreadsheet reader is unavailable.');
  const files=fflate.unzipSync(bytes);
  if(Object.values(files).reduce((sum,part)=>sum+part.length,0)>30_000_000)throw Error('Expanded workbook exceeds the 30 MB limit.');
  const workbook=readXML(files,'xl/workbook.xml');
  const rels=readXML(files,'xl/_rels/workbook.xml.rels');
  const sheets=[...workbook.getElementsByTagName('*')].filter(n=>n.localName==='sheet');
  const sheet=sheets.find(s=>s.getAttribute('name')==='Materials')||sheets[0];
  if(!sheet)throw Error('No worksheet found in the Excel file.');
  const relId=[...sheet.attributes].find(a=>a.localName==='id')?.value;
  const rel=[...rels.getElementsByTagName('*')].find(n=>n.localName==='Relationship' && n.getAttribute('Id')===relId);
  let target=rel?.getAttribute('Target');
  if(!target || /(^|\/)\.\.(\/|$)|^[a-z]+:/i.test(target))throw Error('Invalid worksheet reference.');
  const path=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target;
  const shared=files['xl/sharedStrings.xml']
    ? [...readXML(files,'xl/sharedStrings.xml').getElementsByTagName('*')].filter(n=>n.localName==='si').map(n=>[...n.getElementsByTagName('*')].filter(t=>t.localName==='t').map(t=>t.textContent).join(''))
    : [];
  const sheetDoc=readXML(files,path);
  const rows=[...sheetDoc.getElementsByTagName('*')].filter(n=>n.localName==='row').map(row=>{
    const values=[];for(const cell of children(row,'c')) {
      const col=cellColumn(cell.getAttribute('r')||''); if(col<0 || col>300)continue;
      const type=cell.getAttribute('t');
      const raw=first(cell,'v')?.textContent||'';
      const inline=first(cell,'is');
      values[col]=type==='s' ? shared[Number(raw)]??'' : type==='inlineStr' ? [...(inline?.getElementsByTagName('*')||[])].filter(n=>n.localName==='t').map(n=>n.textContent).join('') : raw;
    }
    return values.map(v=>v??'');
  }).filter(row=>row.some(v=>String(v).trim()));
  return {rows,sheetName:sheet.getAttribute('name')};
}

const colName = index => {let s='';for(let n=index+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};
function sheetXML(rows) {
  const body=rows.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>{
    if(value==null || value==='')return '';
    const address=`${colName(j)}${i+1}`;
    return typeof value==='number' ? `<c r="${address}"><v>${value}</v></c>`
      : `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}
export function makeXLSXTemplate() {
  const guide=[
    ['Material Atlas import guide',''],
    ['Sheet','Fill the Materials sheet. First row contains exact column names. Delete or replace the example row.'],
    ['Required','name and family. Keep grade and condition distinct where properties differ.'],
    ['Families','Metals; Polymers; Ceramics; Composites; Natural; Other.'],
    ['Processes','Separate multiple processes with semicolons, e.g. Casting;Machining.'],
    ['Unknown values','Leave the cell blank; do not enter zero unless it is measured zero.'],
    ['Source','Record a supplier datasheet, revision and relevant test condition.'],
    ['Units','Values in the Materials sheet must use these units; no automatic Excel unit detection.'],
    ...Object.entries(UNITS).map(([key,unit])=>[key,unit]),
    ['Privacy','Files are read in this browser and saved on this device; no server upload.']
  ];
  const encoder=fflate.strToU8;
  const files={
    '[Content_Types].xml':`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Materials" sheetId="1" r:id="rId1"/><sheet name="Guide" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml':sheetXML([COLUMNS,COLUMNS.map(k=>EXAMPLE[k]??'')]),
    'xl/worksheets/sheet2.xml':sheetXML(guide)
  };
  return fflate.zipSync(Object.fromEntries(Object.entries(files).map(([path,content])=>[path,encoder(content)])),{level:6});
}

const ALIASES={
  'material':'name', 'material_name':'name','grade':'name','id':'material_id',
  'density_kg_m3':'density','youngs_modulus_gpa':'modulus','yield_strength_mpa':'yield',
  'ultimate_tensile_strength_mpa':'tensile','thermal_conductivity_w_mk':'thermal',
  'price_usd_kg':'cost','co2_kg_per_kg':'carbon', 'condition':'grade_condition'
};
export function guessColumn(label) {
  const clean=String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  return COLUMNS.includes(clean)?clean:ALIASES[clean]||'';
}
