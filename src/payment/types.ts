/**
 * 支付模块标准接口定义
 *
 * 这个文件定义了所有支付模块必须实现的接口。
 * 第三方支付模块可以按照这个接口进行封装。
 */

/**
 * 支付方式类型
 */
export type PaymentMethodType = 'alipay' | 'wxpay' | 'card' | 'bank' | string;

/**
 * 支付渠道信息
 */
export interface PaymentChannel {
  id: number;
  name: string;
  code: string;
  payType: PaymentMethodType;
  remark?: string;
  minAmount: number;
  maxAmount: number;
  dayAmount: number;
}

/**
 * 支付请求参数
 */
export interface PaymentRequest {
  // 商户订单号（唯一）
  outTradeNo: string;

  // 商品名称
  name: string;

  // 金额（元）
  money: number;

  // 支付方式
  type: PaymentMethodType;

  // 异步通知地址（服务器回调）
  notifyUrl?: string;

  // 页面跳转地址（用户支付后跳转）
  returnUrl?: string;

  // 用户IP
  clientIp?: string;

  // 设备类型 (pc/mobile/app)
  device?: string;

  // 业务扩展参数（支付后原样返回）
  param?: string;

  // 支付渠道ID
  channelId?: number;
}

/**
 * 支付响应结果
 */
export interface PaymentResponse {
  // 状态码 (1=成功, 其他=失败)
  code: number;

  // 状态信息
  msg?: string;

  // 支付订单号
  tradeNo?: string;

  // 支付跳转URL（三选一）
  payUrl?: string;

  // 二维码链接（三选一）
  qrCode?: string;

  // 小程序跳转URL（三选一）
  urlScheme?: string;

  // 支付金额
  money?: number;
}

/**
 * 支付通知参数
 */
export interface PaymentNotification {
  // 商户ID
  pid: string;

  // 支付订单号
  tradeNo: string;

  // 商户订单号
  outTradeNo: string;

  // 支付方式
  type: PaymentMethodType;

  // 商品名称
  name: string;

  // 金额
  money: number;

  // 支付状态 (TRADE_SUCCESS=成功)
  tradeStatus: string;

  // 业务扩展参数
  param?: string;

  // 签名
  sign: string;

  // 签名类型
  signType: string;
}

/**
 * 支付模块配置
 */
export interface PaymentModuleConfig {
  // 模块名称
  name: string;

  // 模块版本
  version: string;

  // 是否启用
  enabled: boolean;

  // 模块特定的配置
  config: Record<string, any>;
}

/**
 * 支付模块接口
 * 所有支付模块必须实现这个接口
 */
export interface IPaymentModule {
  /**
   * 模块名称
   */
  name: string;

  /**
   * 模块版本
   */
  version: string;

  /**
   * 初始化模块
   * @param config 模块配置
   */
  initialize(config: PaymentModuleConfig): Promise<void>;

  /**
   * 获取支持的支付渠道列表
   */
  getChannels(): Promise<PaymentChannel[]>;

  /**
   * 发起支付请求
   * @param request 支付请求参数
   * @returns 支付响应
   */
  createPayment(request: PaymentRequest): Promise<PaymentResponse>;

  /**
   * 验证支付通知签名
   * @param notification 支付通知
   * @returns 签名是否有效
   */
  verifyNotification(notification: PaymentNotification): boolean;

  /**
   * 查询订单状态
   * @param outTradeNo 商户订单号
   * @returns 订单状态
   */
  queryOrder?(outTradeNo: string): Promise<{
    status: 'pending' | 'success' | 'failed' | 'unknown';
    tradeNo?: string;
    money?: number;
  }>;

  /**
   * 关闭订单
   * @param outTradeNo 商户订单号
   */
  closeOrder?(outTradeNo: string): Promise<void>;

  /**
   * 退款
   * @param outTradeNo 商户订单号
   * @param refundAmount 退款金额
   */
  refund?(outTradeNo: string, refundAmount: number): Promise<{
    status: 'success' | 'failed';
    refundNo?: string;
  }>;
}
