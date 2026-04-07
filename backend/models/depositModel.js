// ============================================================
// models/depositModel.js
// عمليات الإيداعات والطلبات
// ============================================================

const { getDb } = require('../config/db');

async function createDepositRequest(userId, username, amount, method, screenshotPath) {
    const db = getDb();
    const id = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    await db.execute(`
        INSERT INTO deposit_requests 
        (id, userId, username, amount, method, screenshotPath, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, username, amount, method, screenshotPath, new Date()]
    );

    return id;
}

async function getPendingDeposits() {
    const db = getDb();
    const [rows] = await db.execute('SELECT * FROM deposit_requests WHERE status = "pending" ORDER BY date DESC');
    return rows;
}

async function approveDeposit(depositId) {
    const db = getDb();
    await db.execute('UPDATE deposit_requests SET status = "approved" WHERE id = ?', [depositId]);
}

async function rejectDeposit(depositId) {
    const db = getDb();
    await db.execute('UPDATE deposit_requests SET status = "rejected" WHERE id = ?', [depositId]);
}

module.exports = {
    createDepositRequest,
    getPendingDeposits,
    approveDeposit,
    rejectDeposit
};