import { getDB } from './connection';

export async function initializeIndexes(): Promise<void> {
  const db = getDB();

  // 创建索引的辅助函数，忽略已存在的索引错误
  const createIndexSafe = async (collection: string, index: Record<string, number>, options?: Record<string, unknown>) => {
    try {
      await db.collection(collection).createIndex(index, options);
    } catch (error: any) {
      // 忽略索引已存在的错误
      if (error.code === 85 || error.code === 86 || error.message?.includes('existing index')) {
        console.log(`Index already exists on ${collection}, skipping...`);
      } else {
        console.error(`Failed to create index on ${collection}:`, error.message);
      }
    }
  };

  // Users indexes
  await createIndexSafe('users', { username: 1 }, { unique: true });
  await createIndexSafe('users', { email: 1 }, { unique: true });
  await createIndexSafe('users', { uid: 1 }, { sparse: true, unique: true });
  await createIndexSafe('users', { inviteCode: 1 }, { sparse: true, unique: true });
  await createIndexSafe('users', { permissionLevel: 1 });

  // ApiKeys indexes
  await createIndexSafe('apiKeys', { key: 1 }, { unique: true });
  await createIndexSafe('apiKeys', { userId: 1 });

  // Models indexes
  await createIndexSafe('models', { id: 1 }, { unique: true });
  await createIndexSafe('models', { owned_by: 1 });
  await createIndexSafe('models', { category: 1 });
  await createIndexSafe('models', { ownerId: 1 });
  await createIndexSafe('models', { isPublic: 1 });
  await createIndexSafe('models', { tags: 1 });

  // UsageRecords indexes
  await createIndexSafe('usageRecords', { userId: 1 });
  await createIndexSafe('usageRecords', { apiKeyId: 1 });
  await createIndexSafe('usageRecords', { timestamp: 1 });
  await createIndexSafe('usageRecords', { userId: 1, timestamp: -1 });
  await createIndexSafe('usageRecords', { modelId: 1 });

  // Invoices indexes
  await createIndexSafe('invoices', { userId: 1 });
  await createIndexSafe('invoices', { period: 1 });
  await createIndexSafe('invoices', { userId: 1, period: 1 }, { unique: true });
  await createIndexSafe('invoices', { status: 1 });

  // Actions indexes
  await createIndexSafe('actions', { createdBy: 1 });
  await createIndexSafe('actions', { isPublic: 1 });
  await createIndexSafe('actions', { tags: 1 });
  await createIndexSafe('actions', { createdBy: 1, name: 1 }, { unique: true, partialFilterExpression: { createdBy: { $exists: true } } });

  // InvitationRecords indexes
  await createIndexSafe('invitationRecords', { inviterId: 1 });
  await createIndexSafe('invitationRecords', { inviteeId: 1 });
  await createIndexSafe('invitationRecords', { inviteCode: 1 });

  // Notifications indexes
  await createIndexSafe('notifications', { isActive: 1 });
  await createIndexSafe('notifications', { isPinned: 1 });

  console.log('Database indexes initialized successfully');
}
