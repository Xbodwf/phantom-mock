import { toEntity, toEntities } from './utils';
import { getDB } from './connection';
import { InvitationRecord } from '../types';
import { ObjectId } from 'mongodb';

const COLLECTION_NAME = 'invitationRecords';

export async function createInvitationRecord(
  record: Omit<InvitationRecord, 'id' | 'createdAt'> & { _id?: ObjectId }
): Promise<InvitationRecord> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = {
    ...record,
    _id: record._id || new ObjectId(),
    createdAt: Date.now(),
  };

  await collection.insertOne(doc);
  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as InvitationRecord;
}

export async function getInvitationRecord(id: string): Promise<InvitationRecord | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ _id: new ObjectId(id) });
  if (!doc) return null;

  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as InvitationRecord;
}

export async function getInvitationsByInviter(inviterId: string): Promise<InvitationRecord[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ inviterId }).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as InvitationRecord[];
}

export async function getInvitationsByInvitee(inviteeId: string): Promise<InvitationRecord[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({ inviteeId }).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as InvitationRecord[];
}

export async function getInvitationByCode(inviteCode: string): Promise<InvitationRecord | null> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const doc = await collection.findOne({ inviteCode });
  if (!doc) return null;

  return {
    ...doc,
    id: doc._id.toString(),
  } as unknown as InvitationRecord;
}

export async function getAllInvitationRecords(): Promise<InvitationRecord[]> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const docs = await collection.find({}).sort({ createdAt: -1 }).toArray();
  return docs.map(doc => ({
    ...doc,
    id: doc._id.toString(),
  })) as unknown as InvitationRecord[];
}

export async function deleteInvitationRecord(id: string): Promise<boolean> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  const result = await collection.deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}

export async function countInvitationsByInviter(inviterId: string): Promise<number> {
  const db = getDB();
  const collection = db.collection(COLLECTION_NAME);

  return await collection.countDocuments({ inviterId });
}
