import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware.js';
import { getAllWorkflowRuns, getWorkflowRunById } from '../storage.js';

const router: Router = Router();

/**
 * 获取工作流运行历史
 */
router.get('/workflow-runs', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const workflowId = req.query.workflowId as string | undefined;
    const runs = getAllWorkflowRuns(req.userId!, workflowId);
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get workflow runs' });
  }
});

/**
 * 获取单个工作流运行详情
 */
router.get('/workflow-runs/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const run = getWorkflowRunById(id);
    if (!run || run.userId !== req.userId) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get workflow run' });
  }
});

/**
 * 取消工作流运行
 */
router.post('/workflow-runs/:id/cancel', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const run = getWorkflowRunById(id);
    if (!run || run.userId !== req.userId) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
    if (run.status === 'success' || run.status === 'failure') {
      return res.json({ message: 'Workflow already finished', status: run.status });
    }
    const { updateWorkflowRun } = await import('../storage.js');
    await updateWorkflowRun(id, { status: 'cancelled' });
    res.json({ message: 'Workflow run cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel workflow run' });
  }
});

export default router;
