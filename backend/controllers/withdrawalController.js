// ============================================================
// controllers/withdrawalController.js
// عمليات السحب (بدون رمز تحقق)
// ============================================================

const { getDb } = require('../config/db');

// تقديم طلب سحب (بدون رمز تأكيد)
async function addWithdrawal(req, res) {
    try {
        const { walletAddress, amount } = req.body;
        const db = getDb();
        const userId = req.user.id;
        const username = req.user.username;

        if (!walletAddress || !amount) {
            return res.status(400).json({ success: false, message: 'عنوان المحفظة والمبلغ مطلوبان' });
        }

        const withdrawalAmount = parseFloat(amount);
        if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
            return res.status(400).json({ success: false, message: 'المبلغ غير صالح' });
        }

        // التحقق من الرصيد
        const [userRows] = await db.execute('SELECT balance FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        if (userRows[0].balance < withdrawalAmount) {
            return res.status(400).json({ success: false, message: 'رصيد غير كافٍ' });
        }

        // خصم المبلغ فوراً (سيتم إعادته إذا رفض الأدمن)
        await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [withdrawalAmount, userId]);

        const withdrawalId = `WIT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await db.execute(`
            INSERT INTO withdrawal_requests 
            (id, userId, username, amount, walletAddress, status, date)
            VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
            [withdrawalId, userId, username, withdrawalAmount, walletAddress]
        );

        res.json({ success: true, message: 'تم تقديم طلب السحب بنجاح، سيتم مراجعته من قبل الإدارة' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء تقديم طلب السحب' });
    }
}

module.exports = { addWithdrawal };