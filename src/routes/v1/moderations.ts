import { Router, Request, Response } from 'express';
import { generateRequestId } from '../../responseBuilder.js';

const router: Router = Router();

/**
 * POST /v1/moderations - 内容审核
 */
router.post('/', (req: Request, res: Response) => {
  res.json({
    id: `modr-${generateRequestId()}`,
    model: 'text-moderation-latest',
    results: [{
      flagged: false,
      categories: {},
      category_scores: {},
    }]
  });
});

export default router;
