# PayGuard (working name)

Built at NEAR HACKATHON 2026 (Nov 1–14). Tracks: `security`, `agents`

> Status: Phase 2 — guard contract live on testnet, end-to-end payment flow works from a script.
> Risk service, agent wrapper, web UI and demo mode are not built yet. Design: [docs/DESIGN.md](docs/DESIGN.md).

## What it is
A counterparty check for AI agents that pay. Before an agent sends funds, a risk service scores the
receiver and returns `allow`, `warn` or `block` with reasons. A NEAR contract holds the agent's funds
and only pays out with a signed `allow` verdict, so a prompt-injected agent cannot pay a blocked address.

## The problem
Agents read untrusted text and can be tricked into paying attackers. Today they either hold a
full-access key (no protection) or need a human to approve every payment (not autonomous).

## How NEAR is used
- Contract: [`guard.taskin-hack.testnet`](https://testnet.nearblocks.io/address/guard.taskin-hack.testnet) — holds the agent's funds, verifies the oracle's ed25519 signature (`env::ed25519_verify`) over `(guard, agent, receiver, amount, verdict, nonce, expiry)`, rejects replays, enforces per-transaction and daily limits, keeps a shared blocklist with evidence, holds `warn` payments for the owner. Source: [contract/src/lib.rs](contract/src/lib.rs).
- Function-call access key: `agent.taskin-hack.testnet` signs with a key limited to `receiver_id = guard.taskin-hack.testnet`, `method_names = ["pay", "report"]`, allowance 0.25 NEAR. It cannot transfer NEAR, attach deposits, call other contracts or add keys.
- NEAR RPC + NearBlocks testnet API: receiver signals (age, activity, contract code changes) — planned.

## Try it in 5 minutes (no funds needed)
TBD (Phase 4): `npm install && npm run demo`.

## What works today (testnet)

Contract unit tests (Linux/WSL, Rust toolchain from `contract/rust-toolchain.toml`):

```bash
cd contract && cargo test --lib
```

Expected: `test result: ok. 16 passed`.

End-to-end smoke test against the deployed contract (needs a filled `.env` with the agent's function-call key and the oracle key):

```bash
npm install && npm run smoke
```

Expected output (recorded 2026-11-02):

```
message format matches contract: true
[OK]      pay shop.taskin-hack.testnet 0.1 NEAR with an allow verdict
[REFUSED] pay refund-desk.taskin-hack.testnet 0.1 NEAR with a block verdict
          reason: Smart contract panicked: blocked by risk oracle
[REFUSED] pay refund-desk.taskin-hack.testnet 0.1 NEAR with an allow verdict (compromised oracle)
          reason: Smart contract panicked: receiver is on the shared blocklist
```

Transactions from that run:
- Payment sent: [8STc2B3q…](https://testnet.nearblocks.io/txns/8STc2B3q373gusurkU5crsW7Hafb2MmWCDeUhPgQagxZ)
- Refused, block verdict: [AYhiFRUf…](https://testnet.nearblocks.io/txns/AYhiFRUfFpfWMzyGU4oZX43zNdXNx8HJD7ZXv4VMf4Ai)
- Refused, blocklisted receiver despite `allow`: [4oPARhQs…](https://testnet.nearblocks.io/txns/4oPARhQsMDZzsaGhHwqKv1aFRFNdXzojLQ4zuianLPCA)
- Deploy + init: [Fbk2hpe7…](https://testnet.nearblocks.io/txns/Fbk2hpe72Mkd7bvQbLYV26bPfXW6cVB1mDPbK25SRfKt), agent key added: [6TnrtvRK…](https://testnet.nearblocks.io/txns/6TnrtvRKFgbp71a1Hb6fSdHKeZ1KXHVjZzezhUmmEDcW)

Deploying your own copy: [scripts/deploy-testnet.sh](scripts/deploy-testnet.sh) (uses `near-cli-rs` and `cargo-near`).

## Architecture
See [docs/DESIGN.md](docs/DESIGN.md).

## Limits and known issues
TBD.

## Pre-existing code
None. All code written during the hackathon window.
