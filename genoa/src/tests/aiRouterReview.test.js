// AI router client + advisory exhibit-review tests.  All network is
// mocked — no live router/KB calls in CI.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as aiRouter from '../services/aiRouter.js';
import { reviewExhibit, snapshot } from '../analysis/exhibitReview.js';

function withEnv(vars, fn){
  const saved = {};
  for (const k of Object.keys(vars)){ saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(saved)){ if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}
function withFetch(fake, fn){
  const orig = global.fetch; global.fetch = fake;
  return Promise.resolve(fn()).finally(() => { global.fetch = orig; });
}
const okJson = (obj) => ({ ok: true, json: async () => obj, text: async () => JSON.stringify(obj) });

/* ---------- aiRouter ---------- */

test('aiRouter.isEnabled reflects MODEL_ACCESS_KEY', async () => {
  await withEnv({ MODEL_ACCESS_KEY: null }, () => assert.equal(aiRouter.isEnabled(), false));
  await withEnv({ MODEL_ACCESS_KEY: 'doo_v1_x' }, () => assert.equal(aiRouter.isEnabled(), true));
});

test('aiRouter.complete returns available:false with no key (no network)', async () => {
  await withEnv({ MODEL_ACCESS_KEY: null }, async () => {
    let called = false;
    await withFetch(async () => { called = true; return okJson({}); }, async () => {
      const r = await aiRouter.complete({ user: 'hi' });
      assert.equal(r.available, false);
      assert.match(r.reason, /MODEL_ACCESS_KEY/);
    });
    assert.equal(called, false, 'must not hit the network without a key');
  });
});

test('aiRouter.complete parses choices[0].message.content + posts router:zerotrust', async () => {
  await withEnv({ MODEL_ACCESS_KEY: 'doo_v1_x', INFERENCE_ROUTER_URL: 'https://x/v1' }, async () => {
    let seenBody = null, seenAuth = null;
    const fake = async (url, opts) => {
      seenBody = JSON.parse(opts.body); seenAuth = opts.headers.Authorization;
      return okJson({ model: 'anthropic-claude-4.6-sonnet', choices: [{ message: { content: 'ANSWER' } }] });
    };
    await withFetch(fake, async () => {
      const r = await aiRouter.complete({ system: 'sys', user: 'q', maxTokens: 50 });
      assert.equal(r.available, true);
      assert.equal(r.content, 'ANSWER');
      assert.equal(r.model, 'anthropic-claude-4.6-sonnet');
    });
    assert.equal(seenBody.model, 'router:zerotrust');
    assert.equal(seenBody.messages[0].role, 'system');
    assert.equal(seenBody.messages[1].content, 'q');
    assert.equal(seenAuth, 'Bearer doo_v1_x');
  });
});

test('aiRouter.complete surfaces non-200 as available:false (no throw)', async () => {
  await withEnv({ MODEL_ACCESS_KEY: 'doo_v1_x' }, async () => {
    await withFetch(async () => ({ ok: false, status: 403, text: async () => 'Forbidden' }), async () => {
      const r = await aiRouter.complete({ user: 'q' });
      assert.equal(r.available, false);
      assert.match(r.reason, /HTTP 403/);
    });
  });
});

/* ---------- exhibitReview ---------- */

test('snapshot surfaces the consistency-relevant fields', () => {
  const snap = snapshot({
    station_inputs: { service: 'FM', call: 'KZLZ' },
    validation_verdict: { categories: { filing: { status: 'READY' } }, components: [{ name: 'Interference rules', status: 'FAIL' }] },
    engineering_conclusion: { conclusion: 'NON-COMPLIANT' },
    haat_validation: { status: 'FALLBACK_ONLY', basis: 'flat', stats: { min_m: 581, max_m: 581, mean_m: 581, operator_m: 581 } },
    radial_table: [{ contour_distances_km: { s60: 37.1 } }, { contour_distances_km: { s60: 41.9 } }]
  });
  assert.match(snap, /filing_readiness=READY/);
  assert.match(snap, /Interference rules = FAIL/);
  assert.match(snap, /engineering_conclusion=NON-COMPLIANT/);
  assert.match(snap, /haat_status=FALLBACK_ONLY/);
  assert.match(snap, /contour_distance_spread_km=\[37\.10, 41\.90\]/);
});

test('reviewExhibit is a no-op (null) without MODEL_ACCESS_KEY', async () => {
  await withEnv({ MODEL_ACCESS_KEY: null }, async () => {
    const r = await reviewExhibit({ station_inputs: { service: 'FM' } });
    assert.equal(r, null);
  });
});

test('reviewExhibit parses JSON findings from the router response', async () => {
  await withEnv({ MODEL_ACCESS_KEY: 'doo_v1_x', FCC_KB_URL: null, FCC_KB_TOKEN: null }, async () => {
    const fake = async () => okJson({
      model: 'anthropic-claude-4.6-sonnet',
      choices: [{ message: { content: 'Here:\n[{"issue":"READY but NON-COMPLIANT","severity":"WARNING"}]' } }]
    });
    await withFetch(fake, async () => {
      const r = await reviewExhibit({
        station_inputs: { service: 'FM', call: 'KZLZ' },
        validation_verdict: { categories: { filing: { status: 'READY' } } },
        engineering_conclusion: { conclusion: 'NON-COMPLIANT' }
      });
      assert.equal(r.available, true);
      assert.equal(r.grounded, false);              // no KB token → ungrounded
      assert.equal(r.findings.length, 1);
      assert.match(r.findings[0].issue, /READY but NON-COMPLIANT/);
      assert.equal(r.findings[0].severity, 'WARNING');
    });
  });
});

test('reviewExhibit tolerates non-JSON router output (findings empty, raw preserved)', async () => {
  await withEnv({ MODEL_ACCESS_KEY: 'doo_v1_x', FCC_KB_URL: null }, async () => {
    await withFetch(async () => okJson({ choices: [{ message: { content: 'CONSISTENT' } }] }), async () => {
      const r = await reviewExhibit({ station_inputs: { service: 'FM' } });
      assert.equal(r.available, true);
      assert.deepEqual(r.findings, []);
      assert.equal(r.raw, 'CONSISTENT');
    });
  });
});

/* ---------- fccKb backend selection + OpenSearch helpers ---------- */

import * as fccKb from '../services/fccKb.js';

test('fccKb.pickKbIndex: prefers KB-id fragment, skips system indices, falls back', () => {
  assert.equal(fccKb.pickKbIndex(['.kibana', 'kb_f53b381b_chunks', 'x'], 'f53b381b'), 'kb_f53b381b_chunks');
  assert.equal(fccKb.pickKbIndex(['.sys', 'my_knowledge_idx'], null), 'my_knowledge_idx');
  assert.equal(fccKb.pickKbIndex(['.only-system'], 'zzz'), null);
  assert.equal(fccKb.pickKbIndex([], 'x'), null);
});

test('fccKb.hitsToChunks: tolerates content/text/page_content field variation', () => {
  const out = fccKb.hitsToChunks({ hits: { hits: [
    { _score: 2, _source: { content: 'A' } },
    { _score: 1, _source: { page_content: 'B' } },
    { _source: { irrelevant: 1 } }
  ] } }, 'idx');
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(c => c.text), ['A', 'B']);
  assert.equal(out[0].source, 'idx');
});

