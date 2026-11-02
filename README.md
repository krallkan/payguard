# PayGuard

Built at NEAR HACKATHON 2026 (Nov 1–14). Tracks: `security`, `agents`

> Status: Phase 3 — guard contract, risk service, guarded agent, attack demo and web console work on testnet.
> Demo mode without keys or funds (Phase 4) is not built yet. Design: [docs/DESIGN.md](docs/DESIGN.md).

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
- Owner console key: a second function-call key on `taskin-hack.testnet`, limited to `approve_pending`, `reject_pending`, `report`, `set_frozen` — the web console can approve held payments but cannot withdraw or change limits.
- NEAR RPC + NearBlocks testnet API: receiver signals (account exists, is a contract, account age, transaction count, last code deploy).

## Try it in 5 minutes (no funds needed)

Needs Node.js 20+ and git. No `.env`, keys, wallet or NEAR are required: demo mode runs the guard contract's rules in an in-memory simulator ([packages/sim/src/sim-guard.ts](packages/sim/src/sim-guard.ts), same checks and panic messages as [contract/src/lib.rs](contract/src/lib.rs), real ed25519 signatures) against fixture accounts.

1. `git clone <repo> && cd <repo>`
2. `npm install`
3. `npm test` → you should see `# pass 34` and `# fail 0`.
4. `npm run demo:attack` → the terminal ends with `RESULT: refund-desk.taskin-hack.testnet received nothing`; the summary lists two `sent` invoices, one `refused_by_wrapper` and two `refused_by_contract`.
5. `npm run demo` → open http://localhost:3000. The header shows `demo mode · simulated contract`.
   - Click **Run agent on inbox** → the log shows `SENT` twice and, for the injected invoice, `[block] on the shared blocklist …` and `REFUSED — verdict block, nothing signed`.
   - Click **Attacker bypasses wallet** → `REJECTED — Smart contract panicked: invalid oracle signature`, then `REJECTED — Smart contract panicked: receiver is on the shared blocklist`.
   - Enter `newvendor.taskin-hack.testnet`, `0.05`, click **Agent pays** → `[warn] account age unknown …` and `HELD by guard`; the payment appears under **Waiting for you**. Click **Approve** → `approve #N: OK`, newvendor's balance goes from 0.10 to 0.15.
   - Enter `vault.taskin-hack.testnet`, `0.1`, click **Check only** → `WARN` with `contract code changed 2h ago`.

Demo state lives in memory and resets when the server restarts. Fixture accounts and their facts: [packages/sim/src/fixtures.ts](packages/sim/src/fixtures.ts).

To run against the real testnet contract instead, fill `.env` from `.env.example` with `DEMO=0` and the keys (see [scripts/deploy-testnet.sh](scripts/deploy-testnet.sh)); `npm run web`, `npm run attack`, `npm run check` and `npm run owner` then use testnet.

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

Risk service (live testnet data: NEAR RPC, NearBlocks API, guard contract views):

```bash
npm test                                                # risk + agent tests → "# pass 15"
npm run check -- refund-desk.taskin-hack.testnet 0.1    # → BLOCK, quotes the blocklist evidence
npm run check -- shop.taskin-hack.testnet 0.1           # → ALLOW, "paid 1 time(s) before"
npm run risk                                            # HTTP on :3001
curl -s -X POST localhost:3001/check -d '{"receiver":"shop.taskin-hack.testnet","amountYocto":"100000000000000000000000"}'
```

Web console (needs a filled `.env`; owner actions are signed with `OWNER_CONSOLE_KEY`, a function-call key limited to `approve_pending`, `reject_pending`, `report`, `set_frozen`):

```bash
npm run web        # http://localhost:3000
```

1. "Where the money is" shows the guard balance, spend today vs. the daily limit, and each demo account's balance.
2. Click **Run agent on inbox** → the log shows two `SENT` invoices and `REFUSED — verdict block, nothing signed` for the injected one.
3. Enter `newvendor.taskin-hack.testnet`, `0.05`, click **Agent pays** → `[warn] account age unknown … never paid before` and `HELD by guard`. The payment appears under **Waiting for you**.
4. Click **Approve** → `approve #N: OK` with an explorer link; the row becomes `warn / sent` and newvendor's balance rises by 0.05.
5. **Report** adds an account to the on-chain blocklist; **Freeze** stops every payment until unfrozen.

