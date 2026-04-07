// ============================================================
// models/withdrawalModel.js
// عمليات السحب
// ============================================================

const { getDb } = require('../config/db');

async function createWithdrawalRequest(userId, username, amount, walletAddress, confirmationCode) {
    const db = getDb();
    const id = `WIT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    await db.execute(`
        INSERT INTO withdrawal_requests 
        (id, userId, username, amount, walletAddress, confirmationCode, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, username, amount, walletAddress, confirmationCode, new Date()]
    );

    return id;
}

async function getPendingWithdrawals() {
    const db = getDb();
    const [rows] = await db.execute('SELECT * FROM withdrawal_requests WHERE status = "pending" ORDER BY date DESC');
    return rows;
}

module.exports = {
    createWithdrawalRequest,
    getPendingWithdrawals
};