import type { ForwardVariant, Model, ModelTarget } from '../types.js';

export type TargetRequestKind = 'request' | 'stream';

function legacyVariant(model: Model, kind: TargetRequestKind): ForwardVariant {
  if (model.api_type === 'google') {
    return kind === 'stream' ? 'stream-generate-content' : 'generate-content';
  }
  if (model.api_type === 'anthropic') return 'messages';
  return 'chat-completions';
}

function variantMatches(target: ModelTarget, variant: ForwardVariant, kind: TargetRequestKind): boolean {
  if (target.variant === variant) return true;
  if (variant === 'chat-completions') {
    if (kind === 'stream') {
      return ['chat-completions', 'responses', 'messages', 'stream-generate-content'].includes(target.variant);
    }
    return ['chat-completions', 'responses', 'messages', 'generate-content'].includes(target.variant);
  }
  return false;
}

/** Select one upstream variant without exposing provider details to routes. */
export function selectModelTarget(
  model: Model,
  requestedVariant: ForwardVariant,
  kind: TargetRequestKind = 'request'
): ModelTarget {
  const targets = (model.targets || [])
    .filter(target => target.enabled !== false)
    .sort((a, b) => {
      const score = (target: ModelTarget) => {
        if (target.variant === requestedVariant) return 100;
        if (requestedVariant !== 'chat-completions') return 0;
        if (kind === 'stream') {
          return target.variant === 'stream-generate-content' ? 90
            : target.variant === 'responses' ? 80
            : target.variant === 'messages' ? 70
            : target.variant === 'chat-completions' ? 60 : 0;
        }
        return target.variant === 'generate-content' ? 90
          : target.variant === 'responses' ? 80
          : target.variant === 'messages' ? 70
          : target.variant === 'chat-completions' ? 60 : 0;
      };
      return score(b) - score(a) || (a.priority || 0) - (b.priority || 0);
    });

  const exact = targets.find(target => variantMatches(target, requestedVariant, kind));
  if (exact) return exact;

  const legacy = targets.find(target => target.variant === legacyVariant(model, kind));
  if (legacy) return legacy;

  return {
    id: 'legacy-default',
    protocol: model.api_type || 'openai',
    variant: legacyVariant(model, kind),
    model: model.forwardModelName,
    path: model.api_url_path,
    streamPath: model.api_url_path_2,
    providerId: model.providerId,
    nodeId: model.nodeId,
  };
}

export function applyModelTarget(
  model: Model,
  requestedVariant: ForwardVariant,
  kind: TargetRequestKind = 'request'
): Model {
  const target = selectModelTarget(model, requestedVariant, kind);
  return {
    ...model,
    api_type: target.protocol,
    forwardModelName: target.model || model.forwardModelName,
    api_url_path: target.path || model.api_url_path,
    api_url_path_2: target.streamPath || model.api_url_path_2,
    providerId: target.providerId || model.providerId,
    nodeId: target.nodeId || model.nodeId,
    forwardingMode: target.nodeId ? 'node' : target.providerId ? 'provider' : model.forwardingMode,
    defaultHeaders: {
      ...(model.defaultHeaders || {}),
      ...(target.headers || {}),
    },
  };
}
