# 支付系统集成指南

## 快速开始

### 1. 环境配置

在 `.env` 文件中添加支付配置：

```env
# 易支付模块配置
PAYMENT_EPAY_ENABLED=true
PAYMENT_EPAY_PID=your_merchant_id
PAYMENT_EPAY_KEY=your_merchant_key
PAYMENT_EPAY_API_URL=https://pay.521cd.cn
PAYMENT_EPAY_NOTIFY_URL=http://110.42.98.47:58526/api/payment/notify?module=epay
PAYMENT_EPAY_RETURN_URL=http://110.42.98.47:58526/wallet
```

### 2. 系统已自动集成

支付系统已在应用启动时自动初始化：

- ✅ 兑换码管理器已初始化
- ✅ 支付模块已注册
- ✅ API 路由已挂载

### 3. 可用的 API 端点

#### 用户端点

| 方法 | 端点 | 描述 |
|------|------|------|
| POST | `/api/payment/redeem` | 兑换码兑换 |
| GET | `/api/payment/channels` | 获取支付渠道 |
| POST | `/api/payment/create` | 创建支付订单 |
| GET | `/api/payment/modules` | 获取支付模块列表 |

#### 管理员端点

| 方法 | 端点 | 描述 |
|------|------|------|
| POST | `/api/admin/redeem-codes` | 创建兑换码 |
| GET | `/api/admin/redeem-codes` | 获取兑换码列表 |
| GET | `/api/admin/redeem-codes/:id` | 获取兑换码详情 |
| DELETE | `/api/admin/redeem-codes/:id` | 删除兑换码 |
| GET | `/api/admin/redeem-codes-stats` | 获取统计信息 |

## 项目结构

```
src/payment/
├── types.ts                    # 支付模块接口定义
├── redeemCodeManager.ts        # 兑换码管理器（MongoDB）
├── moduleManager.ts            # 支付模块管理器
├── config.ts                   # 支付模块配置
├── initialize.ts               # 支付系统初始化
├── index.ts                    # 导出文件
├── modules/
│   └── epay.ts                # 易支付模块实现
└── README.md                   # 详细文档

src/routes/
├── payment.ts                  # 用户支付路由
└── adminPayment.ts             # 管理员支付路由
```

## 核心特性

### 兑换码系统

- 创建兑换码（支持金额、过期时间、描述）
- 验证和使用兑换码
- 自动更新用户余额
- 兑换码状态管理（active/used/expired）
- 统计信息查询

### 支付模块系统

- 标准化的支付模块接口
- 易支付模块参考实现
- 支持多个支付模块同时运行
- 动态模块注册和卸载
- 支付通知回调处理

## 使用示例

### 创建兑换码（管理员）

```bash
curl -X POST http://localhost:7143/api/admin/redeem-codes \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "SUMMER2024",
    "amount": 100,
    "description": "Summer promotion",
    "expiresAt": 1704067200000
  }'
```

### 兑换码兑换（用户）

```bash
curl -X POST http://localhost:7143/api/payment/redeem \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "SUMMER2024"
  }'
```

### 获取支付渠道

```bash
curl http://localhost:7143/api/payment/channels?module=epay
```

### 创建支付订单

```bash
curl -X POST http://localhost:7143/api/payment/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "moduleName": "epay",
    "type": "alipay",
    "name": "充值 100 元",
    "money": 100
  }'
```

## 前端集成

### 钱包页面组件

在 `src/frontend/pages/UserBillingPage.tsx` 中添加兑换码和支付功能：

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

## 添加新的支付模块

### 步骤 1：创建模块文件

创建 `src/payment/modules/mymodule.ts`：

```typescript
import type { IPaymentModule, PaymentModuleConfig } from '../types.js';

export class MyPaymentModule implements IPaymentModule {
  name = 'my-payment';
  version = '1.0.0';

  async initialize(config: PaymentModuleConfig): Promise<void> {
    // 初始化模块
  }

  async getChannels() {
    // 返回支付渠道
  }

  async createPayment(request) {
    // 创建支付订单
  }

  verifyNotification(notification) {
    // 验证签名
  }
}
```

### 步骤 2：注册模块

在 `src/payment/config.ts` 中：

```typescript
import { MyPaymentModule } from './modules/mymodule.js';

export const myPaymentModuleConfig: PaymentModuleConfig = {
  name: 'my-payment',
  version: '1.0.0',
  enabled: process.env.PAYMENT_MY_ENABLED === 'true',
  config: {
    // 模块配置
  },
};

export const paymentModuleConfigs: PaymentModuleConfig[] = [
  epayModuleConfig,
  myPaymentModuleConfig,  // 添加新模块
];
```

### 步骤 3：在 initialize.ts 中注册

```typescript
async function registerPaymentModules(): Promise<void> {
  for (const config of paymentModuleConfigs) {
    if (!config.enabled) continue;

    let module;
    switch (config.name) {
      case 'epay':
        module = new EpayModule();
        break;
      case 'my-payment':
        module = new MyPaymentModule();
        break;
      // ...
    }

    if (module) {
      await paymentModuleManager.registerModule(module, config);
    }
  }
}
```

## 安全建议

1. **签名验证**：所有支付通知都必须验证签名
2. **HTTPS**：生产环境必须使用 HTTPS
3. **密钥管理**：商户密钥应该存储在环境变量中
4. **幂等性**：处理重复的支付通知
5. **日志记录**：记录所有支付相关操作

## 常见问题

### Q: 如何测试支付功能？

A: 可以使用支付网关提供的沙箱环境进行测试。

### Q: 支付通知如何处理？

A: 支付网关会向 `PAYMENT_EPAY_NOTIFY_URL` 发送通知，系统会验证签名并更新用户余额。

### Q: 如何处理支付失败？

A: 支付模块的 `createPayment` 方法会返回错误信息，前端应该根据错误提示用户。

### Q: 兑换码是否支持批量生成？

A: 当前不支持，但可以通过 API 循环调用来实现。

## 文件清单

### 新增文件

- `src/payment/types.ts` - 支付模块接口定义
- `src/payment/redeemCodeManager.ts` - 兑换码管理器
- `src/payment/moduleManager.ts` - 支付模块管理器
- `src/payment/config.ts` - 支付模块配置
- `src/payment/initialize.ts` - 支付系统初始化
- `src/payment/index.ts` - 导出文件
- `src/payment/modules/epay.ts` - 易支付模块
- `src/payment/README.md` - 详细文档
- `src/routes/payment.ts` - 用户支付路由
- `src/routes/adminPayment.ts` - 管理员支付路由

### 修改文件

- `src/index.ts` - 添加支付系统初始化和路由挂载

## 下一步

1. 配置支付网关账户
2. 在 `.env` 中添加支付配置
3. 在前端钱包页面添加兑换码和支付功能
4. 测试兑换码和支付流程
5. 部署到生产环境

## 支持

如有问题，请参考 `src/payment/README.md` 获取更详细的文档。
