import { Router, Request, Response, NextFunction } from 'express';
import { hashPassword, verifyPassword, generateToken, generateRefreshToken, verifyRefreshToken } from '../auth.js';
import { 
  createUser, 
  getUserByUsername, 
  getUserByEmail, 
  updateUser, 
  getSettings,
  getUserByInviteCode,
  getAvailableInviteQuota,
  generateInviteCode,
  createInvitationRecord,
  loadInvitationRecords,
  loadUsers
} from '../storage.js';
import { authMiddleware, AuthRequest } from '../middleware.js';
import { generateVerificationCode, sendVerificationEmail, storeVerificationCode, verifyCode } from '../email.js';

const router: Router = Router();

/**
 * 发送验证码
 */
router.post('/send-verification-code', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // 检查邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // 检查邮箱是否已被注册
    if (getUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const settings = await getSettings();

    // 如果未启用邮箱验证，直接返回成功
    if (!settings.emailVerificationEnabled) {
      return res.json({ success: true, message: 'Email verification is disabled' });
    }

    // 生成验证码
    const code = generateVerificationCode();

    // 发送邮件
    const sent = await sendVerificationEmail(email, code);

    if (!sent) {
      return res.status(500).json({ error: 'Failed to send verification email' });
    }

    // 存储验证码
    storeVerificationCode(email, code);

    res.json({ success: true, message: 'Verification code sent' });
  } catch (error) {
    console.error('[Send Verification Code Error]', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/**
 * 用户注册
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password, verificationCode, inviteCode } = req.body;

    // 验证输入
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // 检查邀请码（现在邀请码是必需的）
    if (!inviteCode) {
      return res.status(400).json({ error: 'Invite code is required' });
    }

    // 确保数据已加载
    await loadUsers();
    await loadInvitationRecords();

    // 验证邀请码
    const inviter = getUserByInviteCode(inviteCode);
    if (!inviter) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }

    // 检查邀请人是否有可用邀请次数
    const availableQuota = getAvailableInviteQuota(inviter.id);
    if (availableQuota <= 0) {
      return res.status(400).json({ error: 'Invite code has no remaining quota' });
    }

    // 检查用户是否已存在
    if (getUserByUsername(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    if (getUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // 检查是否需要邮箱验证
    const settings = await getSettings();
    if (settings.emailVerificationEnabled) {
      if (!verificationCode) {
        return res.status(400).json({ error: 'Verification code is required' });
      }

      // 验证验证码
      if (!verifyCode(email, verificationCode)) {
        return res.status(400).json({ error: 'Invalid or expired verification code' });
      }
    }

    // 创建用户（包含邀请码和邀请人信息）
    const passwordHash = await hashPassword(password);
    const userInviteCode = generateInviteCode();
    
    const user = await createUser({
      username,
      email,
      passwordHash,
      balance: 0,
      totalUsage: 0,
      enabled: true,
      role: 'user',
      inviteCode: userInviteCode,
      invitedBy: inviter.id,
      createdAt: Date.now(),
    });

    // 创建邀请记录
    await createInvitationRecord({
      inviterId: inviter.id,
      inviteeId: user.id,
      inviteCode: inviteCode,
    });

    // 如果邀请人是普通用户且有额外邀请次数，扣除一次
    if (inviter.role !== 'admin' && inviter.extraInviteQuota && inviter.extraInviteQuota > 0) {
      await updateUser(inviter.id, {
        extraInviteQuota: inviter.extraInviteQuota - 1,
      });
    }

    // 生成 token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const refreshToken = generateRefreshToken(user.id);

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        balance: user.balance,
        enabled: user.enabled,
        totalUsage: user.totalUsage,
        createdAt: user.createdAt,
        inviteCode: user.inviteCode,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error('[Register Error]', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * 用户登录
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const user = getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.enabled) {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // 更新最后登录时间
    await updateUser(user.id, { lastLoginAt: Date.now() });

    // 生成 token
    const token = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const refreshToken = generateRefreshToken(user.id);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        balance: user.balance,
        enabled: user.enabled,
        totalUsage: user.totalUsage,
        createdAt: user.createdAt,
        inviteCode: user.inviteCode,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    console.error('[Login Error]', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * 刷新 token
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Missing refresh token' });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // 生成新的 token
    const user = require('../storage.js').getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const newToken = generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    res.json({ token: newToken });
  } catch (error) {
    console.error('[Refresh Error]', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * 获取当前用户信息
 */
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { getUserById } = await import('../storage.js');
    const user = getUserById(req.userId!);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      balance: user.balance,
      totalUsage: user.totalUsage,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      inviteCode: user.inviteCode,
      invitedBy: user.invitedBy,
      extraInviteQuota: user.extraInviteQuota,
    });
  } catch (error) {
    console.error('[Get Me Error]', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * 用户登出
 */
router.post('/logout', authMiddleware, (req: AuthRequest, res: Response) => {
  // JWT 是无状态的，登出只需要客户端删除 token
  res.json({ message: 'Logged out successfully' });
});

export default router;
