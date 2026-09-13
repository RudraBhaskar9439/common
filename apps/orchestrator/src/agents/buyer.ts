/**
 * The buyer agent: decides buy / reuse / reject for a goal, given what shared memory holds.
 *
 * What it is: a language model choosing among options the orchestrator already deemed
 * valid, and explaining why in its own words. That explanation is what goes to HCS, so
 * the audit trail is genuinely agent-stated rather than templated.
 *
 * What it is not: an authority. It cannot reuse a stale report, exceed the budget, or
 * invent an action. Every decision is re-checked against the same rules that applied
 * before this file existed, and any malformed or unavailable response falls back to that
 * deterministic policy. The money path never sees this module.
 *
 * Cost control: one request per decision, small model, output capped at 200 tokens.
 * On gpt-4o-mini that is on the order of $0.0001 per decision.
 */

export type BuyerAction = 'buy' | 'reuse' | 'reject';

export interface MemoryCandidate {
  operationId: string;
  agentId: string;
  status: string;
  ageMinutes: number;
  fresh: boolean;
  /** Pass counts per model when a report exists, e.g. "qwen3:4b 4/5 · qwen3:1.7b 2/5". */
  summary?: string;
}

export interface BuyerInput {
  agentId: string;
  goal: string;
  /** Tinybars the requester is willing to spend on this goal. */
  budgetTinybar: bigint;
  /** Tinybars a new evaluation costs. 0 in local mode. */
  priceTinybar: bigint;
  candidates: MemoryCandidate[];
  /** Actions the orchestrator will actually honour for this request. */
  allowed: BuyerAction[];
}

export interface BuyerDecision {
  action: BuyerAction;
  reason: string;
  /** Who made the call: the model, or the deterministic policy as a fallback. */
  source: 'openai' | 'policy';
  model?: string;
}

export interface BuyerAgent {
  decide(input: BuyerInput): Promise<BuyerDecision>;
}

const hbar = (t: bigint) => `${Number(t) / 1e8} HBAR`;

/** The rule the system followed before any model was involved. Always available. */
export function policyDecision(input: BuyerInput): BuyerDecision {
  const usable = input.candidates.find(c => c.status === 'completed' && c.fresh);
  if (usable && input.allowed.includes('reuse')) {
    return { source: 'policy', action: 'reuse', reason: `A fresh, delivered report for this exact configuration already exists (${usable.ageMinutes}m old). Re-running would cost ${hbar(input.priceTinybar)} for no new information.` };
  }
  if (input.allowed.includes('buy')) {
    if (input.priceTinybar > input.budgetTinybar) return { source: 'policy', action: 'reject', reason: `A new evaluation costs ${hbar(input.priceTinybar)}; the budget for this goal is ${hbar(input.budgetTinybar)}.` };
    return { source: 'policy', action: 'buy', reason: `No usable evaluation exists for this configuration. A bounded run costs ${hbar(input.priceTinybar)}, within the ${hbar(input.budgetTinybar)} budget.` };
  }
  const claimed = input.candidates[0];
  if (claimed && input.allowed.includes('reuse')) {
    // The purchase is already claimed by another request. Attaching to it is always cheaper
    // than paying again: if it is still running we wait, if it delivered we reuse.
    return { source: 'policy', action: 'reuse', reason: `${claimed.agentId} already claimed this evaluation (${claimed.status}, ${claimed.ageMinutes}m ago). Attaching to that operation instead of paying ${hbar(input.priceTinybar)} again.` };
  }
  return { source: 'policy', action: 'reject', reason: 'No acquisition is possible for this goal right now.' };
}

/** Enforce the rules regardless of what the model said. Returns the corrected decision. */
export function enforce(input: BuyerInput, proposed: BuyerDecision): BuyerDecision {
  if (!input.allowed.includes(proposed.action)) {
    return { ...policyDecision(input), reason: `${proposed.reason} — overridden: "${proposed.action}" is not available here.` };
  }
  if (proposed.action === 'buy' && input.priceTinybar > input.budgetTinybar) {
    return { action: 'reject', source: proposed.source, reason: `${proposed.reason} — overridden: ${hbar(input.priceTinybar)} exceeds the ${hbar(input.budgetTinybar)} budget.`, ...(proposed.model ? { model: proposed.model } : {}) };
  }
  if (proposed.action === 'reuse' && input.candidates.length === 0) {
    return { ...policyDecision(input), reason: `${proposed.reason} — overridden: nothing exists in memory to reuse.` };
  }
  return proposed;
}

function prompt(input: BuyerInput): string {
  const memory = input.candidates.length
    ? input.candidates.map(c => `- ${c.operationId.slice(0, 8)} by ${c.agentId}: ${c.status}, ${c.ageMinutes} minutes old, ${c.fresh ? 'still fresh' : 'STALE'}${c.summary ? `, results: ${c.summary}` : ''}`).join('\n')
    : '- (empty: no prior evaluation for this configuration)';
  return [
    `You are ${input.agentId}, an autonomous agent sharing a spending budget with other agents.`,
    `Goal: ${input.goal}`,
    `Budget for this goal: ${hbar(input.budgetTinybar)}. Price of one new evaluation: ${hbar(input.priceTinybar)}.`,
    `Shared memory for this exact evaluation configuration:`, memory,
    `Allowed actions: ${input.allowed.join(', ')}.`,
    `Rules: "reuse" takes the existing operation (waiting for it if it is still running) at no cost. "buy" pays for a new evaluation. Never spend beyond the budget. Do not pay for information the team already has.`,
    `Respond with JSON only: {"action": "<one allowed action>", "reason": "<one or two sentences, first person, specific numbers>"}`,
  ].join('\n');
}

export interface OpenAIBuyerOptions {
  apiKey: string;
  model?: string;
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1. Defaults to OpenAI. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Buyer backed by the OpenAI Chat Completions API. Falls back to policy on any failure. */
export function createOpenAIBuyer(options: OpenAIBuyerOptions): BuyerAgent {
  const model = options.model ?? 'gpt-4o-mini';
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `${(options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
  return {
    async decide(input) {
      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
          signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
          body: JSON.stringify({
            model, temperature: 0, max_tokens: 200,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt(input) }],
          }),
        });
        if (!response.ok) throw new Error(`OpenAI ${response.status}`);
        const body = await response.json() as { choices?: { message?: { content?: string } }[] };
        const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { action?: unknown; reason?: unknown };
        const action = String(parsed.action ?? '').toLowerCase() as BuyerAction;
        const reason = String(parsed.reason ?? '').trim().slice(0, 400);
        if (!['buy', 'reuse', 'reject'].includes(action) || !reason) throw new Error('Malformed decision');
        return enforce(input, { action, reason, source: 'openai', model });
      } catch (err) {
        // The model is advisory. Its absence must never stall a request. Say why, without the key.
        console.warn(`[buyer] ${model} unavailable, policy decided instead: ${err instanceof Error ? err.message : String(err)}`);
        return policyDecision(input);
      }
    },
  };
}

/** Deterministic buyer for environments without a model configured. */
export const policyBuyer: BuyerAgent = { async decide(input) { return policyDecision(input); } };
