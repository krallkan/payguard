// HTTP risk service. POST /check {"receiver": "...", "amountYocto": "..."} → verdict, reasons, signature.
import "dotenv/config";
import { createServer } from "node:http";
import { liveSources } from "./signals.js";
import { createRiskService } from "./service.js";

const env = (k: string, d?: string) => {
  const v = process.env[k] || d;
  if (!v) throw new Error(`missing ${k} in .env`);
  return v;
};

const guard = env("GUARD_CONTRACT_ID");
const check = createRiskService({
  sources: liveSources({
    rpcUrl: env("NEAR_RPC_URL", "https://rpc.testnet.near.org"),
    nearblocksUrl: env("NEARBLOCKS_API_URL", "https://api-testnet.nearblocks.io"),
    guard,
  }),
  guard,
  agent: env("AGENT_ACCOUNT_ID"),
  oracleKey: env("ORACLE_PRIVATE_KEY"),
});

const port = Number(process.env.RISK_PORT || 3001);

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body, null, 2));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, guard });
  if (req.method !== "POST" || req.url !== "/check") return send(404, { error: "POST /check" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) return send(413, { error: "body too large" });
  }
  try {
    const { receiver, amountYocto } = JSON.parse(raw || "{}");
    const result = await check({ receiver: String(receiver ?? ""), amountYocto: String(amountYocto ?? "") });
    console.log(`${new Date().toISOString()} ${result.verdict.toUpperCase().padEnd(5)} ${receiver} ${amountYocto} — ${result.reasons.map((r) => r.code).join(",")}`);
    send(200, result);
  } catch (e: any) {
    send(400, { error: e.message });
  }
}).listen(port, () => console.log(`risk service on http://localhost:${port} (guard ${guard})`));
