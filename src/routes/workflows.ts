import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, AuthRequest } from '../middleware.js';
import {
  getAllWorkflows,
  getWorkflowById,
  getWorkflowsByCreator,
  getPublicWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  createWorkflowRun,
  updateWorkflowRun,
} from '../storage.js';
import type { Workflow, WorkflowRun } from '../types.js';
import { createExecutionContext } from '../actions/context.js';
import { createWorkflowExecutor } from '../actions/executor.js';

const router: Router = Router();

/**
 * 获取所有工作流（包括公开的和用户自己的）
 */
router.get('/workflows', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const publicWorkflows = getPublicWorkflows();
    const userWorkflows = getWorkflowsByCreator(req.userId!);
    const allWorkflows = [...publicWorkflows, ...userWorkflows];

    // 去重
    const uniqueWorkflows = Array.from(
      new Map(allWorkflows.map(w => [w.id, w])).values()
    );

    res.json(uniqueWorkflows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get workflows' });
  }
});

/**
 * 获取单个工作流
 */
router.get('/workflows/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // 检查权限
    if (!workflow.isPublic && workflow.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(workflow);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get workflow' });
  }
});

/**
 * 创建工作流
 */
router.post('/workflows', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, version, steps, inputs, outputs, isPublic, tags } = req.body;

    if (!name || !steps) {
      return res.status(400).json({ error: 'Name and steps are required' });
    }

    const workflow: Workflow = {
      id: uuidv4(),
      name,
      description,
      version: version || '1.0.0',
      steps,
      inputs,
      outputs,
      createdBy: req.userId!,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPublic: isPublic || false,
      tags,
    };

    const created = await createWorkflow(workflow);
    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

/**
 * 更新工作流
 */
router.put('/workflows/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // 检查权限
    if (workflow.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, description, version, steps, inputs, outputs, isPublic, tags } = req.body;
    const updated = await updateWorkflow(id, {
      name,
      description,
      version,
      steps,
      inputs,
      outputs,
      isPublic,
      tags,
      updatedAt: Date.now(),
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update workflow' });
  }
});

/**
 * 删除工作流
 */
router.delete('/workflows/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // 检查权限
    if (workflow.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await deleteWorkflow(id);
    res.json({ message: 'Workflow deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

/**
 * 运行工作流
 */
router.post('/workflows/:id/run', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const workflow = getWorkflowById(id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    // 检查权限
    if (!workflow.isPublic && workflow.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { inputs = {} } = req.body;

    // 创建工作流运行记录
    const workflowRun: WorkflowRun = {
      id: uuidv4(),
      workflowId: id,
      userId: req.userId!,
      status: 'pending',
      inputs,
      stepRuns: [],
      startedAt: Date.now(),
    };

    // 保存运行记录
    await createWorkflowRun(workflowRun);

    // 创建执行上下文
    const context = createExecutionContext(
      id,
      workflowRun.id,
      req.userId!,
      inputs,
      workflow.env || {}
    );

    // 创建执行器
    const executor = createWorkflowExecutor(workflow, workflowRun, context);

    // 异步执行工作流，完成后保存结果
    executor.execute().then(async (result) => {
      await updateWorkflowRun(result.id, {
        status: result.status,
        stepRuns: result.stepRuns,
        outputs: result.outputs,
        logs: result.logs,
        error: result.error,
        completedAt: result.completedAt,
      });
      console.log('Workflow execution completed:', result.id, result.status);
    }).catch(async (error) => {
      console.error('Workflow execution error:', error);
      await updateWorkflowRun(workflowRun.id, {
        status: 'failure',
        error: { message: error instanceof Error ? error.message : 'Unknown error', code: 'EXECUTION_ERROR' },
      });
    });

    // 立即返回运行 ID
    res.status(202).json({
      runId: workflowRun.id,
      status: 'pending',
      message: 'Workflow execution started',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run workflow' });
  }
});

export default router;
