#!/usr/bin/env bash
# Deploys the guard contract to testnet and wires up the demo accounts. Run inside WSL/Linux.
# Signs with keys in ~/.near-credentials/testnet (legacy keychain). Never prints private keys.
#
# Usage: bash scripts/deploy-testnet.sh [deploy|fund|report|agent-key|all]
set -euo pipefail
. "$HOME/.cargo/env"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
WASM="${CARGO_TARGET_DIR:-$HOME/payguard-target}/near/payguard_guard.wasm"
NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
quiet() { grep -viE 'ed25519:[1-9A-HJ-NP-Za-km-z]{60,}|private|seed' | grep -iE 'transaction id|hash|error|panic|success|created|added' | head -6 || true; }

deploy() {
  echo "== deploy $GUARD_CONTRACT_ID"
  near contract deploy "$GUARD_CONTRACT_ID" use-file "$WASM" with-init-call new json-args "{
      \"owner\": \"$OWNER_ACCOUNT_ID\",
      \"agent\": \"$AGENT_ACCOUNT_ID\",
      \"oracle_pk\": \"$ORACLE_PUBLIC_KEY\",
      \"per_tx_limit\": \"500000000000000000000000\",
      \"daily_limit\": \"1000000000000000000000000\"
    }" prepaid-gas '100 Tgas' attached-deposit '0 NEAR' $NET $SIGN 2>&1 | quiet
}

fund() {
  echo "== fund guard with 1.5 NEAR from owner"
  near tokens "$OWNER_ACCOUNT_ID" send-near "$GUARD_CONTRACT_ID" '1.5 NEAR' $NET $SIGN 2>&1 | quiet
}

report() {
  echo "== owner reports $BAD_ACCOUNT_ID"
  near contract call-function as-transaction "$GUARD_CONTRACT_ID" report json-args "{
      \"receiver\": \"$BAD_ACCOUNT_ID\",
      \"reason\": \"Impersonates vendors in invoice emails and asks agents to pay a 'refund desk'\",
      \"evidence\": \"demo: inbox/invoice-003.txt (prompt injection)\"
    }" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as "$OWNER_ACCOUNT_ID" $NET $SIGN 2>&1 | quiet
}

agent_key() {
  echo "== add function-call key to $AGENT_ACCOUNT_ID (receiver $GUARD_CONTRACT_ID, methods pay+report, allowance 0.25 NEAR)"
  near account add-key "$AGENT_ACCOUNT_ID" grant-function-call-access --allowance '0.25 NEAR' \
    --contract-account-id "$GUARD_CONTRACT_ID" --function-names 'pay, report' \
    autogenerate-new-keypair save-to-legacy-keychain $NET $SIGN 2>&1 | quiet
}

case "${1:-all}" in
  deploy) deploy ;;
  fund) fund ;;
  report) report ;;
  agent-key) agent_key ;;
  all) deploy; fund; report; agent_key ;;
  *) echo "unknown step: $1"; exit 1 ;;
esac
