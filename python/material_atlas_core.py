"""Portable selection engine for CPython and Pyodide.

Inputs and outputs are JSON-compatible. Property units match the Material Atlas
CSV template; example records are illustrative and are not design allowables.
"""

from __future__ import annotations

import json
import math
from typing import Any


PROPERTIES = {
    "density": ("Density", "kg/m³"),
    "modulus": ("Young's modulus", "GPa"),
    "yield": ("Yield strength", "MPa"),
    "tensile": ("Tensile strength", "MPa"),
    "temp": ("Typical service limit", "°C"),
    "thermal": ("Thermal conductivity", "W/m·K"),
    "cost": ("Indicative material cost", "USD/kg"),
    "carbon": ("Indicative embodied carbon", "kg CO₂e/kg"),
    "elongation_pct": ("Elongation at break", "%"),
    "hardness_hb": ("Brinell hardness", "HB"),
    "fatigue_strength_mpa": ("Fatigue strength", "MPa"),
    "fracture_toughness_mpa_sqrt_m": ("Fracture toughness", "MPa√m"),
    "cte_per_k": ("Thermal expansion coefficient", "1/K"),
    "heat_capacity_j_kg_k": ("Specific heat capacity", "J/(kg·K)"),
    "electrical_resistivity_ohm_m": ("Electrical resistivity", "Ω·m"),
    "recyclability_pct": ("Recycled content potential", "%"),
}

PRESETS = {
    "tie_stiffness": ("modulus", 1.0, "E / ρ"),
    "tie_strength": ("yield", 1.0, "σᵧ / ρ"),
    "beam_stiffness": ("modulus", 0.5, "√E / ρ"),
    "beam_strength": ("yield", 2.0 / 3.0, "σᵧ^(2/3) / ρ"),
    "plate_stiffness": ("modulus", 1.0 / 3.0, "E^(1/3) / ρ"),
}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def performance_index(material: dict, preset_name: str) -> float | None:
    preset = PRESETS.get(preset_name)
    if preset is None:
        return None
    property_name, power, _ = preset
    density = _number(material.get("density"))
    value = _number(material.get(property_name))
    if density is None or density <= 0 or value is None or value <= 0:
        return None
    pascals = value * (1e9 if property_name == "modulus" else 1e6)
    return pascals**power / density


def _threshold(materials: list[dict], settings: dict) -> float | None:
    preset = settings.get("indexPreset")
    if preset not in PRESETS:
        return None
    values = [performance_index(m, preset) for m in materials]
    valid = [v for v in values if v is not None and v > 0]
    if not valid:
        return 0.0
    level = _number(settings.get("indexLevel"))
    fraction = max(0.0, min(100.0, 50.0 if level is None else level)) / 100.0
    low, high = min(valid), max(valid)
    return low * (high / low) ** fraction


def stage_checks(material: dict, settings: dict, threshold: float | None) -> list[dict]:
    checks = []

    def add(label: str, passed: bool, detail: str) -> None:
        checks.append({"label": label, "pass": passed, "detail": detail})

    families = settings.get("families") or []
    if families:
        add("Family", material.get("family") in families, str(material.get("family") or ""))
    process = settings.get("process") or ""
    if process:
        processes = material.get("processes") or []
        add("Process", any(p.lower() == process.lower() for p in processes), ", ".join(processes) or "Missing")
    for key, field, label in (("standard", "standard", "Standard"), ("productForm", "product_form", "Product form")):
        expected = settings.get(key)
        if expected:
            add(label, material.get(field) == expected, str(material.get(field) or "Missing"))

    for limit in settings.get("limits") or []:
        key, op = limit.get("key"), limit.get("op")
        if key not in PROPERTIES or op not in ("min", "max"):
            raise ValueError("Invalid property limit")
        bound = _number(limit.get("value"))
        # The older UI stores numeric input as a string. An empty limit fails.
        if isinstance(limit.get("value"), str):
            try:
                bound = float(limit["value"]) if limit["value"].strip() else None
            except ValueError:
                bound = None
            if bound is not None and not math.isfinite(bound):
                bound = None
        value = _number(material.get(f"{key}_{op}"))
        if value is None:
            value = _number(material.get(key))
        passed = bound is not None and value is not None and (value >= bound if op == "min" else value <= bound)
        name, unit = PROPERTIES[key]
        add(f"{name} {'≥' if op == 'min' else '≤'} {limit.get('value')} {unit}", passed,
            f"{value:g} {unit}" if value is not None else "Missing")

    preset = settings.get("indexPreset")
    if settings.get("indexFilter") and preset in PRESETS:
        value = performance_index(material, preset)
        add(f"Index {PRESETS[preset][2]}", value is not None and value >= threshold,
            f"{value:.4g}" if value is not None else "Missing input")
    return checks


def analyse(materials: list[dict], settings: dict) -> dict:
    if not isinstance(materials, list) or not isinstance(settings, dict):
        raise ValueError("Expected material records and selection settings")
    if len(materials) > 5000:
        raise ValueError("Too many records for browser analysis")
    threshold = _threshold(materials, settings)
    preset = settings.get("indexPreset") if settings.get("indexPreset") in PRESETS else "tie_stiffness"
    outcomes = []
    for material in materials:
        checks = stage_checks(material, settings, threshold)
        outcomes.append({"id": str(material.get("id", "")), "name": str(material.get("name", "")),
                         "family": str(material.get("family", "")), "pass": all(c["pass"] for c in checks),
                         "checks": checks, "index": performance_index(material, preset)})
    passing = [row for row in outcomes if row["pass"]]
    ranked = sorted((row for row in passing if row["index"] is not None),
                    key=lambda row: (-row["index"], row["name"], row["id"]))
    return {"total": len(outcomes), "passing": len(passing), "outcomes": outcomes,
            "preset": preset, "formula": PRESETS[preset][2], "threshold": threshold,
            "ranking": [{"id": row["id"], "name": row["name"], "family": row["family"],
                         "index": row["index"]} for row in ranked]}


def analyse_json(payload: str) -> str:
    data = json.loads(payload)
    return json.dumps(analyse(data["materials"], data["settings"]), allow_nan=False)
