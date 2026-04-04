import { ObjectId } from 'mongodb';
import { getDB } from './connection';
import { toEntity, toEntities } from './utils';
import type { Provider, ProviderApiKey } from '../types';

const COLLECTION_NAME = 'providers';

function now() {
 return Date.now();
}

export async function createProvider(provider: Omit<Provider, 'createdAt' | 'updatedAt' | 'rrCursor'>): Promise<Provider> {
 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);

 const doc = {
 ...provider,
 rrCursor:0,
 _id: new ObjectId(),
 createdAt: now(),
 updatedAt: now(),
 };

 await collection.insertOne(doc);
 return toEntity<Provider>(doc);
}

export async function getProviderById(id: string): Promise<Provider | null> {
 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);
 const doc = await collection.findOne({ id });
 if (!doc) return null;
 return toEntity<Provider>(doc as any);
}

export async function getProviderBySlug(slug: string): Promise<Provider | null> {
 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);
 const doc = await collection.findOne({ slug });
 if (!doc) return null;
 return toEntity<Provider>(doc as any);
}

export async function getAllProviders(): Promise<Provider[]> {
 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);
 const docs = await collection.find({}).toArray();
 return toEntities<Provider>(docs as any);
}

export async function updateProviderById(id: string, updates: Partial<Provider>): Promise<Provider | null> {
 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);

 const updated = await collection.findOneAndUpdate(
 { id },
 { $set: { ...updates, updatedAt: now() } },
 { returnDocument: 'after' }
 );

 if (!updated) return null;
 return toEntity<Provider>(updated as any);
}

export async function deleteProviderById(id: string): Promise<boolean> {
 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);
 const result = await collection.deleteOne({ id });
 return result.deletedCount >0;
}

export async function addProviderKey(providerId: string, key: ProviderApiKey): Promise<Provider | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const updated = await collection.findOneAndUpdate(
    { id: providerId },
    { $push: { keys: key as any }, $set: { updatedAt: now() } },
    { returnDocument: 'after' }
  );

  if (!updated) return null;
  return toEntity<Provider>(updated as any);
}
export async function updateProviderKey(providerId: string, keyId: string, updates: Partial<ProviderApiKey>): Promise<Provider | null> {
 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);

 const setUpdates: Record<string, any> = { updatedAt: now() };
 Object.entries(updates).forEach(([k, v]) => {
 setUpdates[`keys.$.${k}`] = v;
 });

 const updated = await collection.findOneAndUpdate(
 { id: providerId, 'keys.id': keyId },
 { $set: setUpdates },
 { returnDocument: 'after' }
 );

 if (!updated) return null;
 return toEntity<Provider>(updated as any);
}

export async function deleteProviderKey(providerId: string, keyId: string): Promise<Provider | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const updated = await collection.findOneAndUpdate(
    { id: providerId },
    { $pull: { keys: { id: keyId } as any }, $set: { updatedAt: now() } },
    { returnDocument: 'after' }
  );

  if (!updated) return null;
  return toEntity<Provider>(updated as any);
}
export async function selectRoundRobinProviderKey(providerId: string): Promise<{ provider: Provider; key: ProviderApiKey } | null> {
 const provider = await getProviderById(providerId);
 if (!provider || !provider.enabled) return null;

 const enabledKeys = (provider.keys || []).filter(k => k.enabled);
 if (enabledKeys.length ===0) return null;

 const cursor = provider.rrCursor ||0;
 const index = cursor % enabledKeys.length;
 const selected = enabledKeys[index];

 const db = getDB();
 const collection = db.collection(COLLECTION_NAME);

 await collection.updateOne(
 { id: providerId },
 {
 $set: {
 rrCursor: (cursor +1) % enabledKeys.length,
 updatedAt: now(),
 'keys.$[key].lastUsedAt': now(),
 },
 },
 { arrayFilters: [{ 'key.id': selected.id }] }
 );

 const latest = await getProviderById(providerId);
 if (!latest) return null;

 return { provider: latest, key: selected };
}
