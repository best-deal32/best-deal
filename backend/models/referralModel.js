// ============================================================
// models/referralModel.js
// عمليات الإحالات
// ============================================================

const { getDb } = require('../config/db');

async function recordReferralReward(referrerId, referredId, amount) {
    const db = getDb();
    const id = `REF_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    await db.execute(`
        INSERT INTO referrals 
        (id, referrerId, referredId, amount, createdAt)
        VALUES (?, ?, ?, ?, ?)`,
        [id, referrerId, referredId, amount, new Date()]
    );
}

async function getUserReferrals(referrerId) {
    const db = getDb();
    const [rows] = await db.execute(`
        SELECT u.username, u.email, u.createdAt, u.balance 
        FROM users u 
        WHERE u.referrerId = ?`, [referrerId]);
    return rows;
}

module.exports = {
    recordReferralReward,
    getUserReferrals
};