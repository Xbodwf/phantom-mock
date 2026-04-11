#!/usr/bin/env node

/**
 * 使用oxc快速编译TypeScript后端代码
 */

import { promises as fs } from 'fs';
import path from 'path';
import { transform } from 'oxc-transform';

const SRC_DIR = './src';
const DIST_DIR = './dist';

async function compileFile(filePath, outPath) {
  const code = await fs.readFile(filePath, 'utf-8');
  
  // 使用oxc转换TypeScript到JavaScript
  const result = transform(code, filePath, {
    lang: 1, // TypeScript
    sourcemap: true,
    jsx: 'react',
  });
  
  // 确保输出目录存在
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  
  // 写入编译后的代码
  await fs.writeFile(outPath.replace('.ts', '.js'), result.code);
  
  // 如果有sourcemap，也写入
  if (result.map) {
    await fs.writeFile(outPath.replace('.ts', '.js.map'), result.map);
  }
  
  console.log(`✓ ${filePath} -> ${outPath.replace('.ts', '.js')}`);
}

async function walkDir(dir, outDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const outPath = path.join(outDir, entry.name);
    
    if (entry.isDirectory()) {
      // 跳过frontend目录（由vite处理）
      if (entry.name === 'frontend') continue;
      await walkDir(fullPath, outPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      await compileFile(fullPath, outPath);
    }
  }
}

async function main() {
  console.log('🚀 使用oxc编译后端代码...');
  const start = Date.now();
  
  try {
    // 清理dist目录
    await fs.rm(DIST_DIR, { recursive: true, force: true });
    
    // 编译src目录
    await walkDir(SRC_DIR, DIST_DIR);
    
    const elapsed = Date.now() - start;
    console.log(`\n✨ 编译完成！耗时 ${elapsed}ms`);
  } catch (error) {
    console.error('❌ 编译失败:', error);
    process.exit(1);
  }
}

main();