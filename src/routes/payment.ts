/**
 * 支付和兑换码相关的 API 路由
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getUserById, updateUser } from '../storage.js';
import { paymentModuleManager } from '../payment/moduleManager.js';
import type { RedeemCodeManager } from '../payment/redeemCodeManager.js';

export function createPaymentRoutes(redeemCodeManager: RedeemCodeManager): RouterType {
  const router: RouterType = Router();

  /**
   * POST /api/payment/redeem - 兑换码兑换
   */
  router.post('/redeem', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Invalid redeem code' });
    }

    try {
      // 验证并使用兑换码
      const result = await redeemCodeManager.redeemCode(code, userId);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      // 更新用户余额
      const user = getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const newBalance = (user.balance || 0) + (result.amount || 0);
      updateUser(userId, { balance: newBalance });

      res.json({
        success: true,
        amount: result.amount,
        newBalance,
        message: `Successfully redeemed ${result.amount} credits`,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/payment/channels - 获取支付渠道列表
   */
  router.get('/channels', async (req: Request, res: Response) => {
    const moduleName = req.query.module as string || 'epay';
    const module = paymentModuleManager.getModule(moduleName);

    if (!module) {
      return res.status(400).json({ error: `Payment module '${moduleName}' not found` });
    }

    try {
      const channels = await module.getChannels();
      res.json({ channels });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/payment/create - 创建支付订单
   */
  router.post('/create', async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { moduleName = 'epay', type, name, money, param } = req.body;

    if (!type || !name || !money || money <= 0) {
      return res.status(400).json({ error: 'Invalid payment parameters' });
    }

    const module = paymentModuleManager.getModule(moduleName);
    if (!module) {
      return res.status(400).json({ error: `Payment module '${moduleName}' not found` });
    }

    try {
      // 生成商户订单号
      const outTradeNo = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 获取客户端 IP
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';

      // 创建支付请求
      const paymentResponse = await module.createPayment({
        outTradeNo,
        name,
        money,
        type,
        clientIp,
        device: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 'pc',
        param: param ? JSON.stringify({ userId, ...param }) : JSON.stringify({ userId }),
      });

      if (paymentResponse.code === 1) {
        res.json({
          success: true,
          outTradeNo,
          ...paymentResponse,
        });
      } else {
        res.status(400).json({
          error: paymentResponse.msg || 'Payment creation failed',
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/payment/notify - 支付通知回调（来自支付模块）
   */
  router.post('/notify', async (req: Request, res: Response) => {
    const moduleName = req.query.module as string || 'epay';
    const module = paymentModuleManager.getModule(moduleName);

    if (!module) {
      return res.status(400).json({ error: `Payment module '${moduleName}' not found` });
    }

    try {
      // 验证签名
      if (!module.verifyNotification(req.body)) {
        return res.status(400).json({ error: 'Invalid signature' });
      }

      // 检查支付状态
      if (req.body.trade_status !== 'TRADE_SUCCESS') {
        return res.status(400).json({ error: 'Payment not successful' });
      }

      // 解析业务参数
      let userId: string | null = null;
      try {
        const param = JSON.parse(req.body.param || '{}');
        userId = param.userId;
      } catch {
        // 如果 param 不是 JSON，尝试直接使用
        userId = req.body.param;
      }

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId in payment param' });
      }

      // 更新用户余额
      const user = getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const amount = parseFloat(req.body.money);
      const newBalance = (user.balance || 0) + amount;
      updateUser(userId, { balance: newBalance });

      // 返回成功标记
      res.send('success');
    } catch (error: any) {
      console.error('[Payment] Notification error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/payment/modules - 获取已注册的支付模块列表
   */
  router.get('/modules', (req: Request, res: Response) => {
    const modules = paymentModuleManager.getModules().map((m: any) => ({
      name: m.name,
      version: m.version,
    }));

    res.json({ modules });
  });

  return router;
}
