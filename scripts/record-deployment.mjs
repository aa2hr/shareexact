#!/usr/bin/env node
/**
 * Turn a `forge script` broadcast into the repository's deployment record.
 *
 * This exists because a deployment that lives only in a terminal scrollback is
 * not a deployment anyone else can verify. A reviewer's first move is to open
 * the explorer, and the address has to be somewhere they can find it without
 * asking. So the run writes `deployments/chain-4663.json`, and the README and
 * the desk read from there.
 *
 * Two modes, because they are two different jobs:
 *
 *   node scripts/record-deployment.mjs                        # rebuild from the broadcast
 *   node scripts/record-deployment.mjs --chain 46630          # testnet
 *   node scripts/record-deployment.mjs --tx 0xabc…            # attach a proof tx only
 *
 * `--tx` on its own edits one field of an existing record and touches nothing
 * else. It used to rebuild the whole file from the broadcast, which on 26 Sep
 * deleted the hand-written `governance`, `handover` and `deploymentTransactions`
 * blocks, reset both `verified` flags to false, and overwrote `deployedAt` and
 * `commit` with the time of the edit and the current HEAD rather than the
 * deployment's own. Attaching a hash is not a redeployment and must not be
 * recorded as one.
 *
 * Rebuild mode now also carries forward every top-level key it does not own, so
 * a future block added by hand survives the next deploy instead of vanishing
 * from a file nobody thought to diff.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const CHAINS = {
  4663: {
    name: "Robinhood Chain mainnet",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  46630: {
    name: "Robinhood Chain testnet",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const chainId = Number(arg("--chain", "4663"));
const chain = CHAINS[chainId];
if (!chain) {
  console.error(`Unknown chain ${chainId}. Known: ${Object.keys(CHAINS).join(", ")}`);
  process.exit(1);
}

const outPath = resolve(`deployments/chain-${chainId}.json`);
const txHash = arg("--tx");
const rebuild = process.argv.includes("--rebuild");

/*//////////////////////////////////////////////////////////////
            ATTACH MODE — one field, nothing else
//////////////////////////////////////////////////////////////*/

if (txHash && !rebuild) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    console.error(`\n  Not a transaction hash: ${txHash}\n  Expected 0x followed by 64 hex characters.\n`);
    process.exit(1);
  }
  if (!existsSync(outPath)) {
    console.error(
      `\n  No record at ${outPath}.\n` +
        `  Deploy and record first, then attach the hash:\n` +
        `    node scripts/record-deployment.mjs --chain ${chainId}\n`,
    );
    process.exit(1);
  }

  const record = JSON.parse(readFileSync(outPath, "utf8"));
  const before = record.proofTransactions?.exactShareTransfer ?? null;
  record.proofTransactions = {
    ...(record.proofTransactions ?? {}),
    exactShareTransfer: txHash,
  };
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  console.log(`
  Attached to ${outPath}

    proofTransactions.exactShareTransfer
      ${before ? `was  ${before}` : "was  (unset)"}
      now  ${txHash}

  Nothing else in the record was touched. Verify with:

    git diff deployments/chain-${chainId}.json
    node scripts/verify-deployment.mjs --chain ${chainId}
`);
  process.exit(0);
}

/*//////////////////////////////////////////////////////////////
                 REBUILD MODE — from the broadcast
//////////////////////////////////////////////////////////////*/

const broadcastPath = resolve(
  `contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`,
);

if (!existsSync(broadcastPath)) {
  console.error(
    [
      "",
      `  No broadcast found at ${broadcastPath}`,
      "",
      "  Deploy first:",
      "    cd contracts",
      "    forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --verify",
      "",
      "  To attach a proof transaction to the existing record instead:",
      "    node scripts/record-deployment.mjs --tx 0x…",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8"));

/** Foundry records every CREATE in `transactions`; pick out the two we care about. */
function addressOf(name) {
  const tx = broadcast.transactions?.find(
    (t) => t.transactionType === "CREATE" && t.contractName === name,
  );
  return tx?.contractAddress ?? null;
}

const guard = addressOf("ShareExactGuard");
const exactTransfer = addressOf("ExactTransfer");

if (!guard || !exactTransfer) {
  console.error(
    `Could not find both contracts in the broadcast. Guard=${guard} ExactTransfer=${exactTransfer}`,
  );
  process.exit(1);
}

let commit = "unknown";
try {
  commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  // Not a git checkout, or git is unavailable. The record is still useful
  // without a commit, so this is not fatal.
}

const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};

/**
 * `verified` is a claim about a click a reviewer can make on the explorer. It
 * stays true only for an address that did not move; a new address has not been
 * verified yet and must not inherit the old one's badge.
 */
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const keptVerified = (name, address) =>
  same(previous.contracts?.[name]?.address, address) && previous.contracts?.[name]?.verified === true;

/**
 * Blocks this script does not own — `governance`, `handover`,
 * `deploymentTransactions`, anything added later — are carried forward. They
 * describe facts about the chain that a redeploy does not erase, and a script
 * that silently drops what it does not recognise is a script that quietly
 * destroys work.
 */
const record = {
  ...previous,
  chainId,
  network: chain.name,
  deployedAt: new Date().toISOString(),
  commit,
  deployer: broadcast.transactions?.[0]?.transaction?.from ?? null,
  contracts: {
    ShareExactGuard: {
      address: guard,
      explorer: `${chain.explorer}/address/${guard}`,
      verified: keptVerified("ShareExactGuard", guard),
    },
    ExactTransfer: {
      address: exactTransfer,
      guard,
      explorer: `${chain.explorer}/address/${exactTransfer}`,
      verified: keptVerified("ExactTransfer", exactTransfer),
    },
  },
  feeds: previous.feeds ?? {
    note: "Symbol -> { feed, maxStaleness, decimals } as registered on the guard.",
    registered: {},
  },
  proofTransactions: {
    ...(previous.proofTransactions ?? {}),
    ...(txHash ? { exactShareTransfer: txHash } : {}),
  },
};

const movedGuard = previous.contracts?.ShareExactGuard?.address &&
  !same(previous.contracts.ShareExactGuard.address, guard);

mkdirSync(resolve("deployments"), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`
  Recorded ${outPath}

    ShareExactGuard  ${guard}
    ExactTransfer    ${exactTransfer}
${
  movedGuard
    ? `
  The guard address changed. Blocks carried over from the previous record
  describe the OLD deployment and are now wrong:

${Object.keys(previous)
  .filter((k) => !["chainId", "network", "deployedAt", "commit", "deployer", "contracts", "feeds", "proofTransactions"].includes(k))
  .map((k) => `    ${k}`)
  .join("\n") || "    (none)"}

  Review them before committing.
`
    : ""
}
  Next:

    1. Verify on Blockscout, then flip "verified" to true in the JSON:
         cd contracts
         forge verify-contract ${guard} src/ShareExactGuard.sol:ShareExactGuard \\
           --chain ${chainId} --verifier blockscout \\
           --verifier-url ${chain.explorer}/api

    2. Point the desk at the deployed helper so it uses guarded settlement:
         VITE_EXACT_TRANSFER=${exactTransfer}

    3. Prove it works against the live chain:
         node scripts/verify-deployment.mjs --chain ${chainId}
`);
