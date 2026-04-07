// ============================================================
// controllers/depositController.js
// عمليات الإيداع
// ============================================================

const { getDb } = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// إعداد مجلد رفع الصور
const uploadDir = path.join(__dirname, '../private_uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// إعداد multer للتخزين المؤقت
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('يسمح فقط برفع الصور'), false);
    }
});

// إضافة طلب إيداع
async function addDeposit(req, res) {
    try {
        const { amount, method = 'USDT' } = req.body;
        const screenshot = req.file;
        const db = getDb();

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر' });
        }
        if (!screenshot) {
            return res.status(400).json({ success: false, message: 'يجب إرفاق صورة إثبات التحويل' });
        }

        const id = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const screenshotPath = `/private_uploads/${screenshot.filename}`;

        await db.execute(`
            INSERT INTO deposit_requests 
            (id, userId, username, amount, method, screenshotPath, date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [id, req.user.id, req.user.username, parseFloat(amount), method, screenshotPath, new Date()]
        );

        res.json({ success: true, message: 'تم إرسال طلب الإيداع بنجاح، يرجى انتظار المراجعة' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء معالجة الإيداع' });
    }
}

// جلب طلبات الإيداع المعلقة (للوحة الأدمن)
async function getPendingDeposits(req, res) {
    try {
        const db = getDb();
        const [rows] = await db.execute('SELECT * FROM deposit_requests WHERE status = "pending" ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل جلب طلبات الإيداع' });
    }
}

module.exports = { addDeposit, getPendingDeposits, upload };