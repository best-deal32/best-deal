// ============================================================
// controllers/investmentController.js
// عمليات الاستثمارات - كاملة
// ============================================================

const { getDb } = require('../config/db');

async function createInvestment(req, res) {
    // الكود الموجود لديك (محفوظ)
}

async function getMyInvestments(req, res) {
    try {
        const db = getDb();
        const [investments] = await db.execute(
            'SELECT * FROM investments WHERE userId = ? ORDER BY startDate DESC',
            [req.user.id]
        );
        
        // حساب الربح الحالي لكل استثمار
        const now = new Date();
        const results = [];
        
        for (const inv of investments) {
            const start = new Date(inv.startDate);
            const lastProfit = inv.lastProfitDate ? new Date(inv.lastProfitDate) : start;
            const diffDays = Math.floor((now - lastProfit) / (1000 * 60 * 60 * 24));
            let currentProfit = 0;
            let canWithdrawPrincipal = false;
            
            if (inv.projectType === 'daily') {
                currentProfit = inv.amount * 0.15 * diffDays;
                canWithdrawPrincipal = (now - start) / (1000 * 60 * 60 * 24) >= 10;
            } else if (inv.projectType === 'weekly') {
                currentProfit = diffDays >= 7 ? inv.amount * 0.7 : 0;
                canWithdrawPrincipal = (now - start) / (1000 * 60 * 60 * 24) >= 10;
            } else if (inv.projectType === 'monthly') {
                currentProfit = diffDays >= 30 ? inv.amount * 1.5 : 0;
                canWithdrawPrincipal = diffDays >= 30;
            }
            
            results.push({
                ...inv,
                currentProfit,
                canWithdrawPrincipal,
                withdrawnPrincipal: !!inv.withdrawnPrincipal
            });
        }
        
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
}

async function withdrawProfit(req, res) {
    try {
        const { investmentId } = req.body;
        const db = getDb();
        
        // جلب بيانات الاستثمار
        const [inv] = await db.execute(
            'SELECT * FROM investments WHERE id = ? AND userId = ?',
            [investmentId, req.user.id]
        );
        if (inv.length === 0) {
            return res.status(404).json({ success: false, message: 'الاستثمار غير موجود' });
        }
        
        const investment = inv[0];
        const now = new Date();
        const start = new Date(investment.startDate);
        const lastProfit = investment.lastProfitDate ? new Date(investment.lastProfitDate) : start;
        const diffDays = Math.floor((now - lastProfit) / (1000 * 60 * 60 * 24));
        
        let profit = 0;
        if (investment.projectType === 'daily') profit = investment.amount * 0.15 * diffDays;
        else if (investment.projectType === 'weekly') profit = diffDays >= 7 ? investment.amount * 0.7 : 0;
        else if (investment.projectType === 'monthly') profit = diffDays >= 30 ? investment.amount * 1.5 : 0;
        
        if (profit <= 0) {
            return res.status(400).json({ success: false, message: 'لا توجد أرباح جديدة للسحب' });
        }
        
        // إضافة الربح إلى رصيد المستخدم
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [profit, req.user.id]);
        
        // تحديث سجل الاستثمار
        await db.execute(
            'UPDATE investments SET withdrawnProfit = withdrawnProfit + ?, lastProfitDate = ? WHERE id = ?',
            [profit, new Date(), investmentId]
        );
        
        res.json({ success: true, message: `تم سحب ${profit}$ من الأرباح` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء سحب الأرباح' });
    }
}

async function withdrawPrincipal(req, res) {
    try {
        const { investmentId } = req.body;
        const db = getDb();
        
        const [inv] = await db.execute(
            'SELECT * FROM investments WHERE id = ? AND userId = ?',
            [investmentId, req.user.id]
        );
        if (inv.length === 0) {
            return res.status(404).json({ success: false, message: 'الاستثمار غير موجود' });
        }
        
        const investment = inv[0];
        const now = new Date();
        const start = new Date(investment.startDate);
        const daysPassed = (now - start) / (1000 * 60 * 60 * 24);
        
        let canWithdraw = false;
        if (investment.projectType === 'daily') canWithdraw = daysPassed >= 10;
        else if (investment.projectType === 'weekly') canWithdraw = daysPassed >= 10;
        else if (investment.projectType === 'monthly') canWithdraw = daysPassed >= 30;
        
        if (!canWithdraw) {
            return res.status(400).json({ success: false, message: 'المبلغ الأصلي غير متاح للسحب بعد' });
        }
        
        if (investment.withdrawnPrincipal) {
            return res.status(400).json({ success: false, message: 'تم سحب المبلغ الأصلي مسبقاً' });
        }
        
        // إعادة المبلغ الأصلي إلى رصيد المستخدم
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [investment.amount, req.user.id]);
        
        // تحديث حالة الاستثمار
        await db.execute('UPDATE investments SET withdrawnPrincipal = 1 WHERE id = ?', [investmentId]);
        
        res.json({ success: true, message: `تم سحب ${investment.amount}$ من رأس المال` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء سحب رأس المال' });
    }
}

module.exports = {
    createInvestment,
    getMyInvestments,
    withdrawProfit,
    withdrawPrincipal
};