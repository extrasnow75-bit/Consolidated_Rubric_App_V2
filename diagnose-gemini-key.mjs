/**
 * diagnose-gemini-key.mjs
 *
 * Deep diagnostic for a Google Gemini API key.
 * Uses plain fetch (Node 18+) — no package install required.
 *
 * Usage:
 *   node diagnose-gemini-key.mjs YOUR_API_KEY_HERE
 *   - or -
 *   set GEMINI_API_KEY=YOUR_KEY && node diagnose-gemini-key.mjs
 */

const API_KEY = process.argv[2] || process.env.GEMINI_API_KEY;
const BASE    = 'https://generativelanguage.googleapis.com/v1beta';

// ─── Models to run canary tests on ──────────────────────────────────
const CANARY_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-1.0-pro',
];

// ─── Terminal colours (ANSI) ─────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
  white:  '\x1b[97m',
};

function pad(str, len) {
  return String(str).padEnd(len);
}

function statusColour(status) {
  if (status === 'READY')            return C.green  + status + C.reset;
  if (status === 'THROTTLED')        return C.yellow + status + C.reset;
  if (status === 'DISABLED (limit:0)')return C.red   + status + C.reset;
  if (status === 'NOT FOUND')        return C.grey   + status + C.reset;
  if (status === 'AUTH ERROR')       return C.red    + status + C.reset;
  return C.grey + status + C.reset;
}

