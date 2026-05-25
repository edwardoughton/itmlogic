// Appendix B — frequency-unit selection for AM vs FM exhibits.
//
// Bug fixed: appendices.js was reading nearby-primary `frequency` (kHz
// for AM rows) and printing it under a "Freq (MHz)" header, producing
// garbage like "1240.0 MHz" on AM exhibits.  These tests pin the
// AM-aware column header + value.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAppendixSections } from '../exports/engineeringReport/sections/appendices.js';

function findAppendixB(exhibit){
  const sections = buildAppendixSections(exhibit);
  return sections.find(s => s.id === 'appendix-b');
}

const COMMON_ISR_STATION = {
  call: 'KOTHER', facility_id: '54321', fcc_class: 'C',
  distance_km: 120, relationship: 'cochannel',
  section_73_207: { pass: true }, pair_pass: true
};

test('AM exhibit: Appendix B column is "Freq (kHz)" with integer kHz', () => {
  const exhibit = {
    station_inputs: { call: 'KAM', service: 'AM' },
    interference_study: {
      stations: [{ ...COMMON_ISR_STATION, frequency_khz: 1240 }],
      n_stations: 1, n_pass: 1, n_fail: 0
    }
  };
  const ab = findAppendixB(exhibit);
  assert.ok(ab, 'appendix-b should be present');
  const freqCol = ab.table.columns.find(c => c.key === 'frequency');
  assert.equal(freqCol.label, 'Freq (kHz)', 'AM exhibit must label column as kHz');
  assert.equal(ab.table.rows[0].frequency, '1240',
    'AM frequency must render as integer kHz, not "1240.0"');
});

test('FM exhibit: Appendix B column is "Freq (MHz)" with 1-decimal MHz', () => {
  const exhibit = {
    station_inputs: { call: 'WFM', service: 'FM' },
    interference_study: {
      stations: [{ ...COMMON_ISR_STATION, frequency_mhz: 98.7 }],
      n_stations: 1, n_pass: 1, n_fail: 0
    }
  };
  const ab = findAppendixB(exhibit);
  const freqCol = ab.table.columns.find(c => c.key === 'frequency');
  assert.equal(freqCol.label, 'Freq (MHz)');
  assert.equal(ab.table.rows[0].frequency, '98.7');
});

test('AM exhibit: falls back to evidence.nearby_primaries.frequency_khz when station row lacks it', () => {
  const exhibit = {
    station_inputs: { call: 'KAM', service: 'AM' },
    evidence: {
      nearby_primaries: [
        { call: 'KOTHER', facility_id: '54321', frequency_khz: 1050, frequency_unit: 'kHz' }
      ]
    },
    interference_study: {
      stations: [{ ...COMMON_ISR_STATION }],   // no frequency_khz on the station row itself
      n_stations: 1, n_pass: 1, n_fail: 0
    }
  };
  const ab = findAppendixB(exhibit);
  assert.equal(ab.table.rows[0].frequency, '1050');
});
