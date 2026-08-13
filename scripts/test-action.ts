/**
 * Action API + Workflow 集成测试
 * 直接调用 storage 创建数据，然后走 HTTP 验证 /v1/action/:name 和 workflow 执行。
 * 运行: tsx scripts/test-action.ts
 */
import { initializeDatabase, createAction, loadActions, createWorkflow } from '../src/storage.js';
import { executeAction } from '../src/actions/executor.js';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
}

async function main() {
  await initializeDatabase();

  // 1. 创建带参数的 action
  const action = await createAction({
    name: 'echo-test',
    description: 'Echo action for testing',
    code: `
export async function execute(input: any): Promise<any> {
  const { greeting, count = 1 } = input;
  return { message: greeting + '!'.repeat(count), received: input };
}`,
    createdBy: 'test-user',
    isPublic: true,
    parameters: [
      { name: 'greeting', type: 'string', required: true, description: 'greeting text' },
      { name: 'count', type: 'number', required: false, description: 'repeat count' },
    ],
    returnType: 'object',
  });
  check('action 创建成功', !!action?.id, JSON.stringify(action));
  await loadActions();

  console.log('\n=== executeAction 直接调用（worker 执行）===\n');

  // 2. 正确参数
  try {
    const result = await executeAction(action, { greeting: 'hi', count: 2 }, 10000);
    check('execute 正确参数', result.result.message === 'hi!!', JSON.stringify(result.result));
  } catch (e: any) {
    check('execute 正确参数', false, e.message);
  }

  // 3. 缺必需参数
  try {
    await executeAction(action, { count: 1 }, 10000);
    check('缺必需参数报错', false, '未抛错');
  } catch (e: any) {
    check('缺必需参数报错', /Missing required parameter: greeting/.test(e.message), e.message);
  }

  // 4. 类型错误
  try {
    await executeAction(action, { greeting: 123 }, 10000);
    check('类型错误报错', false, '未抛错');
  } catch (e: any) {
    check('类型错误报错', /must be string/.test(e.message), e.message);
  }

  console.log('\n=== Workflow 执行 ===\n');

  // 5. 创建 workflow：step1 调用 echo-test，step2 引用 step1 输出
  const workflow = await createWorkflow({
    name: 'echo-flow',
    description: 'two-step workflow',
    version: '1.0.0',
    createdBy: 'test-user',
    isPublic: true,
    steps: [
      {
        id: 'step1',
        name: 'echo once',
        uses: action.name,
        with: { greeting: 'hello' },
      },
      {
        id: 'step2',
        name: 'echo twice from step1',
        uses: action.name,
        with: { greeting: '${{ steps.step1.outputs.message }}', count: 2 },
      },
    ],
  });
  check('workflow 创建成功', !!workflow?.id, JSON.stringify(workflow));

  // 手动跑 executor（模拟路由 run 逻辑）
  const { createExecutionContext } = await import('../src/actions/context.js');
  const { createWorkflowExecutor } = await import('../src/actions/executor.js');

  const run = {
    id: `run_${Date.now()}`,
    workflowId: workflow.id,
    userId: 'test-user',
    status: 'pending',
    inputs: {},
    stepRuns: [],
    startedAt: Date.now(),
  };

  const context = createExecutionContext(workflow.id, run.id, 'test-user', {}, {});
  const executor = createWorkflowExecutor(workflow, run as any, context);
  const result = await executor.execute();

  check('workflow 运行成功', result.status === 'success', JSON.stringify(result.stepRuns.map((s: any) => ({ id: s.stepId, status: s.status, err: s.error }))));
  check('step1 执行了 action', result.stepRuns[0]?.outputs?.message === 'hello!', JSON.stringify(result.stepRuns[0]?.outputs));
  check('step2 引用 step1 输出', result.stepRuns[1]?.outputs?.message === 'hello!!', JSON.stringify(result.stepRuns[1]?.outputs));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
