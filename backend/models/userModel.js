// ============================================================
// models/userModel.js
// جميع العمليات المتعلقة بجدول users
// ============================================================

const { getDb } = require('../config/db');
const bcrypt = require('bcrypt');
const config = require('../config');

/**
 * إنشاء مستخدم جديد
 */
async function createUser(userData) {
    const db = getDb();
    const id = `USER_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const hashedPassword = await bcrypt.hash(userData.password, config.SALT_ROUNDS);

    await db.execute(`
        INSERT INTO users 
        (id, username, password, fullName, email, origin, currentLocation, currentJob, 
         work, profession, referralCode, createdAt, isVerified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            userData.username,
            hashedPassword,
            userData.fullName,
            userData.email,
            userData.origin || 'غير محدد',
            userData.currentLocation || 'غير محدد',
            userData.currentJob || 'بدون عمل',
            userData.work || null,
            userData.profession || null,
            userData.referralCode || null,
            new Date(),
            0
        ]
    );

    return id;
}

/**
 * البحث عن مستخدم بواسطة username
 */
async function getUserByUsername(username) {
    const db = getDb();
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    return rows[0] || null;
}

/**
 * البحث عن مستخدم بواسطة ID
 */
async function getUserById(id) {
    const db = getDb();
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] || null;
}

/**
 * تحديث رصيد المستخدم
 */
async function updateBalance(userId, newBalance) {
    const db = getDb();
    await db.execute('UPDATE users SET balance = ? WHERE id = ?', [newBalance, userId]);
}

/**
 * تحديث الربح (profit)
 */
async function updateProfit(userId, newProfit) {
    const db = getDb();
    await db.execute('UPDATE users SET profit = ? WHERE id = ?', [newProfit, userId]);
}

/**
 * زيادة عدد محاولات الدخول
 */
async function incrementLoginAttempts(userId) {
    const db = getDb();
    await db.execute('UPDATE users SET loginAttempts = loginAttempts + 1 WHERE id = ?', [userId]);
}

module.exports = {
    createUser,
    getUserByUsername,
    getUserById,
    updateBalance,
    updateProfit,
    incrementLoginAttempts
};