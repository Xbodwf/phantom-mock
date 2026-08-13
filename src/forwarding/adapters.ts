import type {
  ChatCompletionRequest,
  ForwardProtocol,
  ForwardVariant,
  Model,
  UnifiedRequest,
  UnifiedResponse,
  UnifiedStreamEvent,
} from '../types.js';
import type { Response } from 'express';

export interface ProtocolAdapterContext {
  protocol: ForwardProtocol;
  variant: ForwardVariant;
  model: string;
  stream: boolean;
}

/** Protocol adapters translate at the boundary; transports remain elsewhere. */
export interface ProtocolAdapter {
  protocol: ForwardProtocol;
  variants: readonly ForwardVariant[];
  toRequest?(request: UnifiedRequest, context: ProtocolAdapterContext): unknown;
  fromResponse?(response: unknown, context: ProtocolAdapterContext): UnifiedResponse;
  fromStreamEvent?(event: unknown, context: ProtocolAdapterContext): UnifiedStreamEvent[];
  forwardChat?: (model: Model, body: ChatCompletionRequest, variant?: ForwardVariant) => Promise<{ success: true; response: any } | { success: false; error: string }>;
  forwardStream?: (model: Model, body: ChatCompletionRequest, res: Response, onStreamData?: (info: { content: string; reasoningContent?: string | null }) => void) => Promise<void>;
}

const adapters = new Map<ForwardProtocol, ProtocolAdapter>();

export function registerProtocolAdapter(adapter: ProtocolAdapter): void {
  adapters.set(adapter.protocol, adapter);
}

export function getProtocolAdapter(protocol: ForwardProtocol): ProtocolAdapter {
  const adapter = adapters.get(protocol);
  if (!adapter) throw new Error(`No protocol adapter registered for ${protocol}`);
  return adapter;
}

export function getProtocolAdapterOrOpenAI(protocol: ForwardProtocol): ProtocolAdapter {
  return adapters.get(protocol) || adapters.get('openai')!;
}

export function listProtocolAdapters(): ProtocolAdapter[] {
  return [...adapters.values()];
}
