// ============================================================
// models/wheelModel.js
// عمليات عجلة الحظ
// ============================================================

const { getDb } = require('../config/db');

async function recordWheelWin(userId, username, betAmount, winAmount, multiplier) {
    const db = getDb();
    const id = `WIN_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    await db.execute(`
        INSERT INTO wheel_wins 
        (id, userId, username, betAmount, winAmount, multiplier, date)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, username, betAmount, winAmount, multiplier, new Date()]
    );

    return id;
}

async function getTopWins(limit = 10) {
    const db = getDb();
    const [rows] = await db.execute(`
        SELECT username, winAmount 
        FROM wheel_wins 
        ORDER BY winAmount DESC 
        LIMIT ?`, [limit]);
    return rows;
}

module.exports = {
    recordWheelWin,
    getTopWins
};