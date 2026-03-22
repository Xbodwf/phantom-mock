import { Router } from 'express';
import modelsRouter from './models.js';
import completionsRouter from './completions.js';

const router: Router = Router();

router.use('/models', modelsRouter);
router.use('/completions', completionsRouter);

export default router;
