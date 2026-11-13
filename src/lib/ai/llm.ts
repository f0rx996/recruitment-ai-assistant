/**
 * Provider-neutral LLM interface used by CV processing and the HR assistant.
 * The production implementation is OpenAI (see ./openai.ts). Tests inject
 * scripted implementations — those are clearly labelled as mocks.
 */

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmChatParams {
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  /** Strict JSON schema output. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  purpose?: string;
}

export interface LlmChatResult {
  content: string | null;
  toolCalls: LlmToolCall[];
}

export interface LlmClient {
  chat(params: LlmChatParams): Promise<LlmChatResult>;
  embed(texts: string[]): Promise<number[][]>;
}

export class AiServiceError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AiServiceError";
  }
}
