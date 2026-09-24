#!/usr/bin/env node
/**
 * watch-corp-action.mjs — live watch for the first real corporate action on 4663.
 *
 * Robinhood's corporate-actions list shows NVDA in progress for 1 Oct. That is
 * the first chance to observe ShareExactGuard's scheduled path against a real
 * event instead of a mock, and it happens before the 12 Oct deadline.
 *
 * Both outcomes are worth capturing, and this script is written so neither can
 * be missed or quietly reinterpreted afterwards:
 *
 *   - state() goes CORP_ACTION before the multiplier moves  → the scheduled
 *     path fired on a real event. That is the proof the thesis has lacked.
 *   - the multiplier moves with no prior effectiveAt        → the dividend was
 *     applied instantly, which is the class the guard already documents it
 *     cannot see. Also a finding, and the honest one to publish.
 *
 * It additionally watches for the condition the argument rests on: a new feed
 * round while a unit change is pending and oraclePaused() is false. A new
 * round is the condition, not proof the price is wrong.
 *
 * Every poll is appended to a JSONL log, so the record survives restarts and
 * can be cited later. Only transitions are printed.
 *
 * No dependencies. Node >= 18. Run from the repo root.
 *
 *   node scripts/watch-corp-action.mjs                       # all 8 registered tokens
 *   node scripts/watch-corp-action.mjs --only NVDA           # just the one in progress
 *   node scripts/watch-corp-action.mjs --interval 120        # seconds, default 300
 *   node scripts/watch-corp-action.mjs --once                # single poll, for cron
 */

