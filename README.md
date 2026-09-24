# Material Atlas

An independent, browser-only material selection app created by **Edgar Mendonca** with development assistance from **OpenAI GPT-6 Sol**. Runs as static files on GitHub Pages with no backend or account.

## Features

- Explore 32 illustrative material records; add, edit, delete, import, and export personal data.
- Import CSV or `.xlsx` with column mapping, row validation, preview, and duplicate options. Download templates from **My library**.
- Apply family, process, standard, product form and numeric selection stages. Missing values fail active limits; optional min/max ranges are screened conservatively and shown as plot whiskers.
- Draw property charts with log axes, box selection, and design-specific performance index lines. Export the plot as SVG, high-resolution PNG, or data CSV.
- Compare up to four candidates, see failure reasons and two-objective scores, and print a report.
- Save selection projects including constraints, chart axes, index, ranking, shortlist and design notes.
- Use a responsive workspace with an accessible light interface. The About tab includes the author and AI development credit.

## CSV and Excel template

Download a template in **My library**. The first row lists column names. An Excel file should put records in a sheet named `Materials`; otherwise its first sheet is used. Delete or replace the marked example row before importing. Formulas need cached calculated values. Old `.xls` and macro-enabled files are not supported.

Only `name` and `family` are required. Family must be exactly `Metals`, `Polymers`, `Ceramics`, `Composites`, `Natural` or `Other`. Leave unknown numeric values blank. Use semicolons between multiple processes (`Casting;Machining`). Use a separate record for a distinct grade, heat treatment or product form when properties differ.

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
| `processes`, `composition`, `corrosion_notes`, `availability`, `source`, `source_revision`, `notes` | Manufacturing, chemistry, environment and provenance |

The earlier 14-field CSV template still imports. Preview can map alternate headers or ignore unknown columns. Every numeric column uses the units above; no automatic unit or currency conversion. A file can contain up to 1,500 records and must be smaller than 12 MB. Duplicate detection matches `material_id`, or name, family and grade condition; choose whether to skip, replace or add separate records.

## Performance indices

| Design case | Maximize | Assumption |
| --- | --- | --- |
| Tension member, stiffness | E/ρ | Fixed length and axial stiffness |
| Tension member, yield strength | σᵧ/ρ | Fixed length and tensile yield load |
| Beam, bending stiffness | √E/ρ | Fixed length and section shape; scalable cross section |
| Beam, bending strength | σᵧ^(2/3)/ρ | Fixed length and section shape; scalable cross section |
| Plate, bending stiffness | E^(1/3)/ρ | Fixed area, variable thickness |

Calculations use SI units internally. The dashed chart line marks a movable index threshold. Cost and embodied carbon per unit volume are the per-kilogram values multiplied by density. A selection index is a comparison under stated assumptions, not a stress calculation, design allowable or feasibility certification.

## GitHub Pages and development

Upload the complete **contents** of this folder to a repository root. In **Settings → Pages**, select **Deploy from a branch → main → /(root)**. GitHub Pages serves the committed compiled `styles.css`; it does not need npm or a build server.

To edit the styles, change `source.css`, run `npm install` and `npm run build:css`, then commit the regenerated `styles.css`. Tailwind CSS 4 runs only while building; the deployed app has no CSS CDN. To test locally, run `python3 -m http.server 8000` in this directory. ES modules need HTTP rather than `file://`.

Personal material libraries and projects stay in each user's browser using IndexedDB (localStorage fallback). Browser storage is not synchronized across devices and can be cleared. Export a JSON backup before changing browsers or clearing data.

## Data and licenses

Bundled property values are approximate teaching examples, not measured or certified design data. Validate materials, grade, processing condition, environment, cost, and source against current manufacturer data and governing standards before engineering use. Import or publish third-party data only with permission.

App source and example data are MIT-licensed (`LICENSE`). The bundled [fflate](https://github.com/101arrowz/fflate) ZIP reader is MIT-licensed (`FFLATE-LICENSE.txt`).
