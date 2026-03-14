import emailjs from '@emailjs/nodejs';
import { getSettings } from './storage.js';

// 验证码存储（内存中，5分钟过期）
const verificationCodes = new Map<string, { code: string; expiresAt: number }>();

/**
 * 生成6位数字验证码
 */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送验证码邮件
 */
export async function sendVerificationEmail(email: string, code: string): Promise<boolean> {
  try {
    const settings = await getSettings();

    // 检查是否启用邮箱验证
    if (!settings.emailVerificationEnabled) {
      console.log('[Email] Email verification is disabled');
      return true; // 未启用时直接返回成功
    }

    // 检查 EmailJS 配置
    if (!settings.emailjs?.serviceId || !settings.emailjs?.templateId || !settings.emailjs?.publicKey || !settings.emailjs?.privateKey) {
      console.error('[Email] EmailJS configuration is incomplete');
      return false;
    }

    // 发送邮件
    const response = await emailjs.send(
      settings.emailjs.serviceId,
      settings.emailjs.templateId,
      {
        to_email: email,
        verification_code: code,
        to_name: email.split('@')[0],
      },
      {
        publicKey: settings.emailjs.publicKey,
        privateKey: settings.emailjs.privateKey,
      }
    );

    console.log('[Email] Verification email sent successfully:', response);
    return true;
  } catch (error) {
    console.error('[Email] Failed to send verification email:', error);
    return false;
  }
}

/**
 * 存储验证码（5分钟有效期）
 */
export function storeVerificationCode(email: string, code: string): void {
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5分钟
  verificationCodes.set(email.toLowerCase(), { code, expiresAt });

  // 自动清理过期验证码
  setTimeout(() => {
    verificationCodes.delete(email.toLowerCase());
  }, 5 * 60 * 1000);
}

/**
 * 验证验证码
 */
export function verifyCode(email: string, code: string): boolean {
  const stored = verificationCodes.get(email.toLowerCase());

  if (!stored) {
    return false;
  }

  if (Date.now() > stored.expiresAt) {
    verificationCodes.delete(email.toLowerCase());
    return false;
  }

  if (stored.code !== code) {
    return false;
  }

  // 验证成功后删除验证码
  verificationCodes.delete(email.toLowerCase());
  return true;
}

/**
 * 清理过期的验证码（定时任务）
 */
export function cleanupExpiredCodes(): void {
  const now = Date.now();
  for (const [email, data] of verificationCodes.entries()) {
    if (now > data.expiresAt) {
      verificationCodes.delete(email);
    }
  }
}

// 每分钟清理一次过期验证码
setInterval(cleanupExpiredCodes, 60 * 1000);
