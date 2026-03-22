# 支付系统文档

## 概述

Phantom Mock 的支付系统采用模块化设计，支持兑换码和第三方支付集成。核心功能（兑换码）不依赖任何支付模块，支付模块作为可选的独立模块加载。

## 架构

```
支付系统
├── 核心功能（不依赖支付模块）
│   └── 兑换码系统 (RedeemCodeManager)
├── 支付模块接口 (IPaymentModule)
├── 支付模块管理器 (PaymentModuleManager)
└── 支付模块实现
    ├── 易支付模块 (EpayModule)
    └── 其他支付模块...
```

## 核心功能：兑换码系统

### 特性

- ✅ 创建兑换码（支持金额、过期时间、描述）
- ✅ 验证和使用兑换码
- ✅ 兑换码状态管理（active/used/expired）
- ✅ 统计信息查询
- ✅ 管理员管理界面

### API 端点

#### 用户端

**兑换码兑换**
```
POST /api/payment/redeem
Content-Type: application/json

{
  "code": "SUMMER2024"
}

Response:
{
  "success": true,
  "amount": 100,
  "newBalance": 150,
  "message": "Successfully redeemed 100 credits"
}
```

#### 管理员端

**创建兑换码**
```
POST /api/admin/redeem-codes
Content-Type: application/json

{
  "code": "SUMMER2024",
  "amount": 100,
  "description": "Summer promotion",
  "expiresAt": 1704067200000  // 可选，Unix 时间戳
}

Response:
{
  "success": true,
  "redeemCode": {
    "_id": "...",
    "code": "SUMMER2024",
    "amount": 100,
    "description": "Summer promotion",
    "createdAt": 1704067200000,
    "status": "active"
  }
}
```

**获取兑换码列表**
```
GET /api/admin/redeem-codes?status=active&limit=100&offset=0

Response:
{
  "codes": [...],
  "stats": {
    "total": 50,
    "active": 30,
    "used": 15,
    "expired": 5,
    "totalAmount": 5000,
    "usedAmount": 1500
  },
  "pagination": {
    "limit": 100,
    "offset": 0
  }
}
```

**获取统计信息**
```
GET /api/admin/redeem-codes-stats

Response:
{
  "total": 50,
  "active": 30,
  "used": 15,
  "expired": 5,
  "totalAmount": 5000,
  "usedAmount": 1500
}
```

**删除兑换码**
```
DELETE /api/admin/redeem-codes/:id

Response:
{
  "success": true
}
```

## 支付模块系统

### 支付模块接口

所有支付模块必须实现 `IPaymentModule` 接口：

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

### 易支付模块

易支付模块是一个参考实现，展示了如何按照标准接口封装支付模块。

#### 配置

在 `.env` 文件中配置：

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
PAYMENT_EPAY_NOTIFY_URL=http://110.42.98.47:58526/api/payment/notify?module=epay

# 页面跳转地址
PAYMENT_EPAY_RETURN_URL=http://110.42.98.47:58526/wallet
```

#### API 端点

**获取支付渠道**
```
GET /api/payment/channels?module=epay

Response:
{
  "channels": [
    {
      "id": 1,
      "name": "支付宝",
      "code": "alipay",
      "payType": "alipay",
      "minAmount": 0.01,
      "maxAmount": 1000,
      "dayAmount": 10000
    },
    ...
  ]
}
```

**创建支付订单**
```
POST /api/payment/create
Content-Type: application/json

{
  "moduleName": "epay",
  "type": "alipay",
  "name": "充值 100 元",
  "money": 100,
  "param": {
    "custom_field": "value"
  }
}

Response:
{
  "success": true,
  "outTradeNo": "user_123_1704067200000_abc123",
  "code": 1,
  "tradeNo": "20240101123456",
  "payUrl": "https://pay.521cd.cn/pay/...",
  "money": 100
}
```

**支付通知回调**
```
POST /api/payment/notify?module=epay

支付网关会发送支付结果通知到这个地址。
系统会验证签名，更新用户余额。
```

**获取已注册的支付模块**
```
GET /api/payment/modules

Response:
{
  "modules": [
    {
      "name": "epay",
      "version": "1.0.0"
    }
  ]
}
```

## 集成支付模块

### 步骤 1：实现支付模块

创建一个新的支付模块，实现 `IPaymentModule` 接口：

```typescript
import type { IPaymentModule, PaymentModuleConfig } from '@/payment/types';

export class MyPaymentModule implements IPaymentModule {
  name = 'my-payment';
  version = '1.0.0';

  async initialize(config: PaymentModuleConfig): Promise<void> {
    // 初始化模块
  }

  async getChannels(): Promise<PaymentChannel[]> {
    // 返回支持的支付渠道
  }

  async createPayment(request: PaymentRequest): Promise<PaymentResponse> {
    // 创建支付订单
  }

