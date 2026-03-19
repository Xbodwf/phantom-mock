import { ObjectId, Document } from 'mongodb';

/**
 * 将MongoDB文档转换为应用类型
 * 保留原有的id字段，如果没有id则使用_id
 */
export function toEntity<T extends { id?: string }>(doc: Document & { _id: ObjectId }): T {
  const { _id, ...rest } = doc;
  // 如果文档已有 id 字段，保留它；否则使用 _id
  const id = rest.id || _id.toString();
  return {
    ...rest,
    id,
  } as T;
}

/**
 * 将多个MongoDB文档转换为应用类型
 */
export function toEntities<T extends { id?: string }>(docs: (Document & { _id: ObjectId })[]): T[] {
  return docs.map(doc => toEntity<T>(doc));
}