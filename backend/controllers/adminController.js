// ============================================================
// controllers/adminController.js
// جميع عمليات لوحة الإدارة (المستخدمين، الإيداعات، السحوبات)
// ============================================================

const { getDb } = require('../config/db');
const bcrypt = require('bcrypt');

// ====================== إدارة المستخدمين ======================

/**
 * الحصول على جميع المستخدمين (مع دعم البحث)
 */
async function getAllUsers(req, res) {
    try {
        const db = getDb();
        const { search } = req.query;
        let query = `
            SELECT id, username, fullName, email, balance, profit, level, 
                   createdAt, isVerified, origin, currentLocation, currentJob, work, profession 
            FROM users
        `;
        let params = [];
        if (search) {
            query += ' WHERE username LIKE ? OR email LIKE ? OR fullName LIKE ?';
            params = [`%${search}%`, `%${search}%`, `%${search}%`];
        }
        query += ' ORDER BY createdAt DESC';
        const [users] = await db.execute(query, params);
        res.json({ users, total: users.length });
    } catch (err) {
        console.error('❌ getAllUsers error:', err);
        res.status(500).json({ success: false, message: 'فشل جلب المستخدمين' });
    }
}

/**
 * الحصول على تفاصيل مستخدم محدد
 */
async function getUserDetails(req, res) {
    try {
        const db = getDb();
        const userId = req.params.id;
        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        }
        res.json({ success: true, user: rows[0] });
    } catch (err) {
        console.error('❌ getUserDetails error:', err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
}

/**
 * تعديل رصيد المستخدم
 */
async function setUserBalance(req, res) {
    try {
        const db = getDb();
        const { userId, newBalance } = req.body;
        if (!userId || newBalance === undefined) {
            return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
        }
        await db.execute('UPDATE users SET balance = ? WHERE id = ?', [parseFloat(newBalance), userId]);
        res.json({ success: true, message: 'تم تحديث الرصيد بنجاح' });
    } catch (err) {
        console.error('❌ setUserBalance error:', err);
        res.status(500).json({ success: false, message: 'فشل تحديث الرصيد' });
    }
}

/**
 * إعادة تعيين كلمة مرور المستخدم (بدون معرفة القديمة)
 */
async function resetUserPassword(req, res) {
    try {
        const db = getDb();
        const { userId, newPassword } = req.body;
        if (!userId || !newPassword) {
            return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
        }
        const hashed = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
        res.json({ success: true, message: 'تم إعادة تعيين كلمة المرور' });
    } catch (err) {
        console.error('❌ resetUserPassword error:', err);
        res.status(500).json({ success: false, message: 'فشل إعادة تعيين كلمة المرور' });
    }
}

// ====================== إدارة طلبات الإيداع ======================

/**
 * الحصول على طلبات الإيداع المعلقة (للأدمن)
 */
async function getPendingDeposits(req, res) {
    try {
        const db = getDb();
        const [rows] = await db.execute(
            'SELECT * FROM deposit_requests WHERE status = "pending" ORDER BY date DESC'
        );
        res.json(rows);
    } catch (err) {
        console.error('❌ getPendingDeposits error:', err);
        res.status(500).json({ success: false, message: 'فشل جلب طلبات الإيداع' });
    }
}

/**
 * معالجة طلب الإيداع (قبول / رفض)
 */
async function handleDeposit(req, res) {
    try {
        const db = getDb();
        const { id, action } = req.params;
        console.log(`[handleDeposit] ID: ${id}, Action: ${action}`);

        // جلب الطلب
        const [requestRows] = await db.execute('SELECT * FROM deposit_requests WHERE id = ?', [id]);
        if (requestRows.length === 0) {
            return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        }
        const request = requestRows[0];

        if (action === 'approve') {
            // إضافة المبلغ إلى رصيد المستخدم
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [request.amount, request.userId]);
            // تحديث حالة الطلب
            await db.execute('UPDATE deposit_requests SET status = "approved" WHERE id = ?', [id]);
            console.log(`✅ تم قبول الإيداع ${id} وأضيف ${request.amount} للمستخدم ${request.userId}`);
            return res.json({ success: true, message: 'تم قبول الإيداع وإضافة الرصيد' });
        } 
        else if (action === 'reject') {
            await db.execute('UPDATE deposit_requests SET status = "rejected" WHERE id = ?', [id]);
            console.log(`❌ تم رفض الإيداع ${id}`);
            return res.json({ success: true, message: 'تم رفض الإيداع' });
        } 
        else {
            return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
        }
    } catch (err) {
        console.error('❌ handleDeposit error:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء معالجة الطلب: ' + err.message });
    }
}

// ====================== إدارة طلبات السحب ======================

/**
 * الحصول على جميع طلبات السحب (عرض الكل للأدمن)
 */
async function getAllWithdrawals(req, res) {
    try {
        const db = getDb();
        const [rows] = await db.execute('SELECT * FROM withdrawal_requests ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        console.error('❌ getAllWithdrawals error:', err);
        res.status(500).json({ success: false, message: 'فشل جلب طلبات السحب' });
    }
}

/**
 * معالجة طلب السحب (قبول / رفض)
 */
async function handleWithdrawal(req, res) {
    try {
        const db = getDb();
        const { id, action } = req.params;
        console.log(`[handleWithdrawal] ID: ${id}, Action: ${action}`);

        // جلب الطلب
        const [requestRows] = await db.execute('SELECT * FROM withdrawal_requests WHERE id = ?', [id]);
        if (requestRows.length === 0) {
            return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        }
        const request = requestRows[0];
        console.log(`طلب السحب:`, request);

        if (action === 'approve') {
            await db.execute('UPDATE withdrawal_requests SET status = "approved" WHERE id = ?', [id]);
            console.log(`✅ تمت الموافقة على السحب ${id}`);
            return res.json({ success: true, message: 'تمت الموافقة على السحب' });
        } 
        else if (action === 'reject') {
            // إعادة المبلغ إلى رصيد المستخدم
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [request.amount, request.userId]);
            await db.execute('UPDATE withdrawal_requests SET status = "rejected" WHERE id = ?', [id]);
            console.log(`❌ تم رفض السحب ${id} وأعيد ${request.amount} للمستخدم ${request.userId}`);
            return res.json({ success: true, message: 'تم رفض السحب وإعادة المبلغ' });
        } 
        else {
            return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
        }
    } catch (err) {
        console.error('❌ handleWithdrawal error:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء معالجة الطلب: ' + err.message });
    }
}

// ====================== التحقق من صلاحية المدير ======================
async function verifyAdmin(req, res) {
    // يتم استدعاؤها بعد middleware authenticateToken
    // إذا وصلنا إلى هنا فالمستخدم إما admin أو admin_gateway
    if (req.user.role === 'admin' || req.user.type === 'admin_gateway') {
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false, message: 'غير مصرح' });
    }
}

module.exports = {
    getAllUsers,
    getUserDetails,
    setUserBalance,
    resetUserPassword,
    getPendingDeposits,
    handleDeposit,
    getAllWithdrawals,
    handleWithdrawal,
    verifyAdmin
};