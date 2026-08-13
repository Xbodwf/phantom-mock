import { ObjectId } from 'mongodb';
import { getDB } from './connection';
import { toEntity, toEntities } from './utils';
import type { NodeGroup } from '../types';

const COLLECTION_NAME = 'nodeGroups';

function now() {
  return Date.now();
}

export async function createNodeGroup(group: Omit<NodeGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<NodeGroup> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    ...group,
    _id: new ObjectId(),
    id: `ng_${now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now(),
    updatedAt: now(),
  };

  await collection.insertOne(doc);
  const { _id, ...rest } = doc;
  return toEntity<NodeGroup>({ ...rest, id: doc.id } as any);
}

export async function getNodeGroupById(id: string): Promise<NodeGroup | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  const doc = await collection.findOne({ id });
  if (!doc) return null;
  return toEntity<NodeGroup>(doc as any);
}

export async function getAllNodeGroups(): Promise<NodeGroup[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  const docs = await collection.find({}).toArray();
  return toEntities<NodeGroup>(docs as any);
}

export async function updateNodeGroupById(id: string, updates: Partial<NodeGroup>): Promise<NodeGroup | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const updated = await collection.findOneAndUpdate(
    { id },
    { $set: { ...updates, updatedAt: now() } },
    { returnDocument: 'after' }
  );

  if (!updated) return null;
  return toEntity<NodeGroup>(updated as any);
}

export async function deleteNodeGroupById(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);
  const result = await collection.deleteOne({ id });
  return result.deletedCount > 0;
}
