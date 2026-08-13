import { Worker } from 'worker_threads';
import { compileTypeScript, preprocessActionCode, extractMetadata } from './compiler.js';
import type { Action, Workflow, WorkflowRun, StepRun } from '../types.js';
import { ExecutionContext } from './context.js';
import { getActionByName } from '../storage.js';

const WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

const sandboxGlobals = {
  console: {
    log: (...args) => parentPort.postMessage({ type: 'log', args }),
    error: (...args) => parentPort.postMessage({ type: 'log', args }),
    warn: (...args) => parentPort.postMessage({ type: 'log', args }),
    info: (...args) => parentPort.postMessage({ type: 'log', args }),
  },
  fetch: globalThis.fetch,
  JSON: globalThis.JSON,
  Math: globalThis.Math,
  Date: globalThis.Date,
  Array: globalThis.Array,
  Object: globalThis.Object,
  String: globalThis.String,
  Number: globalThis.Number,
  Boolean: globalThis.Boolean,
  Promise: globalThis.Promise,
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
};

const { compiledCode, input, timeout, baseUrl, usageTracker: ut } = workerData;
const usageTracker = { ...ut };

async function callChatCompletion(params) {
  const url = baseUrl + '/v1/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (usageTracker.userId) headers['x-internal-user-id'] = usageTracker.userId;
  if (usageTracker.apiKeyId) headers['x-internal-api-key-id'] = usageTracker.apiKeyId;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Chat completion failed');
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

const sandbox = Object.assign({}, sandboxGlobals, {
  callChatCompletion,
  __usageTracker: usageTracker,
  __getUsageTracker: () => usageTracker,
  module: { exports: {} },
  exports: {},
});

const context = vm.createContext(sandbox);

// Wrap compiled code to receive module & exports, inject callChatCompletion from sandbox scope
const wrapperSrc =
  '(function(module, exports) { var __usageTracker = ' + JSON.stringify(usageTracker) + '; ' +
  'var __baseUrl = ' + JSON.stringify(baseUrl) + '; ' +
  'async function callChatCompletion(params) { var u = __baseUrl + "/v1/chat/completions"; ' +
  'var h = {"Content-Type":"application/json"}; ' +
  'if(__usageTracker.userId) h["x-internal-user-id"] = __usageTracker.userId; ' +
  'if(__usageTracker.apiKeyId) h["x-internal-api-key-id"] = __usageTracker.apiKeyId; ' +
  'var r = await fetch(u,{method:"POST",headers:h,body:JSON.stringify(params)}); ' +
  'if(!r.ok){var e=await r.json();throw new Error((e.error&&e.error.message)||"Chat completion failed")} ' +
  'var d = await r.json(); return (d.choices&&d.choices[0]&&d.choices[0].message) ? d.choices[0].message.content : ""; } ' +
  compiledCode + ' })';

try {
  const script = new vm.Script(wrapperSrc, { timeout });
  const factory = script.runInContext(context, { timeout });

  if (typeof factory !== 'function') {
    throw new Error('Action code did not produce a valid module factory');
  }

  factory(sandbox.module, sandbox.module.exports);

  if (typeof sandbox.module.exports.execute !== 'function') {
    throw new Error('Action code must export an "execute" function');
  }

  const normalizedInput = typeof input === 'object' ? input : { text: input };
  const result = await sandbox.module.exports.execute(normalizedInput);

  parentPort.postMessage({
    type: 'result',
    result,
    usage: {
      promptTokens: usageTracker.promptTokens || 0,
      completionTokens: usageTracker.completionTokens || 0,
    },
  });
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}
`;

/**
 * 验证输入参数是否符合 Action 定义
 */
function validateInputs(input: Record<string, any>, parameters?: any[]): void {
  if (!parameters) return;

  for (const param of parameters) {
    if (param.required && !(param.name in input)) {
      throw new Error(`Missing required parameter: ${param.name}`);
    }

    if (param.name in input) {
      const value = input[param.name];
      const expectedType = param.type;

      if (expectedType && typeof value !== expectedType) {
        throw new Error(
          `Parameter '${param.name}' must be ${expectedType}, got ${typeof value}`
        );
      }
    }
  }
}

/**
 * 验证输出是否符合 Action 定义
 */
function validateOutputs(output: any, returnType?: string): void {
  if (!returnType) return;

  if (returnType === 'string' && typeof output !== 'string') {
    throw new Error(`Output must be string, got ${typeof output}`);
  } else if (returnType === 'object' && typeof output !== 'object') {
    throw new Error(`Output must be object, got ${typeof output}`);
  }
}

/**
 * 执行 Action 代码（使用 worker_threads + Node.js vm 隔离）
 */
export async function executeAction(
  action: Action,
  input: Record<string, any>,
  timeout: number = 30000,
  userId?: string,
  apiKeyId?: string,
  memoryLimitMB: number = 128
): Promise<{ result: Record<string, any>; usage?: { promptTokens: number; completionTokens: number } }> {
  try {
    const processedCode = preprocessActionCode(action.code);
    const compiledCode = compileTypeScript(processedCode);

    validateInputs(input, action.parameters);

    const port = process.env.PORT || 7143;
    const serverHost = process.env.SERVER_HOST || 'localhost';
    const baseUrl = `http://${serverHost}:${port}`;

    const result = await new Promise<{ result: any; usage: { promptTokens: number; completionTokens: number } }>((resolve, reject) => {
      const worker = new Worker(WORKER_CODE, {
        eval: true,
        workerData: {
          compiledCode,
          input,
          timeout,
          baseUrl,
          usageTracker: {
            promptTokens: 0,
            completionTokens: 0,
            userId,
            apiKeyId,
          },
        },
        resourceLimits: {
          maxOldGenerationSizeMb: memoryLimitMB,
        },
      });

      const timeoutHandle = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Action execution timed out after ${timeout}ms`));
      }, timeout + 5000);

      worker.on('message', (msg) => {
        if (msg.type === 'result') {
          clearTimeout(timeoutHandle);
          resolve({ result: msg.result, usage: msg.usage });
        } else if (msg.type === 'error') {
          clearTimeout(timeoutHandle);
          reject(new Error(msg.message));
        } else if (msg.type === 'log') {
          console.log('[Action Worker]', ...msg.args);
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(new Error(`Worker error: ${err.message}`));
      });

      worker.on('exit', (code) => {
        clearTimeout(timeoutHandle);
        if (code !== 0 && !timeoutHandle) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });
    });

    validateOutputs(result.result, action.returnType);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Action execution failed: ${errorMessage}`);
  }
}

