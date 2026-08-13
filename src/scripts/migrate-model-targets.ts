import { connectDB, disconnectDB } from '../db/connection.js';

function inferVariant(model: any): string {
  if (model.type === 'embedding') return 'embeddings';
  if (model.type === 'image') {
    return model.api_url_path?.includes('/edits') ? 'image-edits' : 'image-generations';
  }
  if (model.api_type === 'google') {
    return model.api_url_path?.includes('streamGenerateContent')
      ? 'stream-generate-content'
      : 'generate-content';
  }
  if (model.api_type === 'anthropic') return 'messages';
  if (model.api_url_path?.includes('/responses')) return 'responses';
  if (model.api_url_path?.includes('/embeddings')) return 'embeddings';
  if (model.api_url_path?.includes('/rerank')) return 'rerank';
  return 'chat-completions';
}

async function migrateModelTargets() {
  const db = await connectDB();
  const collection = db.collection('models');
  const models = await collection.find({ targets: { $exists: false } }).toArray();
  const now = new Date();

  for (const model of models) {
    const target = {
      id: 'legacy-default',
      protocol: model.api_type || 'openai',
      variant: inferVariant(model),
      model: model.forwardModelName || model.id,
      path: model.api_url_path || undefined,
      streamPath: model.api_url_path_2 || undefined,
      providerId: model.providerId || undefined,
      nodeId: model.nodeId || undefined,
      enabled: true,
      priority: 0,
    };

    await collection.updateOne(
      { _id: model._id, targets: { $exists: false } },
      { $set: { targets: [target], updatedAt: now } },
    );
  }

  console.log(`Migrated ${models.length} models to targets[]`);
  await disconnectDB();
}

migrateModelTargets().catch(async error => {
  console.error('Model target migration failed:', error);
  await disconnectDB();
  process.exitCode = 1;
});
