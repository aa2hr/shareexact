# Deployments

This directory is the single place addresses live. It is not empty.

| | |
| --- | --- |
| Network | Robinhood Chain mainnet, 4663 |
| Record | [`chain-4663.json`](./chain-4663.json) |
| ShareExactGuard | [`0x290558b05dec593af7b2ef6dbc26b9ffc38adb37`](https://robinhoodchain.blockscout.com/address/0x290558b05dec593af7b2ef6dbc26b9ffc38adb37) |
| ExactTransfer | [`0x507b0d8e8558e899af3b511b083f73dfe17168ab`](https://robinhoodchain.blockscout.com/address/0x507b0d8e8558e899af3b511b083f73dfe17168ab) |
| Feeds on the guard | 8, verified against `description()`: AAPL GOOGL INTC MSFT NVDA SLV SPY TSLA |
| Proof | [`0x3790392a…68e6b03`](https://robinhoodchain.blockscout.com/tx/0x3790392a8666788f867b0399e5557b77a5ad24764dce1ad9929a2701768e6b03) — guarded send on the 20 Sep 2026 deployment |
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
