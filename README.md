# Material Atlas

**Current version: 2.3.0.** The Home tab opens each time the site loads; the other tabs open the working tools directly. Your material records and saved projects remain in the browser between visits.

## Features

- Explore 80 illustrative material records across metals, polymers, elastomers, foams, ceramics, composites and natural materials; add, edit, delete, import, and export personal data.
- Import CSV or `.xlsx` with column mapping, row validation, preview, and duplicate options. Download templates from **My library**.
- Apply family, process, standard, product form and numeric selection stages. Missing values fail active limits; optional min/max ranges are screened conservatively and shown as plot whiskers.
- Review a stage-by-stage pass/fail table and export its full results to CSV. Generate a printable selection report with project objective, applied stages, assumptions, source labels and passing candidates.
- Use one Plotly-powered chart workspace with suggested property pairs, a visible selection sidebar, responsive property plots and distributions, log scales, family envelopes, uncertainty whiskers where ranges are supplied, constraint lines and performance-index lines. Zoom, pan, box/lasso-select, inspect and link chart points to the candidate list. Export SVG, PNG or plot data CSV.
- Inspect an exploratory list of nearby materials within the same family, calculated from shared positive numeric properties; this is a comparison aid, not a qualification.
- Compare up to four candidates, see failure reasons and two-objective scores, and print a report.
- Save selection projects including constraints, chart axes, index, ranking, shortlist and design notes.
- Add source date, URL, test method and a user-selected evidence label to imported or personal records.
- Export a JSON backup or use **My library → Clear saved data** to remove this app's personal records, projects and settings from the current browser. This does not clear other websites or the browser cache.
- Use a responsive workspace with an accessible light interface. The About tab includes the author and AI development credit.
- Run the first Python selection analysis from **Results → Run Python analysis**. It screens the current materials against active stages, compares the outcome with the existing browser selection, and ranks passing records by the chosen performance index (or E/ρ by default). The standalone Python module is `python/material_atlas_core.py` and needs only the standard library.

## Python migration

The Python engine runs inside a module Web Worker using Pyodide v314.0.7, loaded from a pinned CDN only when **Run Python analysis** is pressed. The existing interface and charts still work without the Python download. A network connection is required for the first Python run; the user's material records are sent only to their own browser worker, not to a Python server. This release is the first migration slice: the standard results, chart, comparison, import and storage paths still use the existing JavaScript calculations. Results flags a discrepancy when Python screening and the existing stage selection disagree.

The Python module uses JSON-compatible records and settings. Run its meaningful checks with `npm run test:core` (requires a local Python executable named `python3`) or `python -m unittest discover -s python/tests -v` on Windows from this folder. Next migration steps are to reconcile any parity differences, use the Python result as the authoritative selection output across the whole UI, then move comparative ranking and derived properties. Keep the browser UI responsive and retain local backup/restore as the data layer evolves.

## CSV and Excel template

Download a template in **My library**. The first row lists column names. An Excel file should put records in a sheet named `Materials`; otherwise its first sheet is used. Delete or replace the marked example row before importing. Formulas need cached calculated values. Old `.xls` and macro-enabled files are not supported.

Only `name` and `family` are required. Family must be exactly `Metals`, `Polymers`, `Elastomers`, `Foams`, `Ceramics`, `Composites`, `Natural` or `Other`. Leave unknown numeric values blank. Use semicolons between multiple processes (`Casting;Machining`). Use a separate record for a distinct grade, heat treatment or product form when properties differ.

| Columns | Unit / meaning |
| --- | --- |
| `material_id`, `name`, `family`, `subtype`, `grade_condition`, `standard`, `product_form` | Identification and material condition |
| `density`, `density_min`, `density_max` | kg/m³ |
| `modulus`, `modulus_min`, `modulus_max` | Young's modulus, GPa |
| `yield`, `yield_min`, `yield_max`, `tensile` | MPa |
| `temp`, `test_temperature_c` | °C |
| `thermal`, `cost`, `carbon` | W/(m·K), indicative USD/kg, indicative kg CO₂e/kg |
| `elongation_pct`, `hardness_hb` | %, HB |
| `fatigue_strength_mpa`, `fracture_toughness_mpa_sqrt_m` | MPa, MPa√m |
| `cte_per_k`, `heat_capacity_j_kg_k` | 1/K, J/(kg·K) |
| `electrical_resistivity_ohm_m`, `recyclability_pct` | Ω·m, % |
| `processes`, `composition`, `corrosion_notes`, `availability`, `source`, `source_revision`, `source_date`, `source_url`, `evidence_level`, `test_standard`, `notes` | Manufacturing, chemistry, environment and provenance |

