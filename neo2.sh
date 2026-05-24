#!/bin/bash
cd "$(dirname "$0")"
node -e "
const {MongoClient} = require('mongodb');
const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGODB || 'mongodb://localhost:27017';
const name = process.env.DB_NAME || 'phantom_mock';
(async()=>{
  const db = (await MongoClient.connect(uri)).db(name);
  const col = db.collection('models');

  // 市场价（原始价格，单位 USD / 1K tokens）
  const updates = [
    // --- OpenAI ---
    { id: 'gpt-5-nano',         pricing: { type:'token', input:0.00005, output:0.0004,  cacheRead:0.000005 } },
    { id: 'gpt-image-2',        pricing: { type:'token', input:0.005,   output:0.01,   cacheRead:0.00125 } },
    // --- Anthropic ---
    { id: 'claude-sonnet-4-6',  pricing: { type:'token', input:0.003,   output:0.015,  cacheRead:0.0003 } },
    { id: 'claude-opus-4-6',    pricing: { type:'token', input:0.005,   output:0.025,  cacheRead:0.0005 } },
    // --- Google ---
    { id: 'gemini-3-flash-preview', pricing: { type:'token', input:0.0005,  output:0.003 } },
    { id: 'gemini-3.5-flash',       pricing: { type:'token', input:0.0015,  output:0.009, cacheRead:0.00015 } },
    // --- DeepSeek ---
    { id: 'deepseek-v4-flash',  pricing: { type:'token', input:0.00014, output:0.00028, cacheRead:0.000003 } },
    { id: 'deepseek-v4-pro',    pricing: { type:'token', input:0.00174, output:0.00348, cacheRead:0.000145 } },
    // --- Zhipu ---
    { id: 'glm-4.6-thinking',   pricing: { type:'token', input:0.0005,  output:0.002 } },
    // --- Qwen (SiliconFlow) ---
    { id: 'Qwen/Qwen3.5-9B',    pricing: { type:'token', input:0.00015, output:0.0006 } },
    // --- 免费模型 ---
    { id: 'Qwen/Qwen3-8B',      pricing: null },
    { id: 'Qwen/Qwen3.5-4B',    pricing: null },
    { id: 'DeepSeek-R1-0528-Qwen3-8B', pricing: null },
    { id: 'qwen3-embedding:4b', pricing: null },
    // --- 保持原价（本地节点模型，无市场价） ---
    // { id: 'qwen3-vl:4b'  }  本地节点，原 0.02/K
    // { id: 'brain'       }  用户回复模型
    // { id: 'bge-m3'      }  本地节点，0.0001/K
    // { id: 'gemma3:270m' }  本地节点，0.00001/K
  ];

  for (const u of updates) {
    const r = await col.updateOne({ id: u.id }, { \$set: { pricing: u.pricing } });
    console.log(u.id + ' -> ' + (r.modifiedCount ? '✓ 已更新' : (r.matchedCount ? '✓ 价格一致' : '✗ 未找到')));
  }

  // 显示更新后的所有模型价格
  console.log('\\n--- 当前全部模型定价 ---');
  const all = await col.find({}).project({ _id:0, id:1, 'pricing.type':1, 'pricing.input':1, 'pricing.output':1, 'pricing.cacheRead':1 }).toArray();
  for (const m of all) {
    const p = m.pricing;
    if (!p) { console.log(m.id + '\\t免费'); continue; }
    const cr = p.cacheRead ? ', cacheRead=' + p.cacheRead : '';
    console.log(m.id + '\\tinput=' + p.input + ', output=' + p.output + cr);
  }
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)})
"