/**
 * 获取 Action 的元数据
 */
export function getActionMetadata(action: Action): any {
  try {
    const processedCode = preprocessActionCode(action.code);
    const compiledCode = compileTypeScript(processedCode);
    const metadata = extractMetadata(compiledCode);

    if (!metadata) {
      console.log('[getActionMetadata] No metadata found in action code');
    } else {
      console.log('[getActionMetadata] Extracted metadata:', Object.keys(metadata));
    }

    return metadata;
  } catch (error) {
    console.error('[getActionMetadata] Error extracting metadata:', error);
    return null;
  }
}

/**
 * 验证 Action 代码是否有效
 */
export function validateActionCode(code: string): { valid: boolean; error?: string } {
  try {
    preprocessActionCode(code);
    compileTypeScript(code);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 工作流执行引擎
 */
export class WorkflowExecutor {
  private context: ExecutionContext;
  private workflow: Workflow;
  private workflowRun: WorkflowRun;

  constructor(
    workflow: Workflow,
    workflowRun: WorkflowRun,
    context: ExecutionContext
  ) {
    this.workflow = workflow;
    this.workflowRun = workflowRun;
    this.context = context;
  }

  async execute(): Promise<WorkflowRun> {
    this.workflowRun.status = 'running';
    this.workflowRun.startedAt = Date.now();

    try {
      for (const step of this.workflow.steps) {
        if (step.if) {
          const condition = this.context.evaluateExpression(step.if);
          if (!condition) {
            this.context.addLog(`Skipping step ${step.id} due to condition`, 'info');
            continue;
          }
        }

        const stepRun = await this.executeStep(step);
        this.workflowRun.stepRuns.push(stepRun);

        if (stepRun.status === 'failure' && !step.continueOnError) {
          this.workflowRun.status = 'failure';
          this.workflowRun.error = {
            message: `Step ${step.id} failed`,
            stepId: step.id,
          };
          break;
        }
      }

      if (this.workflow.outputs) {
        this.workflowRun.outputs = {};
        for (const [key, output] of Object.entries(this.workflow.outputs)) {
          const value = this.context.evaluateExpression(output.value);
          this.workflowRun.outputs[key] = value;
        }
      }

      if (this.workflowRun.status !== 'failure') {
        this.workflowRun.status = 'success';
      }
    } catch (error) {
      this.workflowRun.status = 'failure';
      this.workflowRun.error = {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'EXECUTION_ERROR',
      };
      this.context.addLog(`Workflow execution failed: ${error}`, 'error');
    }

    this.workflowRun.completedAt = Date.now();
    this.workflowRun.duration = this.workflowRun.completedAt - this.workflowRun.startedAt;
    this.workflowRun.logs = this.context.getLogs();

    return this.workflowRun;
  }

  private async executeStep(step: any): Promise<StepRun> {
    const stepRun: StepRun = {
      id: `${this.workflowRun.id}-${step.id}`,
      stepId: step.id,
      status: 'pending',
      startedAt: Date.now(),
      inputs: step.with,
    };

    try {
      this.context.addLog(`Starting step: ${step.name}`, 'info');
      stepRun.status = 'running';

      const inputs = this.context.replaceExpressions(step.with || {});
      stepRun.inputs = inputs;

      // 解析 action 名（支持 'phantom/call-model@v1' -> 'phantom/call-model'）
      const actionName = (step.uses || '').replace(/@.*$/, '');
      const action = getActionByName(actionName);

      let outputs: Record<string, any>;
      if (!action) {
        throw new Error(`Step '${step.id}': action '${actionName}' not found`);
      }

      // 执行 action（每个 step 独立 worker，超时默认 30s，可被 step.timeout 覆盖）
      const timeoutMs = step.timeout ? step.timeout * 1000 : 30000;
      const executionResult = await executeAction(
        action,
        inputs,
        timeoutMs,
        this.workflowRun.userId,
        undefined,
      );
      outputs = typeof executionResult.result === 'object'
        ? executionResult.result as Record<string, any>
        : { result: executionResult.result };
      // 附加 usage，供后续步骤或 outputs 引用
      if (executionResult.usage) {
        outputs = { ...outputs, usage: executionResult.usage };
      }

      this.context.setStepOutput(step.id, outputs);
      stepRun.outputs = outputs;
      stepRun.status = 'success';

      this.context.addLog(`Step ${step.id} completed successfully`, 'info');
    } catch (error) {
      stepRun.status = 'failure';
      stepRun.error = {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'STEP_EXECUTION_ERROR',
      };
      this.context.addLog(`Step ${step.id} failed: ${error}`, 'error');
    }

    stepRun.completedAt = Date.now();
    stepRun.duration = stepRun.completedAt - stepRun.startedAt;

    return stepRun;
  }
}

export function createWorkflowExecutor(
  workflow: Workflow,
  workflowRun: WorkflowRun,
  context: ExecutionContext
): WorkflowExecutor {
  return new WorkflowExecutor(workflow, workflowRun, context);
}

export async function executeActionChain(
  actionIds: string[],
  context: any,
  initialInput?: any
): Promise<{ success: boolean; output?: any; error?: string; executionTime: number }> {
  const startTime = Date.now();
  return {
    success: true,
    output: initialInput,
    executionTime: Date.now() - startTime,
  };
}
