# 支付系统快速参考

## 核心概念

| 概念 | 说明 |
|------|------|
| **兑换码** | 用户可以输入兑换码获取余额，核心功能，不依赖支付模块 |
| **支付模块** | 可选的支付集成，支持多个模块同时运行 |
| **IPaymentModule** | 所有支付模块必须实现的标准接口 |
| **PaymentModuleManager** | 支付模块管理器，负责注册和卸载模块 |
| **RedeemCodeManager** | 兑换码管理器，负责兑换码的创建、验证和使用 |

## API 速查表

### 用户 API

```bash
# 兑换码兑换
POST /api/payment/redeem
{
  "code": "SUMMER2024"
}

# 获取支付渠道
GET /api/payment/channels?module=epay

# 创建支付订单
POST /api/payment/create
{
  "moduleName": "epay",
  "type": "alipay",
  "name": "充值 100 元",
  "money": 100
}

# 获取支付模块列表
GET /api/payment/modules
```

### 管理员 API

```bash
# 创建兑换码
POST /api/admin/redeem-codes
{
  "code": "SUMMER2024",
  "amount": 100,
  "description": "Summer promotion",
  "expiresAt": 1704067200000
}

# 获取兑换码列表
GET /api/admin/redeem-codes?status=active&limit=100&offset=0

# 获取兑换码详情
GET /api/admin/redeem-codes/:id

# 删除兑换码
DELETE /api/admin/redeem-codes/:id

# 获取统计信息
GET /api/admin/redeem-codes-stats
```

## 文件导航

| 文件 | 用途 |
|------|------|
| `src/payment/types.ts` | 支付模块接口定义 |
| `src/payment/redeemCodeManager.ts` | 兑换码管理器 |
| `src/payment/moduleManager.ts` | 支付模块管理器 |
| `src/payment/modules/epay.ts` | 易支付模块实现 |
| `src/routes/payment.ts` | 用户支付路由 |
| `src/routes/adminPayment.ts` | 管理员支付路由 |
| `src/payment/README.md` | 详细文档 |
| `PAYMENT_INTEGRATION.md` | 集成指南 |

## 环境变量

```env
PAYMENT_EPAY_ENABLED=true
PAYMENT_EPAY_PID=merchant_id
PAYMENT_EPAY_KEY=merchant_key
PAYMENT_EPAY_API_URL=https://pay.521cd.cn
PAYMENT_EPAY_NOTIFY_URL=http://110.42.98.47:58526/api/payment/notify?module=epay
PAYMENT_EPAY_RETURN_URL=http://110.42.98.47:58526/wallet
```

## 常用代码片段

### 创建兑换码（管理员）

```typescript
const response = await axios.post('/api/admin/redeem-codes', {
  code: 'SUMMER2024',
  amount: 100,
  description: 'Summer promotion',
}, {
  headers: { Authorization: `Bearer ${token}` }
});
```

### 兑换码兑换（用户）

```typescript
const response = await axios.post('/api/payment/redeem', {
  code: 'SUMMER2024'
}, {
  headers: { Authorization: `Bearer ${token}` }
});
```

### 创建支付订单（用户）

```typescript
const response = await axios.post('/api/payment/create', {
  moduleName: 'epay',
  type: 'alipay',
  name: '充值 100 元',
  money: 100
}, {
  headers: { Authorization: `Bearer ${token}` }
});

// 跳转到支付页面
if (response.data.payUrl) {
  window.location.href = response.data.payUrl;
}
```

## 兑换码状态

| 状态 | 说明 |
|------|------|
| `active` | 可用的兑换码 |
| `used` | 已被使用的兑换码 |
| `expired` | 已过期的兑换码 |

## 支付模块接口

```typescript
interface IPaymentModule {
  name: string;
  version: string;

  initialize(config: PaymentModuleConfig): Promise<void>;
  getChannels(): Promise<PaymentChannel[]>;
  createPayment(request: PaymentRequest): Promise<PaymentResponse>;
  verifyNotification(notification: PaymentNotification): boolean;
  queryOrder?(outTradeNo: string): Promise<...>;
  closeOrder?(outTradeNo: string): Promise<void>;
  refund?(outTradeNo: string, refundAmount: number): Promise<...>;
}
```

## 添加新支付模块的步骤

1. 创建模块文件：`src/payment/modules/mymodule.ts`
2. 实现 `IPaymentModule` 接口
3. 在 `src/payment/config.ts` 中添加配置
4. 在 `src/payment/initialize.ts` 中注册模块
5. 在 `.env` 中添加环境变量

## 常见问题

**Q: 兑换码和支付有什么区别？**
A: 兑换码是用户输入代码获取余额，支付是用户通过支付网关充值。

**Q: 支付模块是必需的吗？**
A: 不是。兑换码系统是核心功能，支付模块是可选的。

**Q: 如何添加新的支付方式？**
A: 创建一个新的支付模块，实现 `IPaymentModule` 接口即可。

**Q: 支付通知如何处理？**
A: 支付网关会向 `PAYMENT_EPAY_NOTIFY_URL` 发送通知，系统会验证签名并更新用户余额。

## 调试技巧

### 查看已注册的支付模块

```bash
curl http://localhost:7143/api/payment/modules
```

### 查看兑换码统计

```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:7143/api/admin/redeem-codes-stats
```

### 查看兑换码列表

```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:7143/api/admin/redeem-codes?status=active"
```

## 安全检查清单

- [ ] 商户密钥存储在环境变量中
- [ ] 生产环境使用 HTTPS
- [ ] 验证所有支付通知的签名
- [ ] 记录所有支付相关操作
- [ ] 处理重复的支付通知
- [ ] 定期审计支付日志

---

**最后更新**：2026-03-22
