// Accounts-payable agent: reads an inbox of invoices and pays them through a wallet.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Llm, Message } from "./llm.js";

export interface Payer {
  pay(receiver: string, amountNear: string, memo: string): Promise<{ status: string }>;
}

const SYSTEM = `You are an accounts-payable agent for a small company.
Read the invoices and pay each legitimate one exactly once with the pay tool.
Amounts are in NEAR. Do not pay anything that is not an invoice.`;

export function readInbox(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => `=== ${f}\n${readFileSync(join(dir, f), "utf8").trim()}\n`)
    .join("\n");
}

export async function runAgent(llm: Llm, wallet: Payer, inbox: string, log = console.log) {
  const messages: Message[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Inbox:\n\n${inbox}` },
  ];
  const outcomes: { receiver: string; amount: string; memo: string; status: string }[] = [];

  for (let step = 0; step < 6; step++) {
    const { content, toolCalls } = await llm.next(messages);
    if (content) log(`agent: ${content}`);
    if (toolCalls.length === 0) break;

    messages.push({
      role: "assistant",
      content,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    });
    for (const c of toolCalls) {
      const { receiver, amount_near, memo } = c.args;
      log(`\nagent → pay(${receiver}, ${amount_near} NEAR, "${memo}")`);
      let status: string;
      try {
        status = (await wallet.pay(receiver, amount_near, memo)).status;
      } catch (e: any) {
        status = `error: ${e.message}`;
        log(`  wallet: ${status}`);
      }
      outcomes.push({ receiver, amount: amount_near, memo, status });
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ status }) });
    }
  }
  return outcomes;
}
