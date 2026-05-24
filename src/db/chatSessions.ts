import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { getDB } from './connection.js';

export interface FileNode {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  children?: FileNode[];
}

export interface ChatSession {
  _id?: ObjectId;
  id: string;
  title: string;
  model: string;
  systemPrompt: string;
  apiType: string;
  stream: boolean;
  timeout: number;
  messages: any[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  ownerId: string;
  fileTree?: FileNode[];
}

export async function getChatSessionsCollection(): Promise<Collection<ChatSession>> {
  const db = await getDB();
  return db.collection<ChatSession>('chatSessions');
}

export async function createChatSession(session: ChatSession): Promise<ChatSession> {
  const collection = await getChatSessionsCollection();
  await collection.insertOne(session);
  return session;
}

export async function getChatSessionById(id: string): Promise<ChatSession | null> {
  const collection = await getChatSessionsCollection();
  return await collection.findOne({ id });
}

export async function updateChatSession(id: string, updates: Partial<ChatSession>): Promise<boolean> {
  const collection = await getChatSessionsCollection();
  const result = await collection.updateOne(
    { id },
    { $set: { ...updates, updatedAt: Date.now() } }
  );
  return result.modifiedCount > 0;
}

export async function getPublicChatSession(id: string): Promise<ChatSession | null> {
  const collection = await getChatSessionsCollection();
  const session = await collection.findOne({ id, isPublic: true });
  console.log('getPublicChatSession:', id, 'found:', !!session);
  if (session) {
    console.log('Session data:', { id: session.id, isPublic: session.isPublic, ownerId: session.ownerId });
  }
  return session;
}

export async function getUserChatSessions(ownerId: string): Promise<ChatSession[]> {
  const collection = await getChatSessionsCollection();
  return await collection.find({ ownerId }).sort({ updatedAt: -1 }).toArray();
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const collection = await getChatSessionsCollection();
  const result = await collection.deleteOne({ id });
  return result.deletedCount > 0;
}