import { appendFileSync, readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

const RPC = arg("rpc", process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com");
const GUARD = arg("guard", "0x290558b05dec593af7b2ef6dbc26b9ffc38adb37");
const RECORD = arg("record", "deployments/chain-4663.json");
const ONLY = arg("only", "");
const INTERVAL = Number(arg("interval", "300")) * 1000;
const LOG = arg("log", "corp-action-watch.jsonl");
const ONCE = has("once");

// ---------------------------------------------------------------- abi

const SEL = {
  state: "0x31e658a5", // state(address)
  multiplierOf: "0x8e4a5248", // multiplierOf(address)
  corpActionWindow: "0x6eb3412c", // corpActionWindow()
  uiMultiplier: "0xa60bf13d",
  newUIMultiplier: "0xdc767007",
  effectiveAt: "0x97a4064f",
  oraclePaused: "0x7706ba52",
  latestRoundData: "0xfeaf968c",
};

const STATE_NAME = [
  "FRESH",
  "STALE",
  "ORACLE_PAUSED",
  "CORP_ACTION",
  "SEQUENCER_DOWN",
  "NO_FEED",
];

const addrArg = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const hexToBig = (h) => (h && h !== "0x" ? BigInt(h) : 0n);
const word = (hex, i) => "0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64);

// ---------------------------------------------------------------- rpc

let calls = 0;
async function rpc(method, params) {
  calls++;
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: calls, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

async function call(to, data) {
  try {
    const out = await rpc("eth_call", [{ to, data }, "latest"]);
    return out && out !== "0x" ? out : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- inputs

function loadTokens() {
  let raw;
  try {
    raw = JSON.parse(readFileSync(RECORD, "utf8"));
  } catch {
    console.error(`Could not read ${RECORD}. Run from the repo root.`);
    process.exit(1);
  }
  let rows = Object.entries(raw?.feeds?.registered ?? {}).map(([symbol, v]) => ({
    symbol,
    token: v.token,
    feed: v.feed ?? null,
  }));
  if (ONLY) {
    const want = ONLY.split(",").map((s) => s.trim().toUpperCase());
    rows = rows.filter((r) => want.includes(r.symbol.toUpperCase()));
  }
  if (rows.length === 0) {
    console.error("No tokens selected.");
    process.exit(1);
  }
  return rows;
}

// ---------------------------------------------------------------- one observation

async function observe(row, blockNumber, blockTs) {
  const o = {
    ts: new Date().toISOString(),
    block: blockNumber,
    blockTime: blockTs,
    symbol: row.symbol,
    token: row.token,
  };

  const st = await call(GUARD, SEL.state + addrArg(row.token));
  o.state = st === null ? null : STATE_NAME[Number(hexToBig(st))] ?? `UNKNOWN(${hexToBig(st)})`;

  const mo = await call(GUARD, SEL.multiplierOf + addrArg(row.token));
  if (mo && mo.length >= 2 + 3 * 64) {
    o.current = hexToBig(word(mo, 0)).toString();
    o.pending = hexToBig(word(mo, 1)).toString();
    o.effectiveAt = Number(hexToBig(word(mo, 2)));
  }

  // Read the token directly too: multiplierOf() collapses an unreadable
  // newUIMultiplier() into `pending == current`, which would hide exactly the
  // transition this script exists to catch.
  const rawNew = await call(row.token, SEL.newUIMultiplier);
  o.tokenNewUIMultiplier = rawNew === null ? null : hexToBig(rawNew).toString();
  const rawEff = await call(row.token, SEL.effectiveAt);
  o.tokenEffectiveAt = rawEff === null ? null : Number(hexToBig(rawEff));
  const paused = await call(row.token, SEL.oraclePaused);
  o.oraclePaused = paused === null ? null : hexToBig(paused) === 1n;

  if (row.feed) {
    const lrd = await call(row.feed, SEL.latestRoundData);
    if (lrd && lrd.length >= 2 + 5 * 64) {
      o.feedAnswer = BigInt.asIntN(256, hexToBig(word(lrd, 1))).toString();
      o.feedUpdatedAt = Number(hexToBig(word(lrd, 3)));
      o.feedRoundId = hexToBig(word(lrd, 0)).toString();
    }
  }

  return o;
}

// ---------------------------------------------------------------- transitions

const WATCHED = [
  "state",
  "current",
  "pending",
  "effectiveAt",
  "oraclePaused",
  "tokenEffectiveAt",
  "tokenNewUIMultiplier",
];

function diff(prev, next) {
  if (!prev) return [];
  const out = [];
  for (const k of WATCHED) {
    if (prev[k] !== next[k] && !(prev[k] == null && next[k] == null)) {
      out.push({ field: k, from: prev[k], to: next[k] });
    }
  }
  return out;
}

const fmt18 = (v) => {
  if (v == null) return "—";
  const s = String(v).padStart(19, "0");
  return `${s.slice(0, s.length - 18)}.${s.slice(s.length - 18).replace(/0+$/, "") || "0"}`;
};

function headline(o, changes) {
  const lines = [];

  if (changes.some((c) => c.field === "state")) {
    const c = changes.find((x) => x.field === "state");
    lines.push(`state ${c.from} → ${c.to}`);
    if (c.to === "CORP_ACTION") {
      lines.push("  ** THE SCHEDULED PATH FIRED ON A REAL EVENT. Keep this log. **");
    }
  }

  const mult = changes.find((c) => c.field === "current");
  if (mult) {
    lines.push(`uiMultiplier ${fmt18(mult.from)} → ${fmt18(mult.to)}`);
    lines.push("  ** THE UNIT MOVED. Check above whether CORP_ACTION preceded it. **");
  }

  const eff = changes.find((c) => c.field === "tokenEffectiveAt");
  if (eff && Number(eff.to) > 0) {
    lines.push(`effectiveAt scheduled: ${eff.to} (${new Date(Number(eff.to) * 1000).toISOString()})`);
  }

  const paused = changes.find((c) => c.field === "oraclePaused");
  if (paused) lines.push(`oraclePaused ${paused.from} → ${paused.to}`);

  return lines;
}

/** The exact event the argument rests on: a fresh round while a change is pending and unpaused. */
function missedPause(prev, o) {
  const pendingChange =
    o.tokenEffectiveAt > 0 &&
    o.blockTime &&
    o.tokenEffectiveAt > o.blockTime &&
    o.tokenNewUIMultiplier != null &&
    o.current != null &&
    o.tokenNewUIMultiplier !== o.current;
  if (!pendingChange) return null;
  if (o.oraclePaused !== false) return null;
  if (!prev || prev.feedRoundId == null || o.feedRoundId == null) return null;
  if (prev.feedRoundId === o.feedRoundId) return null;
  return {
    roundFrom: prev.feedRoundId,
    roundTo: o.feedRoundId,
    feedUpdatedAt: o.feedUpdatedAt,
    effectiveAt: o.tokenEffectiveAt,
  };
}

// ---------------------------------------------------------------- loop

function loadLast(rows) {
  const last = {};
  if (!existsSync(LOG)) return last;
  try {
    for (const line of readFileSync(LOG, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      if (o.symbol) last[o.symbol] = o;
    }
    const n = Object.keys(last).length;
    if (n) console.log(`Resumed from ${LOG} (last observation for ${n} token(s)).`);
  } catch {
    /* a truncated final line is not worth failing over */
  }
  return last;
}

async function tick(rows, last) {
  let blockNumber = null;
  let blockTs = null;
  try {
    const b = await rpc("eth_getBlockByNumber", ["latest", false]);
    blockNumber = Number(hexToBig(b.number));
    blockTs = Number(hexToBig(b.timestamp));
  } catch (e) {
    console.error(`${new Date().toISOString()}  RPC unreachable: ${e.message}`);
    return;
  }

  for (const row of rows) {
    let o;
    try {
      o = await observe(row, blockNumber, blockTs);
    } catch (e) {
      console.error(`${row.symbol}: ${e.message}`);
      continue;
    }

    const prev = last[row.symbol];
    const changes = diff(prev, o);
    const missed = missedPause(prev, o);
    if (missed) o.missedPause = missed;

    // Log every observation; the record is the point.
    appendFileSync(LOG, JSON.stringify(o) + "\n");

    if (!prev) {
      console.log(
        `${o.ts}  ${row.symbol.padEnd(6)} baseline  state=${o.state}  mult=${fmt18(o.current)}` +
          `  effectiveAt=${o.tokenEffectiveAt || 0}  paused=${o.oraclePaused}`,
      );
    } else if (changes.length > 0) {
      console.log(`\n${o.ts}  ${row.symbol}  block ${o.block}`);
      for (const l of headline(o, changes)) console.log(`  ${l}`);
      for (const c of changes) {
        if (!["state", "current", "tokenEffectiveAt", "oraclePaused"].includes(c.field)) {
          console.log(`  ${c.field}: ${c.from} → ${c.to}`);
        }
      }
      console.log("");
    }

    if (missed) {
      console.log(`\n${o.ts}  ${row.symbol}  *** MISSED PAUSE ***`);
      console.log(`  A new feed round (${missed.roundFrom} → ${missed.roundTo}) printed while a`);
      console.log(`  unit change is pending (effectiveAt ${missed.effectiveAt}) and oraclePaused() is false.`);
      console.log(`  That is the condition, not proof the price is wrong. Keep this log.\n`);
    }

    last[row.symbol] = o;
  }
}

async function main() {
  const rows = loadTokens();
  console.log(`RPC    ${RPC}`);
  console.log(`guard  ${GUARD}`);
  console.log(`watch  ${rows.map((r) => r.symbol).join(", ")}`);
  console.log(`log    ${LOG}`);
  console.log(ONCE ? "mode   single poll\n" : `mode   every ${INTERVAL / 1000}s (Ctrl-C to stop)\n`);

  const last = loadLast(rows);
  await tick(rows, last);
  if (ONCE) return;

  for (;;) {
    await new Promise((r) => setTimeout(r, INTERVAL));
    await tick(rows, last);
  }
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