// ─── Step 1: List all models available to this key ──────────────────
async function listModels() {
  console.log(`\n${C.bold}${C.cyan}▶ Step 1 — Listing models available to this key…${C.reset}`);

  const res  = await fetch(`${BASE}/models?key=${API_KEY}`);
  const body = await res.json();

  if (!res.ok) {
    console.error(`${C.red}✗ Failed to list models — HTTP ${res.status}${C.reset}`);
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const models = (body.models || []).map(m => m.name.replace('models/', ''));
  console.log(`${C.green}✓ ${models.length} models returned by the API${C.reset}`);

  // Show which canary models are present vs absent
  for (const m of CANARY_MODELS) {
    const found = models.includes(m) || models.some(n => n.startsWith(m));
    console.log(`  ${found ? C.green + '✓' : C.grey + '✗'}  ${m}${C.reset}`);
  }

  return models;
}

// ─── Step 2: Send a tiny canary request to one model ────────────────
async function canaryRequest(model) {
  const url  = `${BASE}/models/${model}:generateContent?key=${API_KEY}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: 'Hi' }] }],
    generationConfig: { maxOutputTokens: 1 },
  });

  let httpStatus, json;
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    httpStatus = res.status;
    json       = await res.json();
  } catch (err) {
    return { model, httpStatus: 'NETWORK', status: 'NETWORK ERROR', detail: err.message };
  }

  // ── Classify the result ──────────────────────────────────────────
  if (httpStatus === 200) {
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '(empty)';
    return { model, httpStatus, status: 'READY', detail: `replied: "${text.trim()}"` };
  }

  const errMsg   = json?.error?.message ?? '';
  const hasLimit0 = errMsg.includes('limit: 0');

  if (httpStatus === 429) {
    if (hasLimit0) {
      // Extract the retry delay if present
      const retry  = json?.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
      const delay  = retry?.retryDelay ?? 'unknown';
      return {
        model, httpStatus,
        status: 'DISABLED (limit:0)',
        detail: `Hard daily cap. Retry in ${delay}. Needs new project or billing.`,
      };
    }
    return {
      model, httpStatus,
      status: 'THROTTLED',
      detail: 'Temporary rate-limit (quota > 0). Retry with back-off.',
    };
  }

  if (httpStatus === 404) {
    return { model, httpStatus, status: 'NOT FOUND', detail: 'Model not available on v1beta for this key.' };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return { model, httpStatus, status: 'AUTH ERROR', detail: errMsg.slice(0, 80) };
  }

  return { model, httpStatus, status: `HTTP ${httpStatus}`, detail: errMsg.slice(0, 80) };
}

// ─── Step 3: Run all canary tests ───────────────────────────────────
async function runCanaryTests() {
  console.log(`\n${C.bold}${C.cyan}▶ Step 2 — Canary requests (1-token prompt per model)…${C.reset}`);
  console.log(`${C.grey}   (each request may take a few seconds)${C.reset}\n`);

  const results = [];
  for (const model of CANARY_MODELS) {
    process.stdout.write(`  Testing ${C.white}${pad(model, 28)}${C.reset} … `);
    const r = await canaryRequest(model);
    results.push(r);
    console.log(`HTTP ${C.bold}${r.httpStatus}${C.reset}  →  ${statusColour(r.status)}`);
    // Small gap between requests to avoid self-induced 429
    await new Promise(res => setTimeout(res, 1200));
  }
  return results;
}

// ─── Step 4: Summary table ───────────────────────────────────────────
function printSummary(results) {
  const divider = '─'.repeat(78);
  console.log(`\n${C.bold}${C.cyan}▶ Step 3 — Summary${C.reset}`);
  console.log(divider);
  console.log(
    C.bold +
    pad('Model',          28) +
    pad('HTTP', 6)            +
    pad('Status',         22) +
    'Detail' +
    C.reset
  );
  console.log(divider);

  for (const r of results) {
    console.log(
      pad(r.model, 28) +
      pad(r.httpStatus, 6) +
      pad(r.status, 22) +
      C.grey + r.detail + C.reset
    );
  }

  console.log(divider);

  // Recommendations
  const ready     = results.filter(r => r.status === 'READY');
  const throttled = results.filter(r => r.status === 'THROTTLED');
  const disabled  = results.filter(r => r.status === 'DISABLED (limit:0)');

  console.log(`\n${C.bold}Recommendations:${C.reset}`);

  if (ready.length > 0) {
    console.log(`${C.green}✓ Working models: ${ready.map(r => r.model).join(', ')}${C.reset}`);
    console.log(`  → These can be used in your app right now.`);
  }
  if (throttled.length > 0) {
    console.log(`${C.yellow}⚠ Throttled models: ${throttled.map(r => r.model).join(', ')}${C.reset}`);
    console.log(`  → Wait 60 s then retry, or add exponential back-off in code.`);
  }
  if (disabled.length > 0) {
    console.log(`${C.red}✗ Hard-blocked models (limit:0): ${disabled.map(r => r.model).join(', ')}${C.reset}`);
    console.log(`  → These need a fresh Google Cloud project or a billing account.`);
    console.log(`  → Go to aistudio.google.com → Create API Key → "+ Create project".`);
  }
  if (ready.length === 0 && throttled.length === 0) {
    console.log(`${C.red}✗ No models are usable with this key/project right now.${C.reset}`);
    console.log(`  → Create a brand-new key in a new project at aistudio.google.com.`);
  }

  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}═══════════════════════════════════════════`);
  console.log(`  Gemini API Key Diagnostic`);
  console.log(`═══════════════════════════════════════════${C.reset}`);

  if (!API_KEY) {
    console.error(`\n${C.red}✗ No API key supplied.${C.reset}`);
    console.error(`  Usage:  node diagnose-gemini-key.mjs YOUR_KEY`);
    console.error(`  Or set: GEMINI_API_KEY=YOUR_KEY\n`);
    process.exit(1);
  }

  const masked = API_KEY.slice(0, 8) + '...' + API_KEY.slice(-4);
  console.log(`\n  Key: ${C.cyan}${masked}${C.reset}`);

  try {
    await listModels();
    const results = await runCanaryTests();
    printSummary(results);
  } catch (err) {
    console.error(`\n${C.red}Unexpected error: ${err.message}${C.reset}`);
    process.exit(1);
  }
}

main();
