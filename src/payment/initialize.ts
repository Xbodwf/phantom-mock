/**
 * 支付系统初始化
 *
 * 这个文件展示了如何在应用启动时初始化支付系统。
 */

import type { Db } from 'mongodb';
import { RedeemCodeManager } from './redeemCodeManager.js';
import { paymentModuleManager } from './moduleManager.js';
import { EpayModule } from './modules/epay.js';
import { paymentModuleConfigs } from './config.js';

let redeemCodeManager: RedeemCodeManager | null = null;

/**
 * 初始化支付系统
 */
export async function initializePaymentSystem(db: Db): Promise<RedeemCodeManager> {
  console.log('[Payment] Initializing payment system...');

  // 初始化兑换码管理器
  redeemCodeManager = new RedeemCodeManager(db);
  console.log('[Payment] Redeem code manager initialized');

  // 注册支付模块
  await registerPaymentModules();

  console.log('[Payment] Payment system initialized successfully');
  return redeemCodeManager;
}

/**
 * 注册支付模块
 */
async function registerPaymentModules(): Promise<void> {
  for (const config of paymentModuleConfigs) {
    if (!config.enabled) {
      console.log(`[Payment] Module ${config.name} is disabled, skipping...`);
      continue;
    }

    try {
      let module;

      // 根据模块名称创建对应的模块实例
      switch (config.name) {
        case 'epay':
          module = new EpayModule();
          break;
        // 可以添加其他支付模块
        // case 'stripe':
        //   module = new StripeModule();
        //   break;
        default:
          console.warn(`[Payment] Unknown module: ${config.name}`);
          continue;
      }

      // 注册模块
      await paymentModuleManager.registerModule(module, config);
    } catch (error) {
      console.error(`[Payment] Failed to register module ${config.name}:`, error);
    }
  }
}

/**
 * 获取兑换码管理器
 */
export function getRedeemCodeManager(): RedeemCodeManager {
  if (!redeemCodeManager) {
    throw new Error('Payment system not initialized. Call initializePaymentSystem() first.');
  }
  return redeemCodeManager;
}

/**
 * 获取支付模块管理器
 */
export { paymentModuleManager };
