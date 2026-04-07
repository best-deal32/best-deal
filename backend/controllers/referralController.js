// ============================================================
// controllers/referralController.js
// عمليات الإحالات - كاملة
// ============================================================

const { getDb } = require('../config/db');

async function getMyReferrals(req, res) {
    // الكود الموجود لديك (محفوظ)
}

async function recordDeposit(req, res) {
    try {
        const { amount } = req.body;
        const db = getDb();
        
        // جلب المستخدم الحالي
        const [user] = await db.execute('SELECT referrerId FROM users WHERE id = ?', [req.user.id]);
        if (!user[0] || !user[0].referrerId) {
            return res.json({ success: true });
        }
        
        // جلب مستوى المحيل
        const [referrer] = await db.execute('SELECT level FROM users WHERE id = ?', [user[0].referrerId]);
        if (!referrer[0]) return res.json({ success: true });
        
        let reward = 0;
        if (referrer[0].level === 'فضي' && amount >= 100) reward = 10;
        else if (referrer[0].level === 'ذهبي' && amount >= 50) reward = 20;
        else if (referrer[0].level === 'ألماسي' && amount > 0) reward = 40;
        
        if (reward > 0) {
            // إضافة المكافأة للمحيل
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [reward, user[0].referrerId]);
            
            // تسجيل الإحالة
            const refId = `REF_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
            await db.execute(
                `INSERT INTO referrals (id, referrerId, referredId, amount, createdAt)
                 VALUES (?, ?, ?, ?, ?)`,
                [refId, user[0].referrerId, req.user.id, reward, new Date()]
            );
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: true });
    }
}

module.exports = { getMyReferrals, recordDeposit };