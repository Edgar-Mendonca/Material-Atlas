import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from material_atlas_core import analyse, analyse_json, performance_index


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.materials = [
            {"id": "a", "name": "A", "family": "Metals", "density": 2000, "modulus": 100,
             "yield": 400, "processes": ["Forging"], "standard": "S1", "product_form": "Bar",
             "density_min": 1800, "density_max": 2200},
            {"id": "b", "name": "B", "family": "Metals", "density": 4000, "modulus": 100,
             "yield": None, "processes": ["Casting"], "standard": "S2", "product_form": "Sheet"},
            {"id": "c", "name": "C", "family": "Polymers", "density": 1000, "modulus": None,
             "yield": 30, "processes": [], "standard": "", "product_form": ""},
        ]

    def test_conservative_range_and_missing_value(self):
        result = analyse(self.materials, {"families": ["Metals"], "limits": [
            {"key": "density", "op": "max", "value": 2100},
            {"key": "yield", "op": "min", "value": 200},
        ]})
        self.assertEqual(result["passing"], 0)  # A has a possible max of 2200
        self.assertFalse(result["outcomes"][1]["checks"][-1]["pass"])  # B missing yield
        self.assertFalse(result["outcomes"][2]["checks"][0]["pass"])

    def test_index_ranking_and_threshold(self):
        settings = {"indexPreset": "tie_stiffness", "indexLevel": 50, "indexFilter": True}
        result = analyse(self.materials, settings)
        self.assertEqual(result["ranking"][0]["id"], "a")
        self.assertEqual(result["passing"], 1)
        self.assertAlmostEqual(result["threshold"], (25e6 * 50e6) ** 0.5)
        self.assertIsNone(performance_index(self.materials[2], "tie_stiffness"))

    def test_process_and_standard_and_json_entrypoint(self):
        settings = {"process": "forging", "standard": "S1", "productForm": "Bar"}
        result = json.loads(analyse_json(json.dumps({"materials": self.materials, "settings": settings})))
        self.assertEqual([row["id"] for row in result["outcomes"] if row["pass"]], ["a"])

    def test_invalid_limits_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid property"):
            analyse(self.materials, {"limits": [{"key": "__class__", "op": "min", "value": 0}]})


if __name__ == "__main__":
    unittest.main()
