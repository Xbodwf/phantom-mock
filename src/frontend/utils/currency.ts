/**
 * 格式化虚拟货币显示
 * @param amount 金额
 * @returns 格式化后的货币字符串
 */
export function formatCurrency(amount: number): string {
  return `🔮${rawDecimal(amount)}`;
}

/**
 * 格式化虚拟货币显示（简化版，用于显示）
 * @param amount 金额
 * @returns 格式化后的货币字符串
 */
export function formatCurrencyShort(amount: number): string {
  return `🔮${rawDecimal(amount)}`;
}

/** 保留完整小数位，仅去掉尾部多余的零 */
function rawDecimal(n: number): string {
  const s = n.toFixed(10);
  const trimmed = s.replace(/\.?0+$/, '');
  return trimmed.length > 1 ? trimmed : '0';
}
