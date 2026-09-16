# Deployments

**Nothing is deployed yet.** This directory is the single place addresses live,
and it is empty on purpose rather than filled with plausible-looking zeros.

The fix for an unproven claim is to make it true, not to delete it. The full
path from a funded key to verified addresses is `../docs/DEPLOY.md`, and the
tooling writes this directory for you — `npm run deploy:record` reads Foundry's
broadcast file, and `npm run deploy:verify` then checks the result against the
live chain.

An external reviewer noted that the README and `SUBMISSION.md` claimed the
contracts were deployed and verified on chain 4663 while no address appeared
anywhere in the repository. A reviewer's first instinct is to open the explorer,
and an unverifiable claim costs more credibility than an honest gap. So the
claim was removed until the address exists, not decorated.

## To deploy

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

Rehearse on testnet (`--chain 46630`) first. It is free and it catches the
mistakes that are expensive on mainnet.

`"verified": true` is a claim about something a reviewer can check in one click,
so set it only after the click works.

Until `chain-4663.json` exists, the desk runs the preflight route and says so in
the Transfer tab, in those words.
