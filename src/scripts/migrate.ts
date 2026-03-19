import { connectDB, disconnectDB, initializeIndexes } from '../db';
import * as fs from 'fs';
import * as path from 'path';
import { ObjectId } from 'mongodb';

interface DataFile {
  name: string;
  collection: string;
  transform?: (item: any) => any;
}

const dataFiles: DataFile[] = [
  {
    name: 'users.json',
    collection: 'users',
    transform: (item) => ({
      ...item,
      _id: new ObjectId(),
      createdAt: new Date(item.createdAt),
      lastLoginAt: item.lastLoginAt ? new Date(item.lastLoginAt) : undefined,
    }),
  },
  {
    name: 'api_keys.json',
    collection: 'apiKeys',
    transform: (item) => ({
      ...item,
      _id: new ObjectId(),
      createdAt: new Date(item.createdAt),
      lastUsedAt: item.lastUsedAt ? new Date(item.lastUsedAt) : undefined,
      expiresAt: item.expiresAt ? new Date(item.expiresAt) : undefined,
    }),
  },
  {
    name: 'usage_records.json',
    collection: 'usageRecords',
    transform: (item) => ({
      ...item,
      _id: new ObjectId(),
      timestamp: new Date(item.timestamp),
    }),
  },
  {
    name: 'invoices.json',
    collection: 'invoices',
    transform: (item) => ({
      ...item,
      _id: new ObjectId(),
      createdAt: new Date(item.createdAt),
      dueDate: new Date(item.dueDate),
    }),
  },
  {
    name: 'actions.json',
    collection: 'actions',
    transform: (item) => ({
      ...item,
      _id: new ObjectId(),
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt || item.createdAt),
    }),
  },
  {
    name: 'notifications.json',
    collection: 'notifications',
    transform: (item) => ({
      ...item,
      _id: new ObjectId(),
      createdAt: new Date(item.createdAt),
      updatedAt: item.updatedAt ? new Date(item.updatedAt) : undefined,
    }),
  },
  {
    name: 'invitations.json',
    collection: 'invitationRecords',
    transform: (item) => ({
      ...item,
      _id: new ObjectId(),
      createdAt: new Date(item.createdAt),
    }),
  },
];

// 迁移模型数据（从 config.json 中提取）
async function migrateModels(db: any) {
  const configPath = path.join(process.cwd(), 'data', 'config.json');
  
  if (!fs.existsSync(configPath)) {
    console.log('⚠️  config.json not found, skipping models migration...');
    return;
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);
    
    if (!config.models || !Array.isArray(config.models) || config.models.length === 0) {
      console.log('⏭️  No models found in config.json, skipping...');
      return;
    }

    // 转换模型数据
    const modelsData = config.models.map((model: any, index: number) => ({
      id: model.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000) + index,
      owned_by: model.owned_by || 'custom',
      description: model.description || '',
      context_length: model.context_length || 4096,
      aliases: model.aliases || [],
      max_output_tokens: model.max_output_tokens,
      pricing: model.pricing || undefined,
      api_key: model.api_key,
      api_base_url: model.api_base_url,
      api_type: model.api_type,
      supported_features: model.supported_features,
      require_api_key: model.require_api_key ?? true,
      icon: model.icon,
      // 新增字段
      rpm: model.rpm || 0,
      tpm: model.tpm || 0,
      maxConcurrentRequests: model.maxConcurrentRequests || 100,
      concurrentQueues: model.concurrentQueues || 10,
      allowOveruse: model.allowOveruse || 0,
      tags: model.tags || [],
      category: model.category || 'chat',
      // MongoDB 元数据
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const collection = db.collection('models');
    const result = await collection.insertMany(modelsData);

    console.log(`✅ Models migrated from config.json`);
    console.log(`   Inserted ${result.insertedCount} models into models collection\n`);
  } catch (error: any) {
    console.error(`❌ Error migrating models:`, error.message);
  }
}

async function migrateData() {
  try {
    console.log('🚀 Starting data migration to MongoDB...\n');

    // Connect to MongoDB
    const db = await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Initialize indexes
    await initializeIndexes();
    console.log('✅ Database indexes initialized\n');

    // 迁移模型数据（从 config.json）
    await migrateModels(db);

    // Migrate each data file
    for (const dataFile of dataFiles) {
      const filePath = path.join(process.cwd(), 'data', dataFile.name);

      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${dataFile.name}, skipping...`);
        continue;
      }

      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent);

        if (!Array.isArray(data)) {
          console.log(`⚠️  ${dataFile.name} is not an array, skipping...`);
          continue;
        }

        if (data.length === 0) {
          console.log(`⏭️  ${dataFile.name} is empty, skipping...`);
          continue;
        }

        // Transform data
        const transformedData = data.map(item => {
          const transformed = dataFile.transform ? dataFile.transform(item) : item;
          // Remove the old id field if it exists and we're using _id
          // 但保留 users 和 models 的 id 字段，因为它们是业务标识符
          if (transformed._id && transformed.id && typeof transformed.id === 'string') {
            // 检查是否是 UUID 格式的 id，如果是则删除
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transformed.id);
            const isModelId = dataFile.collection === 'models' || dataFile.collection === 'users';
            if (!isUUID && !isModelId) {
              delete transformed.id;
            }
          }
          return transformed;
        });

        // Insert into MongoDB
        const collection = db.collection(dataFile.collection);
        const result = await collection.insertMany(transformedData);

        console.log(`✅ ${dataFile.name}`);
        console.log(`   Inserted ${result.insertedCount} documents into ${dataFile.collection}\n`);
      } catch (error: any) {
        console.error(`❌ Error migrating ${dataFile.name}:`, error.message);
      }
    }

    console.log('🎉 Data migration completed!');
    await disconnectDB();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateData();
