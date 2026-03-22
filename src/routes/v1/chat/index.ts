import { Router } from 'express';
import completionsRouter from './completions.js';

const router: Router = Router();

router.use('/completions', completionsRouter);

export default router;
