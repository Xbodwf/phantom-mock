import { connectDB, disconnectDB } from '../db';
import * as usersDB from '../db/users';

/**
 * 生成有效的UID
 * 规则：仅允许字母、数字、下划线，不允许空格和特殊符号
 */
function generateUid(username: string): string {
  // 移除特殊符号，只保留字母、数字、下划线
  let uid = username
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .trim();

  // 如果为空，使用默认前缀
  if (!uid) {
    uid = 'user_' + Math.random().toString(36).substring(2, 8);
  }

  return uid;
}

async function migrateUserUids() {
  try {
    console.log('🚀 Starting user UID migration...\n');

    const db = await connectDB();
    console.log('✅ Connected to MongoDB\n');

    const users = await usersDB.getAllUsers();
    console.log(`Found ${users.length} users to migrate\n`);

    const usedUids = new Set<string>();
    let migratedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      // 如果已有uid，跳过
      if (user.uid) {
        console.log(`⏭️  User ${user.username} already has uid: ${user.uid}`);
        usedUids.add(user.uid);
        skippedCount++;
        continue;
      }

      // 生成uid
      let uid = generateUid(user.username);

      // 确保uid唯一
      let counter = 1;
      const originalUid = uid;
      while (usedUids.has(uid)) {
        uid = `${originalUid}_${counter}`;
        counter++;
      }

      // 更新用户
      try {
        await usersDB.updateUser(user.id, { uid });
        usedUids.add(uid);
        console.log(`✅ User ${user.username} -> uid: @${uid}`);
        migratedCount++;
      } catch (error) {
        console.error(`❌ Failed to update user ${user.username}:`, error);
      }
    }

    console.log(`\n🎉 Migration completed!`);
    console.log(`   Migrated: ${migratedCount}`);
    console.log(`   Skipped: ${skippedCount}`);

    await disconnectDB();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateUserUids();
