/**
 * LLM backend for the analyzer and the chat-to-edit feature.
 *
 * Three backends, resolved per model tier:
 *   1. Anthropic API with a real ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
 *      (any model, structured outputs, fastest + unrestricted).
 *   2. Anthropic SDK over the local Claude Code subscription OAuth token
 *      (from ~/.claude/.credentials.json). Fast (~seconds) but the
 *      subscription only permits Haiku over the direct API — the larger
 *      models return 429 — so this backend is used for the "fast" tier only.
 *   3. Headless Claude Code CLI (`claude -p`) — reuses the subscription and
 *      can run any model, but carries heavy harness overhead (minutes).
 *
 * Resolution: real key ? API : (fast tier & OAuth token ? SDK-OAuth : CLI),
 * with SDK failures falling back to the CLI.
 */

import { spawn } from "child_process";
import { readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";
import { z, type ZodType } from "zod";
import { type ModelTier, DEFAULT_TIER } from "../lib/models.js";

export { type ModelTier, DEFAULT_TIER };

/** Model id per tier for the direct API (real key or OAuth). */
const API_MODEL: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  best: "claude-opus-4-8",
};

/** Explicit model id per tier for the Claude Code CLI (so Balanced is
 *  really Sonnet 5, not whatever the "sonnet" alias resolves to). */
const CLI_MODEL: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  best: "claude-opus-4-8",
};

export const TIER_LABEL: Record<ModelTier, string> = {
  fast: "Fast · Haiku",
  balanced: "Balanced · Sonnet 5",
  best: "Best · Opus",
};

/* ------------------------------------------------------------------ */
/* Schemas                                                            */
/* ------------------------------------------------------------------ */

const EntrySchema = z.object({
  from: z.string().describe('Start time "HH:mm", 15-min aligned'),
  to: z.string().describe('End time "HH:mm", 15-min aligned ("23:59" allowed)'),
  project: z.string().describe("Exact ZEP project name from the list"),
  task: z.string().describe("Exact LEAF task name from the list"),
  subtask: z
    .union([z.string(), z.null()])
    .describe("Child task name when disambiguation is needed, else null"),
  note: z.string().describe("Short factual description"),
  billable: z
    .union([z.boolean(), z.null()])
    .describe("Override project default only when certain, else null"),
  confidence: z.number().describe("0-100"),
  reasoning: z
    .union([z.string(), z.null()])
    .describe("One short sentence explaining ambiguous classifications, else null"),
});

const NonWorkSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["lunch", "private", "away", "break", "meeting", "commute", "errand"]),
  note: z
    .union([z.string(), z.null()])
    .describe("What this non-work period was, if inferable (e.g. 'lunch with team', 'commute', 'WhatsApp/personal browsing')"),
});

export const AnalysisSchema = z.object({
  summary: z
    .string()
    .describe("2-3 sentence plain-language summary of the working day"),
  entries: z.array(EntrySchema),
  nonWork: z.array(NonWorkSchema),
});

export type AnalysisResult = z.infer<typeof AnalysisSchema>;

/**
 * Chat-to-edit returns a list of OPERATIONS against numbered rows — never a
 * full rewrite. Rows the operations don't name are left byte-identical, so
 * approved/verified entries and anything the user didn't ask about are never
 * disturbed.
 */
const OperationSchema = z.object({
  op: z.enum(["set", "add", "remove"]).describe("set = modify an existing row; add = new entry; remove = delete a row"),
  row: z
    .union([z.number(), z.null()])
    .describe("1-based row number to set/remove (null for add)"),
  from: z.union([z.string(), z.null()]).describe('"HH:mm" 15-min aligned, or null to leave unchanged'),
  to: z.union([z.string(), z.null()]).describe('"HH:mm" ("23:59" allowed), or null'),
  project: z.union([z.string(), z.null()]).describe("exact ZEP project name, or null"),
  task: z.union([z.string(), z.null()]).describe("exact leaf task name, or null"),
  subtask: z.union([z.string(), z.null()]),
  note: z.union([z.string(), z.null()]),
  billable: z.union([z.boolean(), z.null()]),
});
export const EditOpsSchema = z.object({
  reply: z.string().describe("One short sentence describing what you changed"),
  operations: z.array(OperationSchema),
});
export type EditOpsResult = z.infer<typeof EditOpsSchema>;

