import test from 'node:test';
import assert from 'node:assert/strict';
import { buildValidationVerdictSection } from '../exports/engineeringReport/sections/validationVerdict.js';

const FM_EXHIBIT = {
  station_inputs: { service: 'FM', call: 'WTST' },
  evidence: {},
  validation_context: {},
  method_versions: {}
};

const AM_EXHIBIT = {
  station_inputs: { service: 'AM', call: 'WTST', fcc_class: 'B' },
  evidence: {},
  validation_context: {},
  method_versions: {}
};

function findComponent(section, namePattern){
  return section.verdict.components.find((c) => namePattern.test(c.name));
}

test('FM exhibit: no §73.182 NIF row in validation verdict', () => {
  const v = buildValidationVerdictSection(FM_EXHIBIT);
  assert.equal(findComponent(v, /73\.182/), undefined);
});

test('AM exhibit, no NIF evidence: NOT_RUN with FCCAM-not-configured message', () => {
  const v = buildValidationVerdictSection(AM_EXHIBIT);
  const c = findComponent(v, /73\.182/);
  assert.ok(c, 'AM exhibit should include §73.182 row');
  assert.equal(c.status, 'NOT_RUN');
  assert.match(c.detail, /FCCAM/);
});

test('AM exhibit, NIF evidence available + all azimuths pass → PASS', () => {
  const exhibit = {
    ...AM_EXHIBIT,
    evidence: {
      am_night_nif: {
        available: true,
        summary: {
          n_azimuths: 36,
          n_failing_azimuths: 0,
          n_no_service_azimuths: 0,
          mean_radius_km: 215.0,
          worst_margin_db: 1.5,
          n_interferers_used: 5
        }
      }
    }
  };
  const v = buildValidationVerdictSection(exhibit);
  const c = findComponent(v, /73\.182/);
  assert.equal(c.status, 'PASS');
  assert.match(c.detail, /mean NIF 215 km/);
  assert.match(c.detail, /worst margin 1\.5 dB/);
});

test('AM exhibit, NIF evidence with failing azimuths → FAIL', () => {
  const exhibit = {
    ...AM_EXHIBIT,
    evidence: {
      am_night_nif: {
        available: true,
        summary: {
          n_azimuths: 36,
          n_failing_azimuths: 8,
          n_no_service_azimuths: 0,
          mean_radius_km: 180.0,
          worst_margin_db: -4.2,
          n_interferers_used: 7
        }
      }
    }
  };
  const v = buildValidationVerdictSection(exhibit);
  const c = findComponent(v, /73\.182/);
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /-4\.2 dB/);
  assert.match(c.detail, /8 failing/);
});

test('AM exhibit, NIF returns available:false → NOT_RUN with reason', () => {
  const exhibit = {
    ...AM_EXHIBIT,
    evidence: {
      am_night_nif: {
        available: false,
        error: 'proposed.fcc_class is required (A/B/C/D)'
      }
    }
  };
  const v = buildValidationVerdictSection(exhibit);
  const c = findComponent(v, /73\.182/);
  assert.equal(c.status, 'NOT_RUN');
  assert.match(c.detail, /fcc_class/);
});

test('AM exhibit, all-failing no-service → FAIL', () => {
  const exhibit = {
    ...AM_EXHIBIT,
    evidence: {
      am_night_nif: {
        available: true,
        summary: {
          n_azimuths: 36,
          n_failing_azimuths: 0,
          n_no_service_azimuths: 36,   // pattern is too weak to serve anywhere
          mean_radius_km: 0,
          worst_margin_db: -25,
          n_interferers_used: 5
        }
      }
    }
  };
  const v = buildValidationVerdictSection(exhibit);
  const c = findComponent(v, /73\.182/);
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /36 no-service/);
});
