/**
 * OpenAI-compatible API routes
 *
 * This module re-exports the v1 routes for use with provider-specific aliases:
 * - /deepseek/v1
 * - /moonshot/v1
 * - /zhipu/v1
 * - /qwen/v1
 * - /tongyi/v1
 * - /wenxin/v1
 * - /doubao/v1
 * - /minimax/v1
 * - /siliconflow/v1
 * - /groq/v1
 * - /together/v1
 * - /openrouter/v1
 *
 * All actual implementation has been moved to /src/routes/v1/
 * See openai.ts.backup for the original implementation.
 */

import v1Routes from './v1/index.js';

export default v1Routes;
