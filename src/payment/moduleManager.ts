/**
 * 支付模块加载器
 * 动态加载和管理支付模块
 */

import type { IPaymentModule, PaymentModuleConfig } from './types.js';

export class PaymentModuleManager {
  private modules: Map<string, IPaymentModule> = new Map();
  private configs: Map<string, PaymentModuleConfig> = new Map();

  /**
   * 注册支付模块
   */
  async registerModule(module: IPaymentModule, config: PaymentModuleConfig): Promise<void> {
    if (!config.enabled) {
      console.log(`[Payment] Module ${module.name} is disabled`);
      return;
    }

    try {
      await module.initialize(config);
      this.modules.set(module.name, module);
      this.configs.set(module.name, config);
      console.log(`[Payment] Module ${module.name} v${module.version} registered successfully`);
    } catch (error) {
      console.error(`[Payment] Failed to register module ${module.name}:`, error);
      throw error;
    }
  }

  /**
   * 获取模块
   */
  getModule(name: string): IPaymentModule | null {
    return this.modules.get(name) || null;
  }

  /**
   * 获取所有已注册的模块
   */
  getModules(): IPaymentModule[] {
    return Array.from(this.modules.values());
  }

  /**
   * 检查模块是否已注册
   */
  hasModule(name: string): boolean {
    return this.modules.has(name);
  }

  /**
   * 卸载模块
   */
  unregisterModule(name: string): boolean {
    return this.modules.delete(name) && this.configs.delete(name);
  }

  /**
   * 获取模块配置
   */
  getModuleConfig(name: string): PaymentModuleConfig | null {
    return this.configs.get(name) || null;
  }
}

// 全局支付模块管理器实例
export const paymentModuleManager = new PaymentModuleManager();
