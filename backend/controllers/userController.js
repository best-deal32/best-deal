// ============================================================
// controllers/userController.js
// عمليات المستخدم (الحصول على بيانات المستخدم الحالي)
// ============================================================

const { getDb } = require('../config/db');

/**
 * الحصول على بيانات المستخدم المسجل حالياً (me)
 */
async function getMe(req, res) {
    try {
        // req.user يجب أن يكون موجوداً بعد تمريره عبر middleware authenticateToken
        const userId = req.user.id;
        const db = getDb();

        const [rows] = await db.execute(
            `SELECT id, username, fullName, email, balance, profit, level, isVerified, referralCode, createdAt
             FROM users WHERE id = ?`,
            [userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }

        const user = rows[0];
        res.json(user);
    } catch (err) {
        console.error('❌ خطأ في getMe:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
}

module.exports = { getMe };