  verifyNotification(notification: PaymentNotification): boolean {
    // 验证支付通知签名
  }

  // 可选方法
  async queryOrder(outTradeNo: string): Promise<...> {
    // 查询订单状态
  }

  async closeOrder(outTradeNo: string): Promise<void> {
    // 关闭订单
  }

  async refund(outTradeNo: string, refundAmount: number): Promise<...> {
    // 退款
  }
}
```

### 步骤 2：注册模块

在 `src/payment/config.ts` 中添加模块配置：

```typescript
export const myPaymentModuleConfig: PaymentModuleConfig = {
  name: 'my-payment',
  version: '1.0.0',
  enabled: process.env.PAYMENT_MY_ENABLED === 'true',
  config: {
    // 模块特定的配置
    apiKey: process.env.PAYMENT_MY_API_KEY || '',
    // ...
  },
};

export const paymentModuleConfigs: PaymentModuleConfig[] = [
  epayModuleConfig,
  myPaymentModuleConfig,  // 添加新模块
];
```

### 步骤 3：在应用启动时加载

在 `src/index.ts` 中：

```typescript
import { initializePaymentSystem } from './payment/initialize.js';

// 初始化支付系统
const redeemCodeManager = await initializePaymentSystem(db);
```

### 步骤 4：挂载路由

在 `src/index.ts` 中：

```typescript
import { createPaymentRoutes } from './routes/payment.js';
import { createAdminPaymentRoutes } from './routes/adminPayment.js';

// 挂载支付路由
app.use('/api/payment', createPaymentRoutes(redeemCodeManager));
app.use('/api/admin', createAdminPaymentRoutes(redeemCodeManager));
```

## 前端集成

### 兑换码页面

在钱包页面添加兑换码输入框：

```tsx
import { useState } from 'react';
import axios from 'axios';

export function RedeemCodeSection() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleRedeem = async () => {
    setLoading(true);
    try {
      const response = await axios.post('/api/payment/redeem', { code });
      setMessage(`成功兑换 ${response.data.amount} 元`);
      setCode('');
      // 刷新余额
    } catch (error: any) {
      setMessage(error.response?.data?.error || '兑换失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="输入兑换码"
      />
      <button onClick={handleRedeem} disabled={loading}>
        兑换
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
```

### 支付页面

```tsx
import { useState, useEffect } from 'react';
import axios from 'axios';

export function PaymentSection() {
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState('alipay');
  const [amount, setAmount] = useState(100);

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      const response = await axios.get('/api/payment/channels?module=epay');
      setChannels(response.data.channels);
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    }
  };

  const handlePay = async () => {
    try {
      const response = await axios.post('/api/payment/create', {
        moduleName: 'epay',
        type: selectedChannel,
        name: `充值 ${amount} 元`,
        money: amount,
      });

      if (response.data.payUrl) {
        // 跳转到支付页面
        window.location.href = response.data.payUrl;
      } else if (response.data.qrCode) {
        // 显示二维码
        showQRCode(response.data.qrCode);
      }
    } catch (error) {
      console.error('Payment failed:', error);
    }
  };

  return (
    <div>
      <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)}>
        {channels.map((ch) => (
          <option key={ch.id} value={ch.code}>
            {ch.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        min="0.01"
      />
      <button onClick={handlePay}>支付</button>
    </div>
  );
}
```

## 环境变量

```env
# 易支付模块
PAYMENT_EPAY_ENABLED=true
PAYMENT_EPAY_PID=your_merchant_id
PAYMENT_EPAY_KEY=your_merchant_key
PAYMENT_EPAY_API_URL=https://pay.521cd.cn
PAYMENT_EPAY_NOTIFY_URL=http://your-domain.com/api/payment/notify?module=epay
PAYMENT_EPAY_RETURN_URL=http://your-domain.com/wallet
```

## 安全建议

1. **签名验证**：所有支付通知都必须验证签名
2. **HTTPS**：生产环境必须使用 HTTPS
3. **密钥管理**：商户密钥应该存储在环境变量中，不要提交到代码库
4. **幂等性**：支付通知可能会重复发送，需要处理重复请求
5. **日志记录**：记录所有支付相关的操作，便于审计和调试

## 常见问题

### Q: 如何添加新的支付方式？

A: 创建一个新的支付模块，实现 `IPaymentModule` 接口，然后在配置中注册即可。

### Q: 支付模块是否可以动态加载？

A: 可以。支付模块管理器支持动态注册和卸载模块。

### Q: 如何处理支付失败？

A: 支付模块的 `createPayment` 方法会返回错误信息。前端应该根据错误信息提示用户。

### Q: 兑换码是否支持批量生成？

A: 当前不支持，但可以通过 API 循环调用来实现。

### Q: 支付通知如何处理重复请求？

A: 系统应该根据 `outTradeNo` 检查订单是否已经处理过，避免重复更新余额。

## 许可证

MIT
