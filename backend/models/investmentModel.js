// ============================================================
// models/investmentModel.js
// عمليات الاستثمارات
// ============================================================

const { getDb } = require('../config/db');

async function createInvestment(userId, username, amount, projectType) {
    const db = getDb();
    const id = `INV_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    await db.execute(`
        INSERT INTO investments 
        (id, userId, username, amount, projectType, startDate, lastProfitDate)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, username, amount, projectType, new Date(), new Date()]
    );

    return id;
}

async function getUserInvestments(userId) {
    const db = getDb();
    const [rows] = await db.execute('SELECT * FROM investments WHERE userId = ?', [userId]);
    return rows;
}

module.exports = {
    createInvestment,
    getUserInvestments
};