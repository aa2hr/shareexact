# ShareExact — submission

**Track:** Robinhood Chain (Ethereum ecosystem) · Colosseum Crypto World's Fair
**Team:** two people
**Live:** **[shareexact.com](https://shareexact.com)** — the desk, reading chain 4663 and signing transfers today
**Contracts:** written, tested (61 Foundry tests), Slither-clean. Addresses in
`deployments/chain-4663.json`, written by `npm run deploy:record` and checked
against the live chain by `npm run deploy:verify`. Runbook: `docs/DEPLOY.md`
**Proof:** share-denominated transfer executed on mainnet —
[`0xf8da86e2…d649555`](https://robinhoodchain.blockscout.com/tx/0xf8da86e2e507b7adfcaacf85e97377956445c40f2b3b063b7e10fc0c3d649555)

---

## The problem, with a number

On a token with a 4x multiplier, someone moving $10,000 of stock — 25 shares at
$400 — computes 25 raw units the obvious way and sends 100 shares. $40,000. A
$30,000 overshoot, on a transfer that succeeds without a revert or a warning.

## The problem

A Robinhood Stock Token is a standard ERC-20 whose raw unit is not a share. One
raw unit is `uiMultiplier() / 1e18` shares, and that ratio moves on every
reinvested dividend and every split. Separately, the Chainlink feed that prices
it publishes 24/5 while the token trades 24/7.

Wallets and DEXs are unaffected, because they quote raw units and never mark to
an oracle. Everything above them is affected: lending, baskets, structured
products, portfolio and tax surfaces all have to convert to shares themselves,
and each one invents its own rounding, its own staleness policy and its own
corporate-action race. For roughly two thirds of every week, an integration that
does not check `updatedAt` is marking positions against a closed market and does
not know it.

## What we built

| Layer | What it is |
| --- | --- |
| `ShareExactGuard.sol` | Read-only, custody-free state machine: `FRESH`, `STALE`, `ORACLE_PAUSED`, `CORP_ACTION`, `SEQUENCER_DOWN`, `NO_FEED`. The enum is about data, not the NYSE calendar |
| `ExactTransfer.sol` | Moves an exact number of **shares**. Reads the multiplier inside the transaction, so a browser quote cannot settle against a changed ratio |
| `@shareexact/sdk` | Zero-dependency reader with the same precedence order, so other protocols do not rebuild this. Builds to `dist/` and is publishable |
| `ExampleCollateralPool` | Fifty-line third-party consumer of the guard. Declines to liquidate on a stale mark |
| Desk | Reads the registry, balances, multipliers and feeds live; labels every price with its provenance; signs the transfer |

Two design decisions worth a judge's attention:

**A transfer needs the multiplier, not the price.** Those fail independently, so
a weekend `STALE` transfer is allowed and a transfer quoted seconds before a
split is not. `test_weekendStalePriceStillAllowsTransfer` pins it.

**An unreadable multiplier is never assumed to be 1:1.** A contract cannot tell
"no multiplier" from "4x multiplier, call failed"; both arrive as a failed
staticcall. Assuming 1.0 sends four shares for a one-share request. We shipped
that bug, an external review caught it, and it is now fail-closed in the
contract, the SDK, the oracle layer and the wallet path.

## Demo, in order

Follow `docs/DEMO.md` exactly. The desk opens on Transfer by design.

1. Connect a wallet; registry and balances load from chain 4663.
2. Pick an asset whose multiplier is not 1.0; see the naive column against the
   exact column.
3. Sign. Open the Blockscout link.
4. Show staleness: either the live banner on a weekend, or
   `test_staleAfterWeekend`.
5. `forge test` — 61 tests, including `ExampleCollateralPool`: a third-party
   lending pool that refuses to liquidate on a weekend mark.
6. Only then, the risk view, labelled as simulation.

## What is real and what is not

Real: the registry, balances, multipliers, Chainlink reads, sequencer status,
the contracts, and the signed transfer.

Simulation, and labelled in the UI: the stress scenarios and the volatility and
LTV tables in the risk view. These are demo heuristics. This is not a lending
market and does not claim to be one.

Not claimed: an audit. `docs/SECURITY.md` carries the trust model, the full
failure policy, and a point-by-point response to three rounds of external review
including the findings we declined and why.

## Prior work

`docs/DISCLOSURE.md` splits the repository honestly. The UI, the registry
integration and the conversion math predate the hackathon window. The contracts,
the oracle layer, transaction execution, the SDK and the security work do not.
Copy that file into the submission form verbatim.

## Run it

```bash
node --version    # 22.12 or newer
npm install
npm run dev
npm test          # 54 TypeScript tests + 61 Solidity tests
```

Prices show as indicative until a Chainlink feed is configured, and the desk
says so in a banner rather than presenting a demo number as a live one.
