# PayGuard (working name)

Built at NEAR HACKATHON 2026 (Nov 1–14). Tracks: `security`, `agents`

> Status: Phase 1 (design). Nothing runs yet. Design: [docs/DESIGN.md](docs/DESIGN.md).

## What it is
A counterparty check for AI agents that pay. Before an agent sends funds, a risk service scores the
receiver and returns `allow`, `warn` or `block` with reasons. A NEAR contract holds the agent's funds
and only pays out with a signed `allow` verdict, so a prompt-injected agent cannot pay a blocked address.

## The problem
Agents read untrusted text and can be tricked into paying attackers. Today they either hold a
full-access key (no protection) or need a human to approve every payment (not autonomous).

## How NEAR is used
- Contract: `guard.<owner>.testnet` (TBD) — holds funds, verifies risk-service signatures, enforces limits and a shared blocklist.
- Function-call access key: the agent can only call `pay` / `report` on the guard contract.
- NEAR RPC + NearBlocks testnet API: receiver signals (age, activity, contract code changes).

## Try it in 5 minutes (no funds needed)
TBD (Phase 4): `npm install && npm run demo`.

## Architecture
See [docs/DESIGN.md](docs/DESIGN.md).

## Limits and known issues
TBD.

## Pre-existing code
None. All code written during the hackathon window.