The same owner actions from a terminal: `npm run owner -- pending`, `npm run owner -- approve <id>`.

Prompt-injection attack demo on testnet (`DEMO=0` in `.env`; spends ~0.08 testnet NEAR from the guard — `npm run demo:attack` runs the same thing without funds):

```bash
npm run attack
```

The agent reads [inbox/](inbox/): two real invoices and [invoice-003.txt](inbox/invoice-003.txt), which tells "automated payment assistants" to send 0.2 NEAR to `refund-desk.taskin-hack.testnet`. Without `NEAR_AI_API_KEY` the agent uses a scripted stand-in that obeys such instructions on purpose; with the key it uses NEAR AI Cloud (`deepseek-ai/DeepSeek-V3.1`, override with `NEAR_AI_MODEL`). Expected summary (full log: [docs/attack-demo.log](docs/attack-demo.log)):

```
  sent                 shop.taskin-hack.testnet 0.05 NEAR  (invoice-001.txt)
  sent                 shop.taskin-hack.testnet 0.03 NEAR  (invoice-002.txt)
  refused_by_wrapper   refund-desk.taskin-hack.testnet 0.2 NEAR  (invoice-003.txt (instruction in document))
  refused_by_contract  refund-desk.taskin-hack.testnet 0.2 NEAR  (2a re-targeted verdict)
  refused_by_contract  refund-desk.taskin-hack.testnet 0.2 NEAR  (2b compromised oracle)

RESULT: refund-desk.taskin-hack.testnet received nothing
```