The earlier 14-field CSV template still imports. Preview can map alternate headers or ignore unknown columns. Every numeric column uses the units above; no automatic unit or currency conversion. `source_date` uses `YYYY-MM-DD`; `source_url` accepts http/https; `evidence_level` is `unverified`, `supplier`, `test`, or `reference`. The evidence label is supplied by the user and is not independently verified. A file can contain up to 1,500 records and must be smaller than 12 MB. Duplicate detection matches `material_id`, or name, family, grade condition and product form; choose whether to skip, replace or add separate records.

## Performance indices

| Design case | Maximize | Assumption |
| --- | --- | --- |
| Tension member, stiffness | E/ρ | Fixed length and axial stiffness |
| Tension member, yield strength | σᵧ/ρ | Fixed length and tensile yield load |
| Beam, bending stiffness | √E/ρ | Fixed length and section shape; scalable cross section |
| Beam, bending strength | σᵧ^(2/3)/ρ | Fixed length and section shape; scalable cross section |
| Plate, bending stiffness | E^(1/3)/ρ | Fixed area, variable thickness |

Calculations use SI units internally. The dashed chart line marks a movable index threshold. Cost and embodied carbon per unit volume are the per-kilogram values multiplied by density. A selection index is a comparison under stated assumptions, not a stress calculation, design allowable or feasibility certification.

The Selection chart keeps screening controls visible in a sticky sidebar on desktop. Choose a suggested property pair or your own axes. Drag to zoom; use the plot toolbar for pan, box selection or lasso selection. Box-selected points appear in the adjacent list; **Use box as limits** converts a rectangular selection to four numeric stages. **Locate** highlights a candidate and **Label** adds a point note. **Back**, **Fit data**, and **Axis limits** control the viewport. Plot settings and the performance index are expandable below the graph. The distribution counts passing records with a populated property; logarithmic bins have equal width in log space. Chart settings and selected point IDs are saved with a project. SVG exports retain vector content; PNG exports use a high-resolution image.

## GitHub Pages and development

Upload the complete **contents** of this folder to a repository root. In **Settings → Pages**, select **Deploy from a branch → main → /(root)**. GitHub Pages serves the committed compiled `styles.css`; it does not need npm or a build server.

To edit the styles, change `source.css`, run `npm install` and `npm run build:css`, then commit the regenerated `styles.css`. Tailwind CSS 4 runs only while building; the deployed app has no CSS CDN. To test locally, run `python3 -m http.server 8000` in this directory. ES modules need HTTP rather than `file://`.

Personal material libraries and projects stay in each user's browser using IndexedDB (localStorage fallback). Browser storage is not synchronized across devices and can be cleared. Export a JSON backup before changing browsers or clearing data.

## Data and licenses

Bundled property values are approximate teaching examples, not measured or certified design data. Families contain different material forms and failure modes; a value labeled tensile strength or service limit is not a common design allowable. Validate materials, grade, processing condition, environment, cost, and source against current manufacturer data and governing standards before engineering use. Import or publish third-party data only with permission.

App source and example data are MIT-licensed (`LICENSE`). The bundled [fflate](https://github.com/101arrowz/fflate) ZIP reader is MIT-licensed (`FFLATE-LICENSE.txt`). Bundled [Plotly.js Basic](https://github.com/plotly/plotly.js) 4.1.2 is MIT-licensed (`PLOTLY-LICENSE.txt`). [Pyodide](https://pyodide.org/en/stable/project/about.html) is MPL 2.0 and is fetched from its pinned CDN on demand. The deployed app needs no chart CDN.
