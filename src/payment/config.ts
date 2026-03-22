/**
 * 支付模块配置示例
 *
 * 这个文件展示了如何配置和初始化支付模块。
 * 在实际使用中，这些配置应该来自环境变量或配置文件。
 */

import type { PaymentModuleConfig } from './types.js';

/**
 * 易支付模块配置示例
 */
export const epayModuleConfig: PaymentModuleConfig = {
  name: 'epay',
  version: '1.0.0',
  enabled: process.env.PAYMENT_EPAY_ENABLED === 'true',
  config: {
    // 商户 ID
    pid: process.env.PAYMENT_EPAY_PID || '10500',

    // 商户密钥
    key: process.env.PAYMENT_EPAY_KEY || '',

    // API 地址
    apiUrl: process.env.PAYMENT_EPAY_API_URL || 'https://pay.521cd.cn',

    // 异步通知地址（支付成功后，支付网关会回调这个地址）
    notifyUrl: process.env.PAYMENT_EPAY_NOTIFY_URL || 'http://110.42.98.47:58526/api/payment/notify?module=epay',

    // 页面跳转地址（用户支付成功后跳转）
    returnUrl: process.env.PAYMENT_EPAY_RETURN_URL || 'http://110.42.98.47:58526/wallet',
  },
};

/**
 * 支付模块配置列表
 * 可以在这里添加多个支付模块的配置
 */
export const paymentModuleConfigs: PaymentModuleConfig[] = [
  epayModuleConfig,
  // 可以添加其他支付模块的配置
  // {
  //   name: 'stripe',
  //   version: '1.0.0',
  //   enabled: process.env.PAYMENT_STRIPE_ENABLED === 'true',
  //   config: {
  //     apiKey: process.env.PAYMENT_STRIPE_API_KEY || '',
  //     // ...
  //   },
  // },
];