/* ------------------------------------------------------------------ */
/* Backend resolution                                                 */
/* ------------------------------------------------------------------ */

interface Backend {
  kind: "api" | "cli";
  oauth: boolean;
  model: string;
  label: string;
}

function hasRealKey(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

interface OAuthCreds {
  accessToken: string;
  expiresAt: number;
}

function loadOAuth(): OAuthCreds | null {
  if (process.env.TIMESHEET_LLM === "cli") return null;
  try {
    const raw = readFileSync(
      resolve(homedir(), ".claude", ".credentials.json"),
      "utf-8"
    );
    const o = JSON.parse(raw)?.claudeAiOauth;
    if (!o?.accessToken) return null;
    if (typeof o.expiresAt === "number" && o.expiresAt < Date.now() + 60_000)
      return null; // expired / about to expire
    return { accessToken: o.accessToken, expiresAt: o.expiresAt ?? 0 };
  } catch {
    return null;
  }
}

export function resolveBackend(tier: ModelTier): Backend {
  const forced = process.env.TIMESHEET_LLM; // "api" | "cli" | undefined
  if (hasRealKey() && forced !== "cli") {
    return { kind: "api", oauth: false, model: API_MODEL[tier], label: `${API_MODEL[tier]} · API` };
  }
  if (forced !== "cli" && tier === "fast" && loadOAuth()) {
    return { kind: "api", oauth: true, model: "claude-haiku-4-5", label: "Haiku · SDK (subscription)" };
  }
  return { kind: "cli", oauth: false, model: CLI_MODEL[tier], label: `${CLI_MODEL[tier]} · Claude CLI` };
}

/** Human-readable description of what each tier will actually use right now. */
export function backendSummary(): string {
  if (hasRealKey()) return "Anthropic API (key)";
  if (loadOAuth()) return "Haiku via SDK (subscription) · larger models via CLI";
  return "Claude CLI (subscription)";
}

/* ------------------------------------------------------------------ */
/* Anthropic SDK path (real key or OAuth)                             */
/* ------------------------------------------------------------------ */

async function runViaApi<T>(
  prompt: string,
  schema: ZodType<T>,
  model: string,
  oauth: boolean
): Promise<T> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");

  const client = oauth
    ? new Anthropic({
        authToken: loadOAuth()!.accessToken,
        defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
      })
    : new Anthropic();

  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: zodOutputFormat(schema as ZodType<object>) },
  });

  if (response.stop_reason === "refusal")
    throw new Error("The model declined this request (refusal).");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Model returned no parseable structured output");
  return schema.parse(parsed);
}

/* ------------------------------------------------------------------ */
/* Claude Code CLI path                                               */
/* ------------------------------------------------------------------ */

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(t.slice(start, end + 1));
}

/** Convert a Zod schema to a JSON-Schema string for the CLI's --json-schema. */
function toJsonSchemaArg<T>(schema: ZodType<T>): string | null {
  try {
    const js = (z as unknown as {
      toJSONSchema: (s: unknown, o?: unknown) => unknown;
    }).toJSONSchema(schema, { target: "draft-2020-12" });
    return JSON.stringify(js);
  } catch {
    return null;
  }
}

function runClaude(prompt: string, model: string, extraArgs: string[]): Promise<string> {
  const exe = process.env.CLAUDE_CLI_PATH || "claude";
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      exe,
      [
        "-p",
        "--output-format",
        "json",
        "--model",
        model,
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        ...extraArgs,
      ],
      {
        cwd: process.env.TEMP || process.env.TMP || ".",
        env: process.env,
        windowsHide: true,
      }
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("claude CLI timed out after 10 minutes"));
    }, 600_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf-8");
      if (code !== 0) {
        reject(
          new Error(
            `claude CLI exited with ${code}: ${Buffer.concat(err).toString("utf-8").slice(0, 500) || stdout.slice(0, 500)}`
          )
        );
        return;
      }
      resolvePromise(stdout);
    });
    child.stdin.on("error", () => {}); // avoid EPIPE crash on early exit
    child.stdin.write(prompt, "utf-8");
    child.stdin.end();
  });
}

