// CLI risk check against live testnet data: npm run check -- <receiver> [amountNEAR]
import "dotenv/config";
import { liveSources } from "../packages/risk/src/signals.js";
import { createRiskService } from "../packages/risk/src/service.js";

const [receiver, amountNear = "0.1"] = process.argv.slice(2);
if (!receiver) {
  console.error("usage: npm run check -- <receiver> [amountNEAR]");
  process.exit(1);
}
const toYocto = (n: string) => {
  const [i, f = ""] = n.split(".");
  return (BigInt(i) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
};

const guard = process.env.GUARD_CONTRACT_ID!;
const check = createRiskService({
  sources: liveSources({
    rpcUrl: process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org",
    nearblocksUrl: process.env.NEARBLOCKS_API_URL || "https://api-testnet.nearblocks.io",
    guard,
  }),
  guard,
  agent: process.env.AGENT_ACCOUNT_ID!,
  oracleKey: process.env.ORACLE_PRIVATE_KEY!,
});

const r = await check({ receiver, amountYocto: toYocto(amountNear) });
console.log(`${r.verdict.toUpperCase()}  ${receiver}  ${amountNear} NEAR`);
for (const reason of r.reasons) console.log(`  - [${reason.level}] ${reason.text}`);
const { knownReceivers, blockReports, ...facts } = r.signals;
console.log(`  signals: ${JSON.stringify(facts)}`);
