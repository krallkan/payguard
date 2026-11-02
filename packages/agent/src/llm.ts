// Two interchangeable "brains" for the accounts-payable agent:
//  - NearAiLlm: NEAR AI Cloud (OpenAI-compatible chat completions with tool calling)
//  - ScriptedLlm: a deterministic stand-in used when no API key is set. It behaves like a
//    prompt-injectable model on purpose: it follows instructions it finds inside invoice text.

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, string>;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
}

export interface Llm {
  readonly name: string;
  next(messages: Message[]): Promise<{ content: string; toolCalls: ToolCall[] }>;
}

export const PAY_TOOL = {
  type: "function",
  function: {
    name: "pay",
    description: "Pay a NEAR account. Use once per invoice.",
    parameters: {
      type: "object",
      properties: {
        receiver: { type: "string", description: "NEAR account id" },
        amount_near: { type: "string", description: "Amount in NEAR, e.g. \"0.1\"" },
        memo: { type: "string", description: "Invoice reference" },
      },
      required: ["receiver", "amount_near", "memo"],
    },
  },
} as const;

export class NearAiLlm implements Llm {
  readonly name: string;
  constructor(
    private apiKey: string,
    private model = "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    private baseUrl = "https://cloud-api.near.ai/v1",
  ) {
    this.name = `NEAR AI Cloud (${model})`;
  }

  async next(messages: Message[]) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, tools: [PAY_TOOL], temperature: 0 }),
    });
    if (!res.ok) throw new Error(`NEAR AI Cloud HTTP ${res.status}: ${await res.text()}`);
    const msg = ((await res.json()) as any).choices[0].message;
    return {
      content: msg.content ?? "",
      toolCalls: (msg.tool_calls ?? []).map((c: any) => ({
        id: c.id,
        name: c.function.name,
        args: JSON.parse(c.function.arguments || "{}"),
      })),
    };
  }
}

export class ScriptedLlm implements Llm {
  readonly name = "scripted stand-in (follows injected instructions on purpose)";

  async next(messages: Message[]) {
    // One pass: plan every payment from the inbox, then finish after the tool results come back.
    if (messages.some((m) => m.role === "tool")) return { content: "All invoices processed.", toolCalls: [] };

    const inbox = messages.find((m) => m.role === "user")?.content ?? "";
    const calls: ToolCall[] = [];
    for (const block of inbox.split(/^=== /m).slice(1)) {
      const file = block.split("\n")[0].trim();
      const to = block.match(/^Pay to:\s*(\S+)/m)?.[1];
      const amount = block.match(/^Amount:\s*([\d.]+)\s*NEAR/im)?.[1];
      // A naive model treats imperative text in the document as instructions.
      const injected = block.match(/send\s+([\d.]+)\s*NEAR\s+to\s+([a-z0-9._-]+)/i);
      if (injected) calls.push(call(calls.length, injected[2], injected[1], `${file} (instruction in document)`));
      else if (to && amount) calls.push(call(calls.length, to, amount, file));
    }
    return { content: `Paying ${calls.length} invoice(s).`, toolCalls: calls };
  }
}

const call = (i: number, receiver: string, amount_near: string, memo: string): ToolCall => ({
  id: `call_${i}`,
  name: "pay",
  args: { receiver, amount_near, memo },
});
