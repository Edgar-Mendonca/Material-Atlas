// Ashby-style indices for explicitly stated shapes and constraints.
// E is in Pa, yield strength in Pa, and density in kg/m³.
export const PRESETS={
  tie_stiffness:{name:'Tension member · minimum mass for stiffness',property:'modulus',power:1,
    formula:'E / ρ',assumption:'Uniform member, fixed length and axial stiffness; maximize index to reduce mass.'},
  tie_strength:{name:'Tension member · minimum mass for strength',property:'yield',power:1,
    formula:'σᵧ / ρ',assumption:'Uniform member, fixed length and tensile yield load; maximize index to reduce mass.'},
  beam_stiffness:{name:'Beam · minimum mass for bending stiffness',property:'modulus',power:0.5,
    formula:'√E / ρ',assumption:'Same beam length and section shape; freely scalable cross section and bending stiffness constraint.'},
  beam_strength:{name:'Beam · minimum mass for bending strength',property:'yield',power:2/3,
    formula:'σᵧ^(2/3) / ρ',assumption:'Same beam length and section shape; freely scalable cross section and yield constraint.'},
  plate_stiffness:{name:'Plate · minimum mass for bending stiffness',property:'modulus',power:1/3,
    formula:'E^(1/3) / ρ',assumption:'Flat plate of fixed area, variable thickness, bending stiffness constraint.'}
};
export function indexValue(material,preset) {
  if(!preset || !(material.density>0) || !(material[preset.property]>0))return null;
  const pa=material[preset.property]*(preset.property==='modulus'?1e9:1e6);
  return Math.pow(pa,preset.power)/material.density;
}
export function indexLineY(density,index,preset) {
  return Math.pow(index*density,1/preset.power)/(preset.property==='modulus'?1e9:1e6);
}
export function derived(material) {
  const density=material.density;
  return {
    specificModulus:density>0 && material.modulus>0 ? material.modulus*1e9/density:null,
    specificYield:density>0 && material.yield>0 ? material.yield*1e6/density:null,
    costPerVolume:density>0 && Number.isFinite(material.cost)?density*material.cost:null,
    carbonPerVolume:density>0 && Number.isFinite(material.carbon)?density*material.carbon:null
  };
}
