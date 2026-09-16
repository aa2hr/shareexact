#!/usr/bin/env node
/**
 * Prove a deployment, against the live chain, from a clean checkout.
 *
 * `forge test` proves the code is correct. This proves the *deployment* is
 * correct — that the address in `deployments/` holds the contract we think it
 * does, wired to the guard we think it is, answering the way the documentation
 * says it answers. Those are different claims, and only the second one is what a
 * reviewer opening the explorer is checking.
 *
 * Read-only. Sends no transaction, needs no key.
 *
 *   node scripts/verify-deployment.mjs
 *   node scripts/verify-deployment.mjs --chain 46630
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const RPC = {
  4663: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  46630: process.env.ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
};

/**
 * keccak256(signature)[0:4]. Generated, not typed from memory — three of these
 * were wrong on the first pass, which is exactly the failure mode a deployment
 * verifier must not have: a wrong selector returns empty data and the check
 * reports a healthy contract as broken, or worse, the reverse.
 */
const SELECTOR = {
  guard: "0x7ceab3b1", // guard()
  owner: "0x8da5cb5b", // owner()
  corpActionWindow: "0x6eb3412c", // corpActionWindow()
  sequencerFeed: "0x3b521cb6", // sequencerFeed()
  state: "0x31e658a5", // state(address)
  multiplierOf: "0x8e4a5248", // multiplierOf(address)
  feedOf: "0x4b45e8a6", // feedOf(address)
  isSupported: "0x4f129c53", // isSupported(address)
};

const STATE_NAME = [
  "FRESH",
  "STALE",
  "ORACLE_PAUSED",
  "CORP_ACTION",
  "SEQUENCER_DOWN",
  "NO_FEED",
];

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const chainId = Number(arg("--chain", "4663"));
const rpc = RPC[chainId];
const recordPath = resolve(`deployments/chain-${chainId}.json`);

if (!existsSync(recordPath)) {
  console.error(
    `\n  No deployment recorded for chain ${chainId}.\n  Deploy, then run: node scripts/record-deployment.mjs --chain ${chainId}\n`,
  );
  process.exit(1);
}

const record = JSON.parse(readFileSync(recordPath, "utf8"));
const guardAddress = record.contracts?.ShareExactGuard?.address;
const exactAddress = record.contracts?.ExactTransfer?.address;

let id = 0;
async function rpcCall(method, params) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

const call = (to, data) => rpcCall("eth_call", [{ to, data }, "latest"]);
const pad = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const word = (hex, i = 0) => BigInt(`0x${hex.slice(2).slice(i * 64, (i + 1) * 64) || "0"}`);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`\n  Verifying chain ${chainId} (${record.network}) via ${rpc}\n`);

  const netId = Number(await rpcCall("eth_chainId", []));
  check("RPC reports the expected chain id", netId === chainId, `got ${netId}`);

  for (const [label, address] of [
    ["ShareExactGuard", guardAddress],
    ["ExactTransfer", exactAddress],
  ]) {
    const code = await rpcCall("eth_getCode", [address, "latest"]);
    check(
      `${label} has bytecode at ${address}`,
      typeof code === "string" && code.length > 4,
      `${((code.length - 2) / 2) | 0} bytes`,
    );
  }

  // ExactTransfer must point at the guard we recorded. A helper wired to some
  // other guard would pass every unit test and still be the wrong deployment.
  const wiredGuard = `0x${(await call(exactAddress, SELECTOR.guard)).slice(-40)}`;
  check(
    "ExactTransfer.guard() matches the recorded guard",
    wiredGuard.toLowerCase() === guardAddress.toLowerCase(),
    wiredGuard,
  );

  const owner = `0x${(await call(guardAddress, SELECTOR.owner)).slice(-40)}`;
  check("Guard has a non-zero owner", !/^0x0{40}$/.test(owner), owner);
  if (/^0x0{40}$/.test(owner) === false && owner.toLowerCase() === record.deployer?.toLowerCase()) {
    console.log(
      "        note: owner is the deploying EOA. Fine for a demo; move to a multisig before anyone lends against this.",
    );
  }

  const window = word(await call(guardAddress, SELECTOR.corpActionWindow));
  check("Corporate-action window is configured", window > 0n, `${window}s`);

  // Behaviour, not just presence: an unregistered token must report NO_FEED,
  // which is the documented fail-closed answer rather than a revert.
  const unknown = "0x000000000000000000000000000000000000dEaD";
  const state = Number(word(await call(guardAddress, SELECTOR.state + pad(unknown))));
  check(
    "Unregistered token reports NO_FEED rather than reverting",
    STATE_NAME[state] === "NO_FEED",
    STATE_NAME[state] ?? state,
  );

  const mult = word(await call(guardAddress, SELECTOR.multiplierOf + pad(unknown)));
  check(
    "Unreadable multiplier returns zero, not 1e18",
    mult === 0n,
    mult.toString(),
  );

  const registered = Object.entries(record.feeds?.registered ?? {});
  if (registered.length === 0) {
    console.log(
      "\n  No feeds registered yet. Prices will show as indicative until you register at least one.",
    );
  }
  for (const [symbol, cfg] of registered) {
    const tokenState = Number(word(await call(guardAddress, SELECTOR.state + pad(cfg.token))));
    check(`${symbol} resolves to a real state`, STATE_NAME[tokenState] !== undefined, STATE_NAME[tokenState]);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n  ${checks.length - failed.length}/${checks.length} checks passed.${failed.length ? " Deployment is NOT ready." : " Deployment verified."}\n`,
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n  verify-deployment failed: ${err.message}\n`);
  process.exit(1);
});
