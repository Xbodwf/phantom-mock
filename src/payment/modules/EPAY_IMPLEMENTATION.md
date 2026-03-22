# 易支付模块完整实现文档

## 概述

易支付模块是 Phantom Mock 支付系统的参考实现，展示了如何按照 `IPaymentModule` 接口完整实现一个支付模块。

## 核心功能

### 1. 支付渠道管理

**获取支付渠道列表**
```typescript
async getChannels(): Promise<PaymentChannel[]>
```

- 从易支付服务器获取可用的支付渠道
- 支持支付宝、微信支付等多种支付方式
- 包含金额限制信息（最小金额、最大金额、日限额）
- 失败时使用默认渠道列表

### 2. 支付订单创建

**创建支付订单**
```typescript
async createPayment(request: PaymentRequest): Promise<PaymentResponse>
```

**特性：**
- ✅ 金额范围验证（检查最小/最大金额）
- ✅ MD5 签名生成
- ✅ 支持多种支付方式（支付宝、微信等）
- ✅ 订单缓存管理
- ✅ 详细的日志记录

**返回结果：**
- `payUrl` - 支付页面链接（用于跳转支付）
- `qrCode` - 二维码链接（用于扫码支付）
- `urlScheme` - 小程序链接（用于小程序支付）

### 3. 订单查询

**查询订单状态**
```typescript
async queryOrder(outTradeNo: string): Promise<{
  status: 'pending' | 'success' | 'failed' | 'unknown';
  tradeNo?: string;
  money?: number;
}>
```

**特性：**
- ✅ 本地缓存查询（快速响应）
- ✅ 远程 API 查询（获取最新状态）
- ✅ 缓存更新机制
- ✅ 错误处理和日志

### 4. 订单关闭

**关闭订单**
```typescript
async closeOrder(outTradeNo: string): Promise<void>
```

**特性：**
- ✅ 调用易支付 API 关闭订单
- ✅ 更新本地缓存状态
- ✅ 错误处理和日志

### 5. 退款处理

**退款**
```typescript
async refund(outTradeNo: string, refundAmount: number): Promise<{
  status: 'success' | 'failed';
  refundNo?: string;
}>
```

**特性：**
- ✅ 订单存在性检查
- ✅ 退款金额验证（不超过订单金额）
- ✅ 生成唯一的退款单号
- ✅ 调用易支付退款 API
- ✅ 错误处理和日志

### 6. 签名验证

**验证支付通知签名**
```typescript
verifyNotification(notification: PaymentNotification): boolean
```

**特性：**
- ✅ MD5 签名验证
- ✅ 参数排序和拼接
- ✅ 密钥管理
- ✅ 安全性检查

### 7. 缓存管理

**获取缓存的订单**
```typescript
getCachedOrder(outTradeNo: string): any
```

**清除过期订单**
```typescript
cleanupExpiredOrders(): void
```

**获取缓存统计**
```typescript
getCacheStats(): {
  totalOrders: number;
  pendingOrders: number;
  successOrders: number;
  failedOrders: number;
}
```

## API 端点

### 用户端点

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/payment/channels?module=epay` | 获取支付渠道 |
| POST | `/api/payment/create` | 创建支付订单 |
| POST | `/api/payment/notify?module=epay` | 支付通知回调 |

### 管理员端点

| 方法 | 端点 | 功能 |
|------|------|------|
| GET | `/api/payment/modules` | 获取支付模块列表 |

## 配置

### 环境变量

```env
# 启用易支付模块
PAYMENT_EPAY_ENABLED=true

# 商户 ID
PAYMENT_EPAY_PID=your_merchant_id

# 商户密钥
PAYMENT_EPAY_KEY=your_merchant_key

# API 地址
PAYMENT_EPAY_API_URL=https://pay.521cd.cn

# 异步通知地址
PAYMENT_EPAY_NOTIFY_URL=http://your-domain.com/api/payment/notify?module=epay

