#!/usr/bin/env node
// scripts/sigmfFromKiwiCapture.js
//
// Convert a KiwiSDR-side AM (or FM) capture session into a sigmf-meta
// JSON document that genoa's measurement-evidence pipeline ingests.
// Pipes through src/evidence/measurements/buildSigmfFromKiwiCapture.js
// and writes the result either to a file or stdout.
//
// USAGE
//   node scripts/sigmfFromKiwiCapture.js \
//     --callsign KRDM --service AM --frequency-khz 1240 \
//     --tx-lat 44.272 --tx-lon -121.174 \
//     --rx-lat 44.05  --rx-lon -121.31 \
//     --captured-at 2026-05-10T17:30:00Z \
//     --duration-seconds 60 \
//     --rssi-dbm -73.5 \
//     --antenna-gain-dbi 0 --cable-loss-db 1 --lna-gain-db 20 \
//     --kiwi-host kk6pr.ddns.net:8077 \
//     --capture-proxy-url wss://proxy.example.org/relay \
//     --ztr-capture-id 71268 --ztr-station-id 100074 \
//     --out /tmp/krdm-71268.sigmf-meta.json
//
//   # Stdout if --out is omitted; pipe straight to the measurement
//   # sidecar's POST /v1/sigmf/parse:
//   node scripts/sigmfFromKiwiCapture.js --callsign KRDM ... \
//     | curl -sS -H content-type:application/json \
//            --data-binary @- \
//            "$MEASUREMENT_SIDECAR_URL/v1/sigmf/parse" | jq .
//
//   # Or feed directly to a JSON-config file:
//   node scripts/sigmfFromKiwiCapture.js --config ./krdm-capture.json \
//     --out krdm.sigmf-meta.json
//
// EXIT
//   0 on success.  Non-zero on validation error / write error.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSigmfFromKiwiCapture } from '../src/evidence/measurements/buildSigmfFromKiwiCapture.js';

const FLAG_TO_FIELD = {
  '--callsign':                'callsign',
  '--service':                 'service',
  '--frequency-khz':           'frequency_khz',
  '--tx-lat':                  'tx_lat',
  '--tx-lon':                  'tx_lon',
  '--rx-lat':                  'rx_lat',
  '--rx-lon':                  'rx_lon',
  '--captured-at':             'captured_at',
  '--duration-seconds':        'duration_seconds',
  '--sample-rate-hz':          'sample_rate_hz',
  '--rssi-dbm':                'rssi_dbm',
  '--field-dbu':               'field_dBu_override',
  '--field-mvm':               'field_mvm_override',
  '--antenna-gain-dbi':        'antenna_gain_dbi',
  '--antenna-factor-db-per-m': 'antenna_factor_db_per_m',
  '--cable-loss-db':           'cable_loss_db',
  '--lna-gain-db':             'lna_gain_db',
  '--sensitivity-floor-dbm':   'sensitivity_floor_dbm',
  '--last-calibration-date':   'last_calibration_date',
  '--calibration-method':      'calibration_method',
  '--uncertainty-db':          'uncertainty_db',
  '--kiwi-host':               'kiwi_host',
  '--kiwi-user':               'kiwi_user',
  '--capture-proxy-url':       'capture_proxy_url',
  '--audio-filename':          'audio_filename',
  '--audio-url':               'audio_url',
  '--ztr-capture-id':          'ztr_capture_id',
  '--ztr-station-id':          'ztr_station_id',
  '--ztr-app-url':             'ztr_app_url',
  '--author':                  'author',
  '--description':             'description'
};

const NUMERIC_FIELDS = new Set([
  'frequency_khz', 'tx_lat', 'tx_lon', 'rx_lat', 'rx_lon',
  'duration_seconds', 'sample_rate_hz',
  'rssi_dbm', 'field_dBu_override', 'field_mvm_override',
  'antenna_gain_dbi', 'antenna_factor_db_per_m',
  'cable_loss_db', 'lna_gain_db', 'sensitivity_floor_dbm',
  'uncertainty_db'
]);

const BOOL_FIELDS = new Set(['traceable']);

function parseArgs(argv){
  const out = {};
  let outPath = null;
  let configPath = null;
  let pretty = true;
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a === '--out'){
      outPath = argv[++i];
    } else if (a === '--config'){
      configPath = argv[++i];
    } else if (a === '--no-pretty'){
      pretty = false;
    } else if (a === '--traceable'){
      out.traceable = true;
    } else if (a === '--help' || a === '-h'){
      process.stdout.write(helpText());
      process.exit(0);
    } else if (FLAG_TO_FIELD[a]){
      const field = FLAG_TO_FIELD[a];
      const v = argv[++i];
      if (v === undefined){
        throw new Error(`flag ${a} requires a value`);
      }
      out[field] = NUMERIC_FIELDS.has(field) ? Number(v) : v;
    } else {
      throw new Error(`unrecognised flag: ${a}\n\n${helpText()}`);
    }
  }
  return { args: out, outPath, configPath, pretty };
}

function helpText(){
  return [
    'Usage: node scripts/sigmfFromKiwiCapture.js [flags] [--config file] [--out file]',
    '',
    'Required flags (or via --config JSON):',
    '  --callsign --frequency-khz --tx-lat --tx-lon',
    '  --rx-lat --rx-lon --captured-at',
    '  At least one of: --rssi-dbm | --field-dbu | --field-mvm',
    '',
    'Common optional flags:',
    '  --service AM|FM (default AM)',
    '  --duration-seconds N    --sample-rate-hz 12000',
    '  --antenna-gain-dbi N    --cable-loss-db N    --lna-gain-db N',
    '  --antenna-factor-db-per-m N (overrides 107 dB default)',
    '  --kiwi-host host:port   --kiwi-user name',
    '  --capture-proxy-url wss://...',
    '  --audio-filename FILE   --audio-url URL  --description "..."',
    '  --ztr-capture-id N      (auto-derives audio_url to ZTR app API:',
    '                           https://<ztr-app>/api/sdr/captures/<id>/audio)',
    '  --ztr-station-id N      (cross-ref to facility_lookup_source.ztr_id; metadata only)',
    '  --ztr-app-url URL       (override ZTR app base; defaults to prod DO deploy)',
    '  --traceable             (NIST-traceable calibration flag)',
    '  --uncertainty-db N      (1-sigma calibration uncertainty)',
    '',
    'Output:',
    '  --out FILE              (default: stdout)',
    '  --no-pretty             (compact JSON)',
    ''
  ].join('\n');
}

async function main(){
  let { args, outPath, configPath, pretty } = parseArgs(process.argv.slice(2));
  if (configPath){
    const raw = await fs.readFile(configPath, 'utf8');
    args = { ...JSON.parse(raw), ...args };  // CLI flags override config
  }
  // Coerce booleans that may have come from config
  for (const k of BOOL_FIELDS){
    if (args[k] !== undefined) args[k] = args[k] === true || args[k] === 'true' || args[k] === 1;
  }

  const meta = buildSigmfFromKiwiCapture(args);
  const json = JSON.stringify(meta, null, pretty ? 2 : 0);

  if (outPath){
    await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await fs.writeFile(outPath, json + '\n', 'utf8');
    process.stderr.write(`wrote ${outPath} (${json.length} bytes, field_dBu=${meta.captures[0].field_dBu})\n`);
  } else {
    process.stdout.write(json + '\n');
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain){
  main().catch(err => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
