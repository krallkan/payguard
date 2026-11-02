# PayGuard guard contract

Holds an AI agent's funds and pays out only with a verdict signed by the PayGuard risk oracle.
Deployed on testnet at [`guard.taskin-hack.testnet`](https://testnet.nearblocks.io/address/guard.taskin-hack.testnet).
Project overview: [../README.md](../README.md).

## Methods

| Method | Caller | What it does |
|---|---|---|
| `new(owner, agent, oracle_pk, per_tx_limit, daily_limit)` | deployer | init |
| `pay(receiver, amount, memo?, verdict)` | agent | verifies the oracle signature over `payguard-v1\|guard\|agent\|receiver\|amount\|verdict\|nonce\|expires_at`, nonce, expiry, blocklist, limits; `allow` → transfer, `warn` → held, `block` → panic |
| `report(receiver, reason, evidence)` | anyone (0.01 NEAR deposit unless owner/agent) | adds a report to the shared blocklist |
| `approve_pending(id)` / `reject_pending(id)` | owner | decides a held `warn` payment |
| `set_limits`, `set_oracle_pk`, `set_agent`, `set_frozen`, `remove_from_blocklist`, `withdraw` | owner | admin |
| `get_config`, `get_payments`, `get_pending`, `get_blocklist`, `is_blocked`, `is_nonce_used`, `verdict_message` | view | state for the UI and the risk service |

Events are logged as `EVENT_JSON:{"standard":"payguard",...}` (`payment_sent`, `payment_pending`, `payment_rejected`, `payment_failed`, `receiver_reported`).

## Build and test (Linux / WSL)

```bash
cargo test --lib                        # 16 passed
cargo near build non-reproducible-wasm  # wasm in target/near/
```

Deploy and wire up accounts: [../scripts/deploy-testnet.sh](../scripts/deploy-testnet.sh).
