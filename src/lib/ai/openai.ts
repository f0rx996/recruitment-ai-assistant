import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { openAiConfig } from "@/lib/env";
import { AiServiceError, type LlmChatParams, type LlmChatResult, type LlmClient } from "./llm";

export const EMBEDDING_DIMENSIONS = 1536;

/** Real OpenAI implementation of LlmClient. Server-side only (reads OPENAI_API_KEY). */
export class OpenAiLlm implements LlmClient {
  private client: OpenAI;
  private chatModel: string;
  private embeddingModel: string;

  constructor(opts?: { apiKey?: string; chatModel?: string; embeddingModel?: string }) {
    const cfg = openAiConfig();
    const apiKey = opts?.apiKey ?? cfg.apiKey;
    if (!apiKey) {
      throw new AiServiceError("OpenAI is not configured. Set OPENAI_API_KEY on the server (see README → Configure OpenAI).");
    }
    this.client = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 2 });
    this.chatModel = opts?.chatModel ?? cfg.chatModel;
    this.embeddingModel = opts?.embeddingModel ?? cfg.embeddingModel;
  }

  async chat(params: LlmChatParams): Promise<LlmChatResult> {
    const messages: ChatCompletionMessageParam[] = params.messages.map((m) => {
      if (m.role === "assistant") {
        return {
          role: "assistant",
          content: m.content,
          ...(m.tool_calls?.length
            ? {
                tool_calls: m.tool_calls.map((tc) => ({
                  id: tc.id,
                  type: "function" as const,
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : {}),
        };
      }
      if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
      return { role: m.role, content: m.content };
    });

    const tools: ChatCompletionTool[] | undefined = params.tools?.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    try {
      const res = await this.client.chat.completions.create({
        model: this.chatModel,
        messages,
        ...(tools?.length ? { tools, tool_choice: "auto" as const, parallel_tool_calls: true } : {}),
        ...(params.jsonSchema
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: { name: params.jsonSchema.name, schema: params.jsonSchema.schema, strict: true },
              },
            }
          : {}),
      });
      const choice = res.choices[0];
      if (!choice) throw new AiServiceError("The AI service returned an empty response.", true);
      const msg = choice.message;
      if (msg.refusal) throw new AiServiceError(`The AI model declined the request: ${msg.refusal}`);
      const toolCalls = (msg.tool_calls ?? [])
        .filter((tc) => tc.type === "function")
        .map((tc) => {
          const fn = (tc as { function: { name: string; arguments: string } }).function;
          return { id: tc.id, name: fn.name, arguments: fn.arguments };
        });
      return { content: msg.content ?? null, toolCalls };
    } catch (e) {
      throw toAiError(e);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    try {
      for (let i = 0; i < texts.length; i += 96) {
        const batch = texts.slice(i, i + 96).map((t) => t.slice(0, 8000));
        const res = await this.client.embeddings.create({
          model: this.embeddingModel,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
        });
        for (const d of [...res.data].sort((a, b) => a.index - b.index)) out.push(d.embedding);
      }
      return out;
    } catch (e) {
      throw toAiError(e);
    }
  }
}

function toAiError(e: unknown): AiServiceError {
  if (e instanceof AiServiceError) return e;
  if (e instanceof OpenAI.APIError) {
    const status = e.status ?? 0;
    if (status === 401) return new AiServiceError("OpenAI rejected the API key (401). Check OPENAI_API_KEY.");
    if (status === 429) return new AiServiceError("OpenAI rate limit or quota exceeded (429). Try again shortly.", true);
    if (status === 404) return new AiServiceError("The configured OpenAI model was not found (404). Check OPENAI_CHAT_MODEL / OPENAI_EMBEDDING_MODEL.");
    if (status >= 500) return new AiServiceError(`OpenAI service error (${status}). Try again shortly.`, true);
    return new AiServiceError(`OpenAI request failed (${status || "network"}): ${e.message.slice(0, 200)}`);
  }
  return new AiServiceError(`AI request failed: ${(e as Error)?.message?.slice(0, 200) ?? "unknown error"}`, true);
}