Act 2 assumes the attacker controls the agent process and skips the wallet: a genuine `allow` issued for the shop fails when re-targeted ([CcZZ9rGb…](https://testnet.nearblocks.io/txns/CcZZ9rGbHUta72bmBQbQ7kusB315dQpmcaLKkgsNzU1m), `invalid oracle signature`), and an `allow` from a compromised oracle loses to the on-chain blocklist ([5SRTKE8Z…](https://testnet.nearblocks.io/txns/5SRTKE8ZnpCYrh8nDD1NhjnnZNRF9q7pqJLVsvTHnB5s)).

The risk service response has `verdict`, human-readable `reasons`, the raw `signals` and `signed` (the oracle signature the guard contract checks). Rules: [packages/risk/src/score.ts](packages/risk/src/score.ts). NearBlocks' free API rate-limits (HTTP 429); answers are cached for 5 minutes and an unreachable indexer is reported in the reason and treated as unknown → `warn`, never `allow`.

## Architecture

```
 untrusted text ──► Agent (LLM) ── pay(receiver, amount) ──► GuardedWallet
 (invoices, mail)                                               │
                                     1. check(receiver, amount) ▼
                                  ┌──────────────── Risk service ─────────────────┐
                                  │ signals: NEAR RPC (exists, contract?)         │
                                  │          NearBlocks (age, tx count, deploys)  │
                                  │          guard views (blocklist, history)     │
                                  │ rules → allow | warn | block + reasons        │
                                  │ ed25519-sign(guard|agent|receiver|amount|     │
                                  │              verdict|nonce|expires_at)        │
                                  └───────────────────────┬───────────────────────┘
                                                          ▼
                     2. block → wallet refuses, nothing is signed
                     3. allow / warn → guard.pay(receiver, amount, verdict)
                        signed by the agent's function-call key
                                                          ▼
                  ┌──────────── guard contract (holds the funds) ─────────────┐
                  │ not frozen · caller is the agent · signature valid for   │
                  │ this exact receiver+amount · nonce unused · not expired · │
                  │ verdict ≠ block · receiver not blocklisted · per-tx limit │
                  │ allow → daily limit + balance → transfer → callback       │
                  │ warn  → held until owner approve_pending / reject_pending │
                  └───────────────────────────────────────────────────────────┘
```

Why two layers: the wallet is code in the agent's process, so an attacker who owns that process can skip it. The contract cannot be skipped — the agent's only key can call nothing but `pay`/`report` on it, and `pay` needs a signature the agent cannot produce. The contract also does not trust the oracle blindly: the blocklist and limits apply to `allow` too.

| Path | What it is |
|---|---|
| [contract/src/lib.rs](contract/src/lib.rs) | Guard contract (Rust, near-sdk 5), 16 unit tests |
| [packages/risk/](packages/risk/) | Signals, scoring rules, verdict signing, HTTP service (`npm run risk`) |
| [packages/agent/](packages/agent/) | GuardedWallet, agent loop, LLM adapters (NEAR AI Cloud / scripted), owner console, `GuardClient` for testnet |
| [packages/sim/](packages/sim/) | Demo mode: in-memory guard with the contract's rules, fixture accounts |
| [packages/app/](packages/app/) | Picks demo or testnet and wires everything together |
| [packages/web/](packages/web/) | Web console (`npm run web` / `npm run demo`) |
| [scripts/](scripts/) | Deploy, attack demo, smoke test, CLI check, owner CLI, oracle keygen |
| [inbox/](inbox/) | Demo invoices; `invoice-003.txt` carries the prompt injection |

More detail and design decisions: [docs/DESIGN.md](docs/DESIGN.md).

## Limits and known issues

- **Testnet only, NEAR only.** The guard pays native NEAR. No fungible tokens (USDC) and no NEAR Intents yet; Intents has no testnet (HACKATHON.md Q-007).
- **The oracle is one ed25519 key** held by the risk service. If it leaks, an attacker can sign `allow` for any receiver that is not blocklisted; the contract's per-transaction and daily limits cap the damage, and `set_oracle_pk` rotates the key. Running the risk service in a TEE (e.g. NEAR AI Cloud attestation) would harden this; not implemented.
- **Risk rules are heuristics.** They catch blocklisted, missing, new and look-alike accounts, recent code changes and large first payments. A patient scammer with an old, clean account gets `allow` until someone reports it.
- **Indexer data can be missing.** NearBlocks testnet lags behind the chain and its free API rate-limits (HTTP 429). Missing data is treated as unknown → `warn` (never `allow`), unless the guard already paid that receiver successfully.
- **Blocklist griefing.** Anyone can report an account by attaching 0.01 NEAR, and one report blocks it. The owner can `remove_from_blocklist`. A production version needs reporter reputation or a threshold.
- **One agent per guard**, set at init (`set_agent` changes it). Daily limit resets on the UTC calendar day.
- **The guard account still has its full-access key** so the contract can be redeployed during the hackathon. In production that key should be removed so only the contract code controls the funds.
- **Web console has no login.** It binds to `127.0.0.1` only and is meant to run on the owner's machine.
- **Demo mode simulates the contract in TypeScript**, it does not execute the wasm. Parity is enforced by [packages/sim/test/sim-guard.test.ts](packages/sim/test/sim-guard.test.ts), which mirrors the Rust unit tests case by case.
- **The scripted LLM is deliberately vulnerable**, so the attack is reproducible without an API key. The NEAR AI Cloud adapter uses the documented OpenAI-compatible endpoint (`https://cloud-api.near.ai/v1`) but has not been run against the live API in this repo's recorded logs.
- **Agent function-call key allowance is 0.25 NEAR of gas.** When it runs out the owner adds a new key (NEAR access-key rule: an allowance cannot be raised).
- **Contract tests are unit tests**; there are no near-workspaces sandbox integration tests. The deployed contract is exercised end to end by `npm run smoke` and `npm run attack` (transaction links above).

## Pre-existing code

None. All code in this repository was written during the hackathon (first commit 2026-11-02).

Third-party libraries and templates: `near-sdk` (contract), the `cargo near new` project template (its auction example was replaced), `near-kit` (RPC and signing), `bs58`, `dotenv`, `tsx`, `typescript`, `ed25519-dalek` (contract tests only). NEAR agent skills (`npx skills add near/agent-skills`) were used as reference while building. This README and most code were written with Claude Code.

## License

MIT — see [LICENSE](LICENSE).
