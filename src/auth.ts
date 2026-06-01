import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { NodeTokenPayload } from './types.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
// 加密密钥：优先用环境变量，否则从 JWT_SECRET 派生（保证重启后稳定）
const TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY
  ? process.env.TOKEN_ENCRYPTION_KEY.slice(0, 32)
  : crypto.createHash('sha256').update(JWT_SECRET).digest('hex').slice(0, 32);

function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', TOKEN_ENCRYPTION_KEY, iv);
  let enc = cipher.update(plain, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decryptToken(encrypted: string): string | null {
  try {
    const [ivHex, data] = encrypted.split(':');
    if (!ivHex || !data) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', TOKEN_ENCRYPTION_KEY, iv);
    let dec = decipher.update(data, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return null;
  }
}

export interface JWTPayload {
  userId: string;
  username: string;
  role: 'user' | 'admin';
  iat?: number;
  exp?: number;
}

/**
 *生成密码哈希
 */
export async function hashPassword(password: string): Promise<string> {
 const salt = await bcrypt.genSalt(10);
 return bcrypt.hash(password, salt);
}

/**
 * 验证密码
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
 return bcrypt.compare(password, hash);
}

/**
 * 生成加密 JWT token（payload 对外不可见）
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, expiresIn: string = '24h'): string {
  const jwtToken = jwt.sign(payload, JWT_SECRET, { expiresIn } as SignOptions);
  return encryptToken(jwtToken);
}

/**
 *生成刷新 token
 */
export function generateRefreshToken(userId: string, expiresIn: string = '7d'): string {
  const jwtToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn } as SignOptions);
  return encryptToken(jwtToken);
}

/**
 * 验证加密 JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const decrypted = decryptToken(token);
    if (!decrypted) return null;
    const decoded = jwt.verify(decrypted, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 *生成节点连接 token
 */
export function generateNodeToken(
  payload: { nodeId: string; tokenVersion: number },
  expiresIn: string = '30d',
): string {
  const jwtToken = jwt.sign(
    { nodeId: payload.nodeId, role: 'node', tokenVersion: payload.tokenVersion },
    JWT_SECRET,
    { expiresIn } as SignOptions,
  );
  return encryptToken(jwtToken);
}

/**
 * 验证节点连接 token
 */
export function verifyNodeToken(token: string): NodeTokenPayload | null {
  try {
    const decrypted = decryptToken(token);
    if (!decrypted) return null;
    const decoded = jwt.verify(decrypted, JWT_SECRET) as NodeTokenPayload;
    if (decoded.role !== 'node' || !decoded.nodeId) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * 验证刷新 token
 */
export function verifyRefreshToken(token: string): { userId: string } | null {
  try {
    const decrypted = decryptToken(token);
    if (!decrypted) return null;
    const decoded = jwt.verify(decrypted, JWT_REFRESH_SECRET) as { userId: string };
    return decoded;
  } catch {
    return null;
  }
}

/**
 * 从 Authorization header 中提取 token
 */
export function extractTokenFromHeader(authHeader?: string): string | null {
 if (!authHeader) return null;
 const parts = authHeader.split(' ');
 if (parts.length !==2 || parts[0] !== 'Bearer') return null;
 return parts[1];
}
