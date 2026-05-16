// Tower compliance facade — re-exports from lightingRules so engine
// callers can import via the canonical engine/tower path.
export {
  requiredTowerCompliance,
  compareToAsr,
  MARKING_STYLES,
  LIGHTING_STYLES,
  TOWER_COMPLIANCE_PROVENANCE
} from './lightingRules.js';
