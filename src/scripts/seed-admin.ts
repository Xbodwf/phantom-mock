import { connectDB, disconnectDB, usersDB } from '../db';
import * as bcrypt from 'bcryptjs';

async function seedAdmin() {
  try {
    console.log('🚀 Creating default admin account...\n');

    const db = await connectDB();
    console.log('✅ Connected to MongoDB\n');

    // Check if admin already exists
    const existingAdmin = await usersDB.getUserByUsername('admin');
    if (existingAdmin) {
      console.log('⚠️  Admin account already exists, skipping...');
      await disconnectDB();
      return;
    }

    // Create default admin account
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = await usersDB.createUser({
      username: 'admin',
      email: 'admin@phantom.local',
      passwordHash: hashedPassword,
      uid: 'admin',
      balance: 1000000, // Large initial balance for testing
      totalUsage: 0,
      createdAt: Date.now(),
      enabled: true,
      role: 'admin',
    });

    console.log('✅ Default admin account created');
    console.log(`   Username: admin`);
    console.log(`   Password: admin123`);
    console.log(`   Email: admin@phantom.local`);
    console.log(`   Initial Balance: 1,000,000 🔮\n`);

    console.log('🎉 Admin seeding completed!');
    await disconnectDB();
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
}

seedAdmin();
