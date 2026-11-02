// Mirrors contract/src/lib.rs unit tests so the demo simulator cannot drift from the real contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKey } from "near-kit";
import { SimGuard } from "../src/sim-guard.js";
import { signVerdict, type Verdict } from "../../risk/src/verdict.js";

const NEAR = 10n ** 24n;
const ids = { guard: "guard.t", owner: "owner.t", agent: "agent.t", shop: "shop.t", bad: "bad.t", stranger: "x.t" };

function setup() {
  const oracle = generateKey();
  const g = new SimGuard({
    guard: ids.guard,
    owner: ids.owner,
    agent: ids.agent,
    oraclePublicKey: oracle.publicKey.toString(),
    perTxLimitYocto: NEAR,
    dailyLimitYocto: 2n * NEAR,
    guardBalanceYocto: 10n * NEAR,
    accounts: { [ids.shop]: 0n, [ids.bad]: 0n, [ids.owner]: 0n, [ids.agent]: 0n },
  });
  const sign = (receiver: string, amount: bigint, verdict: Verdict, ttlMs?: number) =>
    signVerdict(oracle.secretKey, { guard: ids.guard, agent: ids.agent, receiver, amountYocto: amount.toString(), verdict, ttlMs });
  const pay = (receiver: string, amount: bigint, verdict: any) => g.pay({ receiver, amount: amount.toString(), memo: "", verdict });
  return { g, sign, pay };
}

const half = NEAR / 2n;

test("allow pays and books spend", async () => {
  const { g, sign, pay } = setup();
  const r = await pay(ids.shop, half, sign(ids.shop, half, "allow"));
  assert.ok(r.ok);
  assert.equal((await g.payments())[0].status, "sent");
  assert.equal((await g.config()).spent_today, half.toString());
  assert.equal(await g.balance(ids.shop), "0.50");
});

for (const [name, mutate, expected] of [
  ["block verdict is refused", (s: any) => s.sign(ids.bad, half, "block"), "blocked by risk oracle"],
  ["verdict for another receiver fails the signature", (s: any) => s.sign(ids.shop, half, "allow"), "invalid oracle signature"],
] as const) {
  test(name, async () => {
    const s = setup();
    const r = await s.pay(ids.bad, half, mutate(s));
    assert.equal(r.error, `Smart contract panicked: ${expected}`);
  });
}

test("blocklist beats allow", async () => {
  const { g, sign, pay } = setup();
  await g.report(ids.bad, "phishing", "evidence");
  const r = await pay(ids.bad, half, sign(ids.bad, half, "allow"));
  assert.match(r.error!, /receiver is on the shared blocklist/);
});

test("tampered amount fails the signature", async () => {
  const { sign, pay } = setup();
  const r = await pay(ids.shop, (9n * NEAR) / 10n, sign(ids.shop, NEAR / 10n, "allow"));
  assert.match(r.error!, /invalid oracle signature/);
});

test("replay is refused", async () => {
  const { sign, pay } = setup();
  const v = sign(ids.shop, NEAR / 10n, "allow");
  assert.ok((await pay(ids.shop, NEAR / 10n, v)).ok);
  assert.match((await pay(ids.shop, NEAR / 10n, v)).error!, /verdict nonce already used/);
});

test("only the agent can pay", () => {
  const { g, sign } = setup();
  const v = sign(ids.shop, half, "allow");
  const r = g.callAs(ids.stranger, () => (g as any).payInner(ids.shop, half, "", v));
  assert.match(r.error!, /only the agent can pay/);
});

test("per-tx and daily limits", async () => {
  const { sign, pay } = setup();
  const big = (3n * NEAR) / 2n;
  assert.match((await pay(ids.shop, big, sign(ids.shop, big, "allow"))).error!, /per-transaction limit/);
  const nine = (9n * NEAR) / 10n;
  for (let i = 0; i < 2; i++) assert.ok((await pay(ids.shop, nine, sign(ids.shop, nine, "allow"))).ok);
  assert.match((await pay(ids.shop, nine, sign(ids.shop, nine, "allow"))).error!, /daily limit/);
});

test("warn waits for owner, then approve pays", async () => {
  const { g, sign, pay } = setup();
  assert.ok((await pay(ids.shop, half, sign(ids.shop, half, "warn"))).ok);
  assert.equal((await g.pending()).length, 1);
  assert.equal((await g.config()).spent_today, "0");
  assert.ok((await g.approve(0)).ok);
  assert.equal((await g.payments())[0].status, "sent");
  assert.equal(await g.balance(ids.shop), "0.50");
});

test("warn then reject", async () => {
  const { g, sign, pay } = setup();
  await pay(ids.shop, half, sign(ids.shop, half, "warn"));
  assert.ok((await g.reject(0)).ok);
  assert.equal((await g.payments())[0].status, "rejected");
});

test("agent cannot approve its own warn", async () => {
  const { g, sign, pay } = setup();
  await pay(ids.shop, half, sign(ids.shop, half, "warn"));
  const r = g.callAs(ids.agent, () => (g as any).approveInner(0));
  assert.match(r.error!, /only the owner/);
});

test("strangers need a deposit to report", () => {
  const { g } = setup();
  assert.match(g.reportAs(ids.stranger, ids.bad, "spam", "").error!, /attach 0.01 NEAR/);
  assert.ok(g.reportAs(ids.stranger, ids.bad, "drainer", "tx", NEAR / 100n).ok);
});

test("frozen blocks payments", async () => {
  const { g, sign, pay } = setup();
  await g.freeze(true);
  assert.match((await pay(ids.shop, half, sign(ids.shop, half, "allow"))).error!, /guard is frozen/);
});

test("expired verdict", async () => {
  const { sign, pay } = setup();
  assert.match((await pay(ids.shop, half, sign(ids.shop, half, "allow", -1000))).error!, /verdict expired/);
});

test("transfer to a missing account is marked failed and the budget refunded", async () => {
  const { g, sign, pay } = setup();
  assert.ok((await pay("ghost.t", half, sign("ghost.t", half, "allow"))).ok);
  assert.equal((await g.payments())[0].status, "failed");
  assert.equal((await g.config()).spent_today, "0");
});
