import { toEntity, toEntities } from './utils';
import { getDB } from './connection';
import { Notification } from '../types';
import { ObjectId } from 'mongodb';

const COLLECTION_NAME = 'notifications';

export async function createNotification(notification: Omit<Notification, 'id' | 'createdAt'> & { _id?: ObjectId }): Promise<Notification> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    ...notification,
    _id: notification._id || new ObjectId(),
    createdAt: Date.now(),
  };

  await collection.insertOne(doc);
  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as Notification;
}

export async function getNotification(id: string): Promise<Notification | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ _id: new ObjectId(id) });
  if (!doc) return null;

  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as Notification;
}

export async function getAllNotifications(): Promise<Notification[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as Notification[];
}

export async function getActiveNotifications(): Promise<Notification[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection
    .find({ isActive: true })
    .sort({ isPinned: -1, createdAt: -1 })
    .toArray();

  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as Notification[];
}

export async function updateNotification(id: string, updates: Partial<Notification>): Promise<Notification | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        ...updates,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!result || !result.value) return null;

  const doc = result.value as any;
  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as Notification;
}

export async function deleteNotification(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}

export async function pinNotification(id: string): Promise<Notification | null> {
  return updateNotification(id, { isPinned: true });
}

export async function unpinNotification(id: string): Promise<Notification | null> {
  return updateNotification(id, { isPinned: false });
}
