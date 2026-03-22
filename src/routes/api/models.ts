import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getModel, getAllModels, addModel as storageAddModel, updateModel as storageUpdateModel, deleteModel as storageDeleteModel } from '../../storage.js';
import { broadcastModelsUpdate } from '../../websocket.js';
import { adminMiddleware } from '../../middleware.js';

const router: RouterType = Router();

// GET /api/models - 获取模型列表（仅返回真实模型，不包括 Actions）
router.get('/', (req: Request, res: Response) => {
  const models = getAllModels();

  res.json({
    models: models,
    data: models // 兼容两种格式
  });
});

// POST /api/models - 添加模型
router.post('/', adminMiddleware, async (req: Request, res: Response) => {
  const { id, owned_by, description, context_length, aliases, max_output_tokens, pricing, api_key, api_base_url, api_type, supported_features, require_api_key, icon, type } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Model ID is required' });
  }

  if (!type) {
    return res.status(400).json({ error: 'Model type is required' });
  }

  if (getModel(id)) {
    return res.status(400).json({ error: 'Model already exists' });
  }

  try {
    const newModel = await storageAddModel({
      id,
      owned_by: owned_by || 'custom',
      description: description || '',
      context_length: context_length || 4096,
      aliases,
      max_output_tokens,
      pricing,
      api_key,
      api_base_url,
      api_type,
      supported_features,
      require_api_key: require_api_key ?? true, // 默认需要 API Key
      icon,
      type,
    });
    broadcastModelsUpdate(getAllModels());
    res.json({ success: true, model: newModel });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add model' });
  }
});

// PUT /api/models/:id(*) - 更新模型（支持模型ID包含"/"）
router.put('/:id(*)', adminMiddleware, async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id as string);
  const { 
    newId, owned_by, description, context_length, aliases, max_output_tokens, 
    pricing, api_key, api_base_url, api_type, forwardModelName, supported_features, 
    require_api_key, icon, allowManualReply,
    rpm, tpm, maxConcurrentRequests, concurrentQueues, allowOveruse
  } = req.body;

  try {
    // 如果要修改ID，先检查新ID是否已存在
    if (newId && newId !== id) {
      if (getModel(newId)) {
        return res.status(400).json({ error: 'Model with new ID already exists' });
      }
    }

    const updated = await storageUpdateModel(id, {
      ...(newId && newId !== id ? { id: newId } : {}), // 只在需要修改ID时才传递
      owned_by,
      description,
      context_length,
      aliases,
      max_output_tokens,
      pricing,
      api_key,
      api_base_url,
      api_type,
      forwardModelName,
      supported_features,
      require_api_key,
      icon,
      allowManualReply,
      rpm,
      tpm,
      maxConcurrentRequests,
      concurrentQueues,
      allowOveruse,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Model not found' });
    }

    broadcastModelsUpdate(getAllModels());
    res.json({ success: true, model: updated });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update model' });
  }
});

// DELETE /api/models/:id(*) - 删除模型（支持模型ID包含"/"）
router.delete('/:id(*)', adminMiddleware, async (req: Request, res: Response) => {
  const id = decodeURIComponent(req.params.id as string);

  try {
    const deleted = await storageDeleteModel(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Model not found' });
    }
    broadcastModelsUpdate(getAllModels());
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

export default router;