# 页面跳转地址
PAYMENT_EPAY_RETURN_URL=http://your-domain.com/wallet
```

## 易支付 API 端点

模块调用的易支付 API 端点：

| 端点 | 功能 |
|------|------|
| `/xpay/user-channels` | 获取支付渠道列表 |
| `/xpay/epay/mapi.php` | 创建支付订单 |
| `/xpay/epay/query.php` | 查询订单状态 |
| `/xpay/epay/close.php` | 关闭订单 |
| `/xpay/epay/refund.php` | 退款 |

## 签名算法

MD5 签名生成过程：

1. 过滤空值和签名参数（sign、sign_type）
2. 按参数名 ASCII 码排序
3. 拼接成 URL 键值对格式：`a=b&c=d&e=f`
4. 拼接商户密钥：`a=b&c=d&e=f + KEY`
5. 进行 MD5 加密，得到小写的签名

**示例：**
```
参数: { pid: '1001', type: 'alipay', money: '100.00' }
排序后: pid=1001&type=alipay&money=100.00
拼接密钥: pid=1001&type=alipay&money=100.00your_key
MD5: md5(pid=1001&type=alipay&money=100.00your_key)
```

## 缓存机制

### 订单缓存

- **存储**：内存 Map 结构
- **键**：商户订单号（outTradeNo）
- **值**：订单信息（tradeNo、money、status 等）
- **过期时间**：24 小时

### 缓存字段

```typescript
{
  tradeNo: string;           // 支付订单号
  outTradeNo: string;        // 商户订单号
  money: number;             // 金额
  type: string;              // 支付方式
  status: 'pending' | 'success' | 'failed';
  createdAt: number;         // 创建时间
  paidAt?: number;           // 支付时间
}
```

## 日志记录

模块使用 `[Epay]` 前缀记录所有操作：

```
[Epay] Module initialized with PID: 1001
[Epay] Fetched 2 payment channels
[Epay] Creating payment order: order_123, amount: 100
[Epay] Payment order created: trade_no_456
[Epay] Order found in cache: order_123
[Epay] Order query result: order_123, status: success
[Epay] Processing refund: order_123, amount: 50
[Epay] Refund successful: refund_no_789
```

## 错误处理

### 常见错误

| 错误 | 原因 | 处理 |
|------|------|------|
| 金额超出范围 | 金额小于最小值或大于最大值 | 返回错误信息 |
| 订单不存在 | 查询/关闭/退款时订单不存在 | 返回 unknown/failed |
| 签名验证失败 | 签名不匹配 | 拒绝通知 |
| API 超时 | 易支付服务器无响应 | 使用缓存或返回 unknown |
| 网络错误 | 网络连接失败 | 记录错误并返回失败 |

## 使用示例

### 创建支付订单

```typescript
const response = await epayModule.createPayment({
  outTradeNo: 'order_123',
  name: '充值 100 元',
  money: 100,
  type: 'alipay',
  clientIp: '192.168.1.1',
  device: 'pc',
  param: JSON.stringify({ userId: 'user_123' }),
});

if (response.code === 1) {
  // 支付成功，获取支付链接
  if (response.payUrl) {
    // 跳转到支付页面
    window.location.href = response.payUrl;
  } else if (response.qrCode) {
    // 显示二维码
    showQRCode(response.qrCode);
  }
}
```

### 查询订单状态

```typescript
const result = await epayModule.queryOrder('order_123');

if (result.status === 'success') {
  console.log('订单已支付，金额:', result.money);
} else if (result.status === 'pending') {
  console.log('订单待支付');
} else {
  console.log('订单状态未知');
}
```

### 处理支付通知

```typescript
// 验证签名
if (!epayModule.verifyNotification(notification)) {
  return res.status(400).json({ error: 'Invalid signature' });
}

// 检查支付状态
if (notification.tradeStatus === 'TRADE_SUCCESS') {
  // 更新用户余额
  updateUserBalance(userId, notification.money);

  // 返回成功标记
  res.send('success');
}
```

### 退款

```typescript
const result = await epayModule.refund('order_123', 50);

if (result.status === 'success') {
  console.log('退款成功，退款单号:', result.refundNo);
} else {
  console.log('退款失败');
}
```

## 性能优化

### 缓存策略

- 订单创建时立即缓存
- 查询时优先使用缓存
- 定期清除过期订单（24 小时）

### 超时设置

- 获取渠道列表：5 秒
- 创建支付订单：10 秒
- 查询订单状态：5 秒
- 关闭订单：5 秒
- 退款：10 秒

### 并发处理

- 使用 Map 存储缓存，支持并发访问
- 异步操作不阻塞主线程
- 错误不影响其他请求

## 安全建议

1. **密钥管理**
   - 商户密钥存储在环境变量中
   - 不要在代码中硬编码密钥
   - 定期更换密钥

2. **签名验证**
   - 所有支付通知都必须验证签名
   - 拒绝签名验证失败的请求
   - 记录所有验证失败的请求

3. **HTTPS**
   - 生产环境必须使用 HTTPS
   - 确保支付通知 URL 使用 HTTPS

4. **幂等性**
   - 支付通知可能重复发送
   - 使用商户订单号作为唯一标识
   - 检查订单是否已处理

5. **日志记录**
   - 记录所有支付相关操作
   - 记录所有错误和异常
   - 定期审计日志

## 扩展开发

### 添加新的支付方式

1. 在易支付后台配置新的支付渠道
2. 模块会自动获取新渠道
3. 前端可以选择新的支付方式

### 自定义缓存

可以继承 `EpayModule` 并覆盖缓存方法：

```typescript
class CustomEpayModule extends EpayModule {
  private redisClient: Redis;

  async getCachedOrder(outTradeNo: string): Promise<any> {
    // 从 Redis 获取
    return await this.redisClient.get(`order:${outTradeNo}`);
  }

  async setCachedOrder(outTradeNo: string, order: any): Promise<void> {
    // 存储到 Redis
    await this.redisClient.set(`order:${outTradeNo}`, order, 'EX', 86400);
  }
}
```

## 故障排查

### 问题：签名验证失败

**原因：**
- 商户密钥不正确
- 参数排序错误
- 参数值包含特殊字符

**解决：**
- 检查环境变量中的密钥
- 查看日志中的签名生成过程
- 确保参数值正确

### 问题：订单查询返回 unknown

**原因：**
- 订单不存在
- 易支付服务器无响应
- 网络连接失败

**解决：**
- 检查订单号是否正确
- 检查易支付 API 地址
- 检查网络连接

### 问题：支付通知未收到

**原因：**
- 通知 URL 不正确
- 防火墙阻止
- 服务器未启动

**解决：**
- 检查 `PAYMENT_EPAY_NOTIFY_URL` 配置
- 检查防火墙规则
- 检查服务器日志

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-03-22 | 初始版本，完整实现所有功能 |

## 许可证

MIT
