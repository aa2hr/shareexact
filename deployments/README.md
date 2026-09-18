# Deployments

This directory is the single place addresses live. It is not empty.

| | |
| --- | --- |
| Network | Robinhood Chain mainnet, 4663 |
| Record | [`chain-4663.json`](./chain-4663.json) |
| ShareExactGuard | [`0x2dd1d4C1556D86C0dc98B6b5ef12b450C8D4C9D8`](https://robinhoodchain.blockscout.com/address/0x2dd1d4C1556D86C0dc98B6b5ef12b450C8D4C9D8) |
| ExactTransfer | [`0x8C726dC9d27902515F70596b7f07610f1Bf4ecd2`](https://robinhoodchain.blockscout.com/address/0x8C726dC9d27902515F70596b7f07610f1Bf4ecd2) |
| Feeds on the guard | 8, verified against `description()`: AAPL GOOGL INTC MSFT NVDA SLV SPY TSLA |
| Proof | [`0x7a6daf6d…1ada29`](https://robinhoodchain.blockscout.com/tx/0x7a6daf6d88386096d3b1d63bb46903782a78669200f24378098cfdb9be1ada29) — 0.002 shares through ExactTransfer |
| Rehearsal | [`chain-46630.json`](./chain-46630.json) on testnet |

`npm run deploy:verify` runs 16 checks against live chain state. That is the
proof, not this paragraph.

`"verified": true` in the JSON is a claim about something a reviewer can check
in one click on the explorer. Set it only after the click works.

The remaining symbols in `src/lib/feeds.generated.json` are shown by the desk
and report `NO_FEED` on-chain until registered. Registering one is a single
transaction and blocked by nothing but gas. `npm run feeds:parity` prints the gap.

## To deploy again

```bash
cd contracts
export PRIVATE_KEY=0x...
export GUARD_OWNER=0x...              # multisig for anything beyond a demo
export FEED_STALENESS=93600           # 26h, sized for a 24/5 equity feed
forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --verify

cd ..
npm run deploy:record                 # writes chain-4663.json from the broadcast
npm run deploy:verify                 # proves it against the live chain
```

Rehearse on testnet (`--chain 46630`) first. Redeploying mainnet changes the
address: the 8 feeds and the proof transaction above would have to be rebuilt.
Do not do that unless the bytecode must change.
