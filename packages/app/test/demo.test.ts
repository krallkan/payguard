// End-to-end in demo mode: the same flow a judge runs with `npm run demo`, no keys or network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createDemoContext } from "../src/context.js";
import { ScriptedLlm } from "../../agent/src/llm.js";
import { readInbox, runAgent } from "../../agent/src/agent.js";
import { toYocto } from "../../agent/src/wallet.js";

const inbox = readInbox(fileURLToPath(new URL("../../../inbox", import.meta.url)));
const quiet = () => {};

test("injected invoice is refused, real invoices are paid", async () => {
  const ctx = await createDemoContext({ DEMO: "1" });
  const out = await runAgent(new ScriptedLlm(), ctx.wallet(quiet), inbox, quiet);
  assert.deepEqual(
    out.map((o) => [o.receiver, o.status]),
    [
      [ctx.ids.shop, "sent"],
      [ctx.ids.shop, "sent"],
      [ctx.ids.bad, "refused_by_wrapper"],
    ],
  );
  assert.equal(await ctx.guard.balance(ctx.ids.bad), "0.50");
});

test("wallet bypass is refused by the contract", async () => {
  const ctx = await createDemoContext({ DEMO: "1" });
  const w = ctx.wallet(quiet);
  const amount = toYocto("0.2");
  const shopAllow = await ctx.check({ receiver: ctx.ids.shop, amountYocto: amount });
  const r1 = await w.submit({ receiver: ctx.ids.bad, amount, memo: "", verdict: shopAllow.signed });
  const r2 = await w.submit({ receiver: ctx.ids.bad, amount, memo: "", verdict: ctx.compromisedOracleSign(ctx.ids.bad, amount) });
  assert.match(r1.error!, /invalid oracle signature/);
  assert.match(r2.error!, /receiver is on the shared blocklist/);
});

test("new vendor is held for the owner and paid after approval", async () => {
  const ctx = await createDemoContext({ DEMO: "1" });
  const out = await ctx.wallet(quiet).pay(ctx.ids.newvendor!, "0.05", "first order");
  assert.equal(out.status, "pending_owner");
  const [held] = await ctx.guard.pending();
  assert.ok((await ctx.owner.approve(held.id)).ok);
  assert.equal(await ctx.guard.balance(ctx.ids.newvendor!), "0.15");
});

test("recently changed contract warns, old busy contract is allowed", async () => {
  const ctx = await createDemoContext({ DEMO: "1" });
  const vault = await ctx.check({ receiver: "vault.taskin-hack.testnet", amountYocto: toYocto("0.1") });
  assert.equal(vault.verdict, "warn");
  assert.ok(vault.reasons.some((r) => r.code === "recent_deploy"));
  assert.equal((await ctx.check({ receiver: "hello.near-examples.testnet", amountYocto: toYocto("0.1") })).verdict, "allow");
});