test('fccKb.retrieve: no backend configured → available:false (no network)', async () => {
  await withEnv({ FCC_KB_URL: null, FCC_KB_TOKEN: null, FCC_KB_OS_HOST: null, FCC_KB_OS_PASS: null }, async () => {
    const r = await fccKb.retrieve('skywave');
    assert.equal(r.available, false);
    assert.match(r.reason, /no KB backend configured/);
  });
});

test('fccKb.retrieve (kbaas): posts {query,num_results,alpha} with PAT bearer, parses results', async () => {
  await withEnv({ FCC_KB_URL: 'https://kb/v1/knowledge_bases/f53b381b/retrieve', FCC_KB_TOKEN: 'dop_v1_pat',
                  FCC_KB_OS_HOST: null, FCC_KB_OS_PASS: null }, async () => {
    let seenBody = null, seenAuth = null;
    const fake = async (url, opts) => {
      seenBody = JSON.parse(opts.body); seenAuth = opts.headers.Authorization;
      return okJson({ results: [{ text: '§73.190 skywave Formula 1', score: 0.9 }] });
    };
    await withFetch(fake, async () => {
      const r = await fccKb.retrieve('skywave Fc(50)', { k: 5 });
      assert.equal(r.available, true);
      assert.equal(r.chunks.length, 1);
      assert.match(r.chunks[0].text, /73\.190/);
    });
    assert.equal(seenBody.query, 'skywave Fc(50)');
    assert.equal(seenBody.num_results, 5);
    assert.equal(seenBody.alpha, 0.75);
    assert.equal('k' in seenBody, false, 'must not send the legacy k field');
    assert.equal(seenAuth, 'Bearer dop_v1_pat');
  });
});

test('fccKb.isEnabled: true when either kbaas token OR OpenSearch creds set', async () => {
  await withEnv({ FCC_KB_URL: null, FCC_KB_TOKEN: null, FCC_KB_OS_HOST: null, FCC_KB_OS_PASS: null },
    () => assert.equal(fccKb.isEnabled(), false));
  await withEnv({ FCC_KB_URL: 'https://k/retrieve', FCC_KB_TOKEN: 't', FCC_KB_OS_HOST: null, FCC_KB_OS_PASS: null },
    () => assert.equal(fccKb.isEnabled(), true));
  await withEnv({ FCC_KB_URL: null, FCC_KB_TOKEN: null, FCC_KB_OS_HOST: 'h', FCC_KB_OS_PASS: 'p' },
    () => assert.equal(fccKb.isEnabled(), true));
});