async function runViaCli<T>(
  prompt: string,
  schema: ZodType<T>,
  model: string,
  schemaHint: string
): Promise<T> {
  // Belt-and-suspenders: --json-schema shapes the produced JSON (as T3 Code
  // does), but Claude Code `-p` is an agent that may reply conversationally,
  // in which case the schema is ignored — so we ALSO keep the "respond with
  // only JSON" prompt hint to push it toward emitting the deliverable.
  const jsonSchema = toJsonSchemaArg(schema);
  const extraArgs = jsonSchema ? ["--json-schema", jsonSchema] : [];
  const basePrompt = `${prompt}\n\n${schemaHint}`;

  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const p =
      attempt === 0
        ? basePrompt
        : `${basePrompt}\n\nYour previous response was invalid: ${lastError}. Output ONLY the JSON object.`;
    try {
      const stdout = await runClaude(p, model, extraArgs);
      const envelope = JSON.parse(stdout) as {
        result?: string;
        is_error?: boolean;
        subtype?: string;
      };
      if (envelope.is_error)
        throw new Error(`claude CLI error: ${envelope.subtype ?? "unknown"}`);
      // With --json-schema the result is clean JSON; extractJson also tolerates
      // the fallback (fenced / prose-wrapped) case.
      return schema.parse(extractJson(envelope.result ?? ""));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`claude CLI failed: ${lastError}`);
}

/* ------------------------------------------------------------------ */
/* Public entry points                                                */
/* ------------------------------------------------------------------ */

async function runStructured<T>(
  prompt: string,
  schema: ZodType<T>,
  tier: ModelTier,
  schemaHint: string
): Promise<{ result: T; backendLabel: string }> {
  const backend = resolveBackend(tier);
  if (backend.kind === "api") {
    try {
      const result = await runViaApi(prompt, schema, backend.model, backend.oauth);
      return { result, backendLabel: backend.label };
    } catch (err) {
      // OAuth/API hiccup (401/429/network) → fall back to the CLI so the
      // user still gets a result.
      if (!backend.oauth) throw err;
      const cliModel = CLI_MODEL[tier];
      const result = await runViaCli(prompt, schema, cliModel, schemaHint);
      return { result, backendLabel: `${cliModel} · Claude CLI (SDK fallback)` };
    }
  }
  const result = await runViaCli(prompt, schema, backend.model, schemaHint);
  return { result, backendLabel: backend.label };
}

const ANALYSIS_HINT = `
Respond with ONLY a JSON object (no prose, no markdown) with this exact shape:
{
  "summary": "2-3 sentence summary of the day",
  "entries": [
    { "from": "HH:mm", "to": "HH:mm", "project": "<exact ZEP project name>",
      "task": "<exact leaf task name>", "subtask": null,
      "note": "short factual description", "billable": null,
      "confidence": 0-100, "reasoning": null }
  ],
  "nonWork": [
    { "from": "HH:mm", "to": "HH:mm", "kind": "lunch"|"private"|"away"|"break"|"meeting"|"commute"|"errand", "note": "what it was, or null" }
  ]
}`;

export async function runAnalysis(
  prompt: string,
  tier: ModelTier = DEFAULT_TIER
): Promise<{ result: AnalysisResult; backendLabel: string }> {
  return runStructured(prompt, AnalysisSchema, tier, ANALYSIS_HINT);
}

const EDIT_HINT = `
Respond with ONLY a JSON object (no prose, no markdown) with this exact shape:
{
  "reply": "one short sentence describing what you changed",
  "operations": [
    { "op": "set"|"add"|"remove", "row": <1-based row number or null for add>,
      "from": "HH:mm"|null, "to": "HH:mm"|null, "project": "<exact name>"|null,
      "task": "<exact leaf task>"|null, "subtask": null, "note": "..."|null, "billable": null }
  ]
}
Only include operations for what the instruction requires. For "set", include only the fields that change (null = leave as-is). Do NOT emit operations for rows you are not changing.`;

export async function runEditOps(
  prompt: string,
  tier: ModelTier = DEFAULT_TIER
): Promise<{ result: EditOpsResult; backendLabel: string }> {
  return runStructured(prompt, EditOpsSchema, tier, EDIT_HINT);
}
