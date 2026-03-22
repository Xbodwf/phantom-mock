/**
 * 兑换码系统 - MongoDB 版本
 * 这是核心功能，不依赖任何支付模块
 */

import type { Db, Collection } from 'mongodb';

export interface RedeemCode {
  _id?: string;
  code: string;
  amount: number;
  description?: string;
  createdAt: number;
  expiresAt?: number;
  usedAt?: number;
  usedBy?: string;
  status: 'active' | 'used' | 'expired';
}

export interface RedeemCodeCreateRequest {
  code: string;
  amount: number;
  description?: string;
  expiresAt?: number;
}

export class RedeemCodeManager {
  private collection: Collection<RedeemCode>;

  constructor(db: Db) {
    this.collection = db.collection('redeem_codes');
    this.initializeIndexes();
  }

  private async initializeIndexes(): Promise<void> {
    try {
      await this.collection.createIndex({ code: 1 }, { unique: true });
      await this.collection.createIndex({ status: 1 });
      await this.collection.createIndex({ createdAt: -1 });
    } catch (error) {
      console.warn('[RedeemCode] Failed to create indexes:', error);
    }
  }

  /**
   * 创建兑换码
   */
  async createCode(request: RedeemCodeCreateRequest): Promise<RedeemCode> {
    const now = Date.now();
    const code: RedeemCode = {
      code: request.code,
      amount: request.amount,
      description: request.description,
      createdAt: now,
      expiresAt: request.expiresAt,
      status: 'active',
    };

    const result = await this.collection.insertOne(code as any);

    return {
      ...code,
      _id: result.insertedId.toString(),
    };
  }

  /**
   * 获取兑换码信息
   */
  async getCode(code: string): Promise<RedeemCode | null> {
    return await this.collection.findOne({ code });
  }

  /**
   * 验证并使用兑换码
   */
  async redeemCode(code: string, userId: string): Promise<{ success: boolean; amount?: number; error?: string }> {
    const redeemCode = await this.getCode(code);

    if (!redeemCode) {
      return { success: false, error: 'Redeem code not found' };
    }

    if (redeemCode.status === 'used') {
      return { success: false, error: 'Redeem code has already been used' };
    }

    if (redeemCode.status === 'expired') {
      return { success: false, error: 'Redeem code has expired' };
    }

    // 检查过期时间
    if (redeemCode.expiresAt && redeemCode.expiresAt < Date.now()) {
      // 更新状态为过期
      await this.collection.updateOne({ code }, { $set: { status: 'expired' } });
      return { success: false, error: 'Redeem code has expired' };
    }

    // 标记为已使用
    const now = Date.now();
    await this.collection.updateOne(
      { code },
      {
        $set: {
          status: 'used',
          usedAt: now,
          usedBy: userId,
        },
      }
    );

    return { success: true, amount: redeemCode.amount };
  }

  /**
   * 获取兑换码列表（管理员）
   */
  async listCodes(status?: string, limit: number = 100, offset: number = 0): Promise<RedeemCode[]> {
    const query: any = {};
    if (status) {
      query.status = status;
    }

    return await this.collection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .toArray();
  }

  /**
   * 删除兑换码
   */
  async deleteCode(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    used: number;
    expired: number;
    totalAmount: number;
    usedAmount: number;
  }> {
    const pipeline = [
      {
        $facet: {
          counts: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                active: {
                  $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
                },
                used: {
                  $sum: { $cond: [{ $eq: ['$status', 'used'] }, 1, 0] },
                },
                expired: {
                  $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] },
                },
                totalAmount: { $sum: '$amount' },
                usedAmount: {
                  $sum: { $cond: [{ $eq: ['$status', 'used'] }, '$amount', 0] },
                },
              },
            },
          ],
        },
      },
    ];

    const result = await this.collection.aggregate(pipeline).toArray();
    const stats = result[0]?.counts[0];

    return {
      total: stats?.total || 0,
      active: stats?.active || 0,
      used: stats?.used || 0,
      expired: stats?.expired || 0,
      totalAmount: stats?.totalAmount || 0,
      usedAmount: stats?.usedAmount || 0,
    };
  }

  /**
   * 按 ID 获取兑换码
   */
  async getCodeById(id: string): Promise<RedeemCode | null> {
    try {
      const { ObjectId } = await import('mongodb');
      return await this.collection.findOne({ _id: new ObjectId(id) } as any);
    } catch {
      return null;
    }
  }
}
