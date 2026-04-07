// ============================================================
// server.js - النسخة النهائية (Frontend داخل مجلد public)
// ============================================================

const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const dns = require('dns').promises;
const cron = require('node-cron');
const { exec } = require('child_process');
const cloudinary = require('cloudinary').v2;
const Sentry = require('@sentry/node');

require('dotenv').config();

// ====================== التحقق من صحة DSN قبل تهيئة Sentry ======================
const SENTRY_DSN = process.env.SENTRY_DSN;
const isValidSentryDsn = SENTRY_DSN && SENTRY_DSN.startsWith('https://') && SENTRY_DSN.includes('@sentry.io') && !SENTRY_DSN.includes('your-sentry-dsn');

if (isValidSentryDsn) {
    Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 1.0 });
    console.log('✅ Sentry initialized');
} else {
    console.log('⚠️ Sentry not configured (invalid or missing DSN)');
}

// ====================== إعدادات البيئة ======================
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'BestDealGoldSystem_SuperSecretKey_2026_!@#$%';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'BestDealRefreshSecret_2026_!@#$%';
const ADMIN_GATEWAY_SECRET = process.env.ADMIN_GATEWAY_SECRET || 'MHDFREEZE2003';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'bestdeal';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;

// ====================== تهيئة Cloudinary ======================
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    console.log('☁️ Cloudinary configured');
} else {
    console.warn('⚠️ Cloudinary not configured (missing credentials)');
}

const app = express();

// ====================== Middleware ======================
app.use(cors({ origin: 'http://localhost:5000', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ====================== Rate Limiting ======================
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { success: false, message: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { success: false, message: 'Too many attempts' } });
const depositLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5, message: { success: false, message: 'Max 5 deposit requests per day' } });
const withdrawLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3, message: { success: false, message: 'Max 3 withdrawal requests per day' } });

app.use('/api/', globalLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/deposits/add', depositLimiter);
app.use('/api/withdrawals/add', withdrawLimiter);

// ====================== قاعدة البيانات ======================
let db;

async function initDatabase() {
    try {
        db = await mysql.createConnection({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            port: DB_PORT,
            multipleStatements: true
        });
        console.log('✅ تم الاتصال بقاعدة البيانات MySQL');

        // إنشاء الجداول (مع إضافة جدول admin_actions)
        await db.execute(`CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(50) PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'user',
            fullName VARCHAR(100),
            email VARCHAR(100) UNIQUE NOT NULL,
            origin VARCHAR(100),
            currentLocation VARCHAR(100),
            currentJob VARCHAR(100),
            work VARCHAR(100),
            profession VARCHAR(100),
            balance DECIMAL(10,2) DEFAULT 0,
            profit DECIMAL(10,2) DEFAULT 0,
            level VARCHAR(20) DEFAULT 'برونزي',
            createdAt DATETIME,
            isVerified TINYINT DEFAULT 0,
            referralCode VARCHAR(50) UNIQUE,
            refreshToken VARCHAR(255),
            loginAttempts INT DEFAULT 0,
            lockUntil DATETIME
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS deposit_requests (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            username VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            method VARCHAR(50),
            status VARCHAR(20) DEFAULT 'pending',
            screenshotPath VARCHAR(255),
            date DATETIME NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            username VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            walletAddress VARCHAR(255) NOT NULL,
            status VARCHAR(20) DEFAULT 'pending',
            date DATETIME NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS investments (
            id VARCHAR(50) PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            username VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            projectType VARCHAR(20) NOT NULL,
            startDate DATETIME NOT NULL,
            lastProfitDate DATETIME,
            withdrawnProfit DECIMAL(10,2) DEFAULT 0,
            withdrawnPrincipal TINYINT DEFAULT 0,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS referrals (
            id VARCHAR(50) PRIMARY KEY,
            referrerId VARCHAR(50) NOT NULL,
            referredId VARCHAR(50) NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            createdAt DATETIME NOT NULL,
            FOREIGN KEY (referrerId) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (referredId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS activity_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            userId VARCHAR(50),
            action VARCHAR(255),
            details TEXT,
            ip VARCHAR(45),
            timestamp DATETIME,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            userId VARCHAR(50) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            isRead TINYINT DEFAULT 0,
            createdAt DATETIME NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        await db.execute(`CREATE TABLE IF NOT EXISTS admin_actions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            adminId VARCHAR(50) NOT NULL,
            adminUsername VARCHAR(50) NOT NULL,
            actionType VARCHAR(50) NOT NULL,
            targetUserId VARCHAR(50),
            targetUsername VARCHAR(50),
            details TEXT,
            ip VARCHAR(45),
            timestamp DATETIME,
            FOREIGN KEY (adminId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // إضافة المستخدم freeze
        const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', ['freeze']);
        if (existing.length === 0) {
            const hashedPassword = await bcrypt.hash('MHDFREEZE0619', 10);
            await db.execute(
                `INSERT INTO users (id, username, password, role, email, fullName, balance, createdAt, isVerified, referralCode, origin, currentLocation, currentJob, level)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1, ?, 'سوريا', 'دمشق', 'مطور', 'ألماسي')`,
                ['FREEZE_ID', 'freeze', hashedPassword, 'admin', 'freeze@bestdeal.com', 'Freeze Admin', 50000, 'freeze_ref']
            );
            console.log('✅ تم إدراج المستخدم freeze (مستوى ألماسي)');
        } else {
            console.log('✅ المستخدم freeze موجود بالفعل');
        }
    } catch (err) {
        console.error('❌ فشل تهيئة قاعدة البيانات:', err.message);
        process.exit(1);
    }
}

// دوال مساعدة للاستعلامات
async function runQuery(sql, params) {
    const [result] = await db.execute(sql, params);
    return result;
}
async function getQuery(sql, params) {
    const [rows] = await db.execute(sql, params);
    return rows[0];
}
async function allQuery(sql, params) {
    const [rows] = await db.execute(sql, params);
    return rows;
}

// ====================== دوال المصادقة ======================
function generateToken(userId, username, role) {
    return jwt.sign({ id: userId, username, role }, JWT_SECRET, { expiresIn: '15m' });
}
function generateRefreshToken(userId) {
    return jwt.sign({ id: userId }, REFRESH_SECRET, { expiresIn: '7d' });
}

async function authenticateToken(req, res, next) {
    let token = req.cookies?.token;
    if (!token) {
        const authHeader = req.headers['authorization'];
        token = authHeader && authHeader.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'غير مصرح' });
    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: 'توكن غير صالح' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'صلاحيات مدير مطلوبة' });
    next();
}

async function logAdminAction(adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip) {
    try {
        await runQuery(
            `INSERT INTO admin_actions (adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip]
        );
    } catch (err) {
        console.error('خطأ في تسجيل إجراء الأدمن:', err);
    }
}

// ====================== دالة تحديث رتبة المستخدم بناءً على الرصيد ======================
async function updateUserLevel(userId) {
    try {
        const [user] = await db.execute('SELECT balance FROM users WHERE id = ?', [userId]);
        if (!user.length) return;
        const balance = parseFloat(user[0].balance);
        let newLevel = 'برونزي';
        if (balance >= 5000) newLevel = 'ألماسي';
        else if (balance >= 1000) newLevel = 'ذهبي';
        else if (balance >= 200) newLevel = 'فضي';
        // else برونزي

        const [levelRow] = await db.execute('SELECT level FROM users WHERE id = ?', [userId]);
        const currentLevel = levelRow[0]?.level;
        if (currentLevel !== newLevel) {
            await db.execute('UPDATE users SET level = ? WHERE id = ?', [newLevel, userId]);
            console.log(`✅ تم ترقية المستخدم ${userId} إلى المستوى ${newLevel}`);
            await runQuery(
                `INSERT INTO notifications (userId, title, message, createdAt, isRead) VALUES (?, ?, ?, NOW(), 0)`,
                [userId, 'ترقية المستوى', `تهانينا! تمت ترقيتك إلى المستوى ${newLevel}`, newLevel]
            );
        }
    } catch (err) {
        console.error('خطأ في تحديث رتبة المستخدم:', err);
    }
}

// ====================== إعداد رفع الصور باستخدام Cloudinary ======================
const memoryStorage = multer.memoryStorage();
const upload = multer({
    storage: memoryStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('يسمح فقط برفع الصور'), false);
    }
});

async function uploadToCloudinary(buffer, originalName) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'deposit_screenshots',
                allowed_formats: ['jpg', 'png', 'jpeg'],
                public_id: `deposit_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`
            },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
}

// ====================== مسار تسجيل الدخول ======================
app.post('/api/users/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });

        const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            await runQuery('UPDATE users SET loginAttempts = loginAttempts + 1 WHERE id = ?', [user.id]);
            return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
        }
        await runQuery('UPDATE users SET loginAttempts = 0 WHERE id = ?', [user.id]);

        const token = generateToken(user.id, user.username, user.role);
        const refreshToken = generateRefreshToken(user.id);
        await runQuery('UPDATE users SET refreshToken = ? WHERE id = ?', [refreshToken, user.id]);

        res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 15 * 60 * 1000 });
        res.cookie('refreshToken', refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });

        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ====================== الحصول على بيانات المستخدم الحالي ======================
app.get('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery('SELECT id, username, role, fullName, email, balance, profit, level, isVerified, origin, currentLocation, currentJob, work, profession, referralCode FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        const withdrawableAmount = (user.balance || 0) + (user.profit || 0);
        res.json({ ...user, withdrawableAmount });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ====================== مسار الإيداع ======================
app.post('/api/deposits/add', authenticateToken, upload.single('screenshot'), async (req, res) => {
    try {
        const { amount, method = 'USDT' } = req.body;
        const file = req.file;
        if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر' });
        if (!file) return res.status(400).json({ success: false, message: 'يجب إرفاق صورة إثبات التحويل' });

        let screenshotUrl = null;
        if (process.env.CLOUDINARY_CLOUD_NAME) {
            const uploadResult = await uploadToCloudinary(file.buffer, file.originalname);
            screenshotUrl = uploadResult.secure_url;
        } else {
            const uploadDir = path.join(__dirname, 'private_uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            const filename = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}${path.extname(file.originalname)}`;
            const filePath = path.join(uploadDir, filename);
            fs.writeFileSync(filePath, file.buffer);
            screenshotUrl = `/private_uploads/${filename}`;
        }

        const id = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO deposit_requests (id, userId, username, amount, method, screenshotPath, date, status)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), 'pending')`,
            [id, req.user.id, req.user.username, parseFloat(amount), method, screenshotUrl]
        );

        res.json({ success: true, message: 'تم إرسال طلب الإيداع بنجاح، يرجى انتظار المراجعة' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء معالجة الإيداع: ' + err.message });
    }
});

// ====================== مسار السحب ======================
app.post('/api/withdrawals/add', authenticateToken, async (req, res) => {
    try {
        const { walletAddress, amount } = req.body;
        if (!walletAddress || !amount) return res.status(400).json({ success: false, message: 'عنوان المحفظة والمبلغ مطلوبان' });
        const withdrawAmount = parseFloat(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) return res.status(400).json({ success: false, message: 'المبلغ غير صالح' });

        const user = await getQuery('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        if (user.balance < withdrawAmount) return res.status(400).json({ success: false, message: 'رصيد غير كافٍ' });

        await runQuery('UPDATE users SET balance = balance - ? WHERE id = ?', [withdrawAmount, req.user.id]);
        await updateUserLevel(req.user.id);

        const id = `WIT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO withdrawal_requests (id, userId, username, amount, walletAddress, status, date)
             VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
            [id, req.user.id, req.user.username, withdrawAmount, walletAddress]
        );
        res.json({ success: true, message: 'تم تقديم طلب السحب بنجاح، سيتم مراجعته من قبل الإدارة' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء تقديم طلب السحب' });
    }
});

// ====================== مسارات الاستثمارات ======================
app.post('/api/investments/create', authenticateToken, async (req, res) => {
    try {
        const { amount, projectType } = req.body;
        const user = await getQuery('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false });
        let min = 0;
        if (projectType === 'daily') min = 25;
        else if (projectType === 'weekly') min = 100;
        else if (projectType === 'monthly') min = 300;
        else return res.status(400).json({ success: false });
        const invest = parseFloat(amount);
        if (isNaN(invest) || invest < min) return res.status(400).json({ success: false, message: `الحد الأدنى ${min}$` });
        if (invest > user.balance) return res.status(400).json({ success: false, message: 'رصيد غير كاف' });
        const id = `INV_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO investments (id, userId, username, amount, projectType, startDate, lastProfitDate, withdrawnProfit, withdrawnPrincipal)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 0, 0)`,
            [id, req.user.id, req.user.username, invest, projectType]
        );
        await runQuery('UPDATE users SET balance = balance - ? WHERE id = ?', [invest, req.user.id]);
        await updateUserLevel(req.user.id);
        res.json({ success: true, message: 'تم إنشاء الاستثمار' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.get('/api/investments/my', authenticateToken, async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM investments WHERE userId = ?', [req.user.id]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/investments/withdraw-profit', authenticateToken, async (req, res) => {
    try {
        const { investmentId } = req.body;
        const inv = await getQuery('SELECT * FROM investments WHERE id = ? AND userId = ?', [investmentId, req.user.id]);
        if (!inv) return res.status(404).json({ success: false });
        const now = new Date();
        const lastProfit = inv.lastProfitDate ? new Date(inv.lastProfitDate) : new Date(inv.startDate);
        const diffDays = Math.floor((now - lastProfit) / (1000 * 60 * 60 * 24));
        let profit = 0;
        if (inv.projectType === 'daily') profit = inv.amount * 0.15 * diffDays;
        else if (inv.projectType === 'weekly') profit = diffDays >= 7 ? inv.amount * 0.7 : 0;
        else if (inv.projectType === 'monthly') profit = diffDays >= 30 ? inv.amount * 1.5 : 0;
        if (profit <= 0) return res.status(400).json({ success: false, message: 'لا توجد أرباح جديدة' });
        await runQuery('UPDATE users SET balance = balance + ? WHERE id = ?', [profit, req.user.id]);
        await runQuery('UPDATE investments SET withdrawnProfit = withdrawnProfit + ?, lastProfitDate = ? WHERE id = ?', [profit, new Date(), investmentId]);
        await updateUserLevel(req.user.id);
        res.json({ success: true, message: 'تم سحب الأرباح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/investments/withdraw-principal', authenticateToken, async (req, res) => {
    try {
        const { investmentId } = req.body;
        const inv = await getQuery('SELECT * FROM investments WHERE id = ? AND userId = ?', [investmentId, req.user.id]);
        if (!inv) return res.status(404).json({ success: false });
        const now = new Date();
        const start = new Date(inv.startDate);
        const canWithdrawPrincipal = (now - start) / (1000 * 60 * 60 * 24) >= (inv.projectType === 'monthly' ? 30 : 10);
        if (!canWithdrawPrincipal) return res.status(400).json({ success: false, message: 'المبلغ الأصلي غير متاح للسحب بعد' });
        if (inv.withdrawnPrincipal) return res.status(400).json({ success: false, message: 'تم السحب مسبقاً' });
        await runQuery('UPDATE users SET balance = balance + ? WHERE id = ?', [inv.amount, req.user.id]);
        await runQuery('UPDATE investments SET withdrawnPrincipal = 1 WHERE id = ?', [investmentId]);
        await updateUserLevel(req.user.id);
        res.json({ success: true, message: 'تم سحب المبلغ الأصلي' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ====================== مسارات الإحالات ======================
app.get('/api/referrals/my', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery('SELECT username, level, referralCode FROM users WHERE id = ?', [req.user.id]);
        const referred = await allQuery('SELECT username, email, createdAt, balance FROM users WHERE referrerId = ?', [req.user.id]);
        let totalEarned = 0;
        const list = [];
        for (const ref of referred) {
            let reward = 0;
            if (user.level === 'فضي' && ref.balance >= 100) reward = 10;
            else if (user.level === 'ذهبي' && ref.balance >= 50) reward = 20;
            else if (user.level === 'ألماسي' && ref.balance > 0) reward = 40;
            totalEarned += reward;
            list.push({
                username: ref.username,
                email: ref.email,
                registeredAt: ref.createdAt,
                depositAmount: ref.balance,
                reward,
                status: reward > 0 ? 'مؤهل' : 'قيد الانتظار'
            });
        }
        const referralLink = `${req.protocol}://${req.get('host')}/register.html?ref=${user.referralCode || ''}`;
        res.json({ success: true, referralLink, totalReferrals: referred.length, totalEarned, referrals: list });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ====================== مسارات الأدمن ======================
app.get('/api/admin/users', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { search } = req.query;
        let query = 'SELECT id, username, fullName, email, balance, profit, level, createdAt, isVerified, origin, currentLocation, currentJob, work, profession FROM users';
        let params = [];
        if (search) {
            query += ' WHERE username LIKE ? OR email LIKE ? OR fullName LIKE ?';
            params = [`%${search}%`, `%${search}%`, `%${search}%`];
        }
        query += ' ORDER BY createdAt DESC';
        const [users] = await db.execute(query, params);
        res.json({ users, total: users.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل جلب المستخدمين' });
    }
});

app.get('/api/admin/user/:id', authenticateToken, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        res.json({ success: true, user: rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

app.post('/api/admin/set-user-balance', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { userId, newBalance } = req.body;
        if (!userId || newBalance === undefined) return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
        const [userRows] = await db.execute('SELECT username FROM users WHERE id = ?', [userId]);
        const oldBalance = await getQuery('SELECT balance FROM users WHERE id = ?', [userId]);
        await db.execute('UPDATE users SET balance = ? WHERE id = ?', [parseFloat(newBalance), userId]);
        await updateUserLevel(userId);
        await logAdminAction(req.user.id, req.user.username, 'set_balance', userId, userRows[0]?.username || '', `تعديل الرصيد من ${oldBalance.balance} إلى ${newBalance}`, req.ip);
        res.json({ success: true, message: 'تم تحديث الرصيد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل تحديث الرصيد' });
    }
});

app.post('/api/admin/set-user-level', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { userId, newLevel } = req.body;
        if (!userId || !newLevel) return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
        const allowedLevels = ['برونزي', 'فضي', 'ذهبي', 'ألماسي'];
        if (!allowedLevels.includes(newLevel)) return res.status(400).json({ success: false, message: 'رتبة غير صالحة' });
        const [userRows] = await db.execute('SELECT username FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        await db.execute('UPDATE users SET level = ? WHERE id = ?', [newLevel, userId]);
        await logAdminAction(req.user.id, req.user.username, 'set_level', userId, userRows[0].username, `تغيير الرتبة إلى ${newLevel}`, req.ip);
        res.json({ success: true, message: `تم تغيير رتبة المستخدم إلى ${newLevel}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل تغيير الرتبة' });
    }
});

app.post('/api/admin/reset-user-password', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { userId, newPassword } = req.body;
        const [userRows] = await db.execute('SELECT username FROM users WHERE id = ?', [userId]);
        const hashed = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
        await logAdminAction(req.user.id, req.user.username, 'reset_password', userId, userRows[0]?.username || '', 'إعادة تعيين كلمة المرور', req.ip);
        res.json({ success: true, message: 'تم إعادة تعيين كلمة المرور' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل إعادة تعيين كلمة المرور' });
    }
});

// ========== إدارة طلبات الإيداع ==========
app.get('/api/admin/deposits', authenticateToken, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM deposit_requests WHERE status = "pending" ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل جلب طلبات الإيداع' });
    }
});

app.post('/api/admin/deposits/:id/:action', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { id, action } = req.params;
        const [rows] = await db.execute('SELECT * FROM deposit_requests WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        const request = rows[0];
        if (action === 'approve') {
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [request.amount, request.userId]);
            await db.execute('UPDATE deposit_requests SET status = "approved" WHERE id = ?', [id]);
            await updateUserLevel(request.userId);
            await logAdminAction(req.user.id, req.user.username, 'approve_deposit', request.userId, request.username, `قبول إيداع بمبلغ ${request.amount}$`, req.ip);
            return res.json({ success: true, message: 'تم قبول الإيداع وإضافة الرصيد' });
        } else if (action === 'reject') {
            await db.execute('UPDATE deposit_requests SET status = "rejected" WHERE id = ?', [id]);
            await logAdminAction(req.user.id, req.user.username, 'reject_deposit', request.userId, request.username, `رفض إيداع بمبلغ ${request.amount}$`, req.ip);
            return res.json({ success: true, message: 'تم رفض الإيداع' });
        } else {
            return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ: ' + err.message });
    }
});

// ========== إدارة طلبات السحب ==========
app.get('/api/admin/withdrawals', authenticateToken, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM withdrawal_requests ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل جلب طلبات السحب' });
    }
});

app.post('/api/admin/withdrawals/:id/:action', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { id, action } = req.params;
        const [rows] = await db.execute('SELECT * FROM withdrawal_requests WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        const request = rows[0];
        if (action === 'approve') {
            await db.execute('UPDATE withdrawal_requests SET status = "approved" WHERE id = ?', [id]);
            await logAdminAction(req.user.id, req.user.username, 'approve_withdrawal', request.userId, request.username, `قبول سحب بمبلغ ${request.amount}$`, req.ip);
            return res.json({ success: true, message: 'تمت الموافقة على السحب' });
        } else if (action === 'reject') {
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [request.amount, request.userId]);
            await db.execute('UPDATE withdrawal_requests SET status = "rejected" WHERE id = ?', [id]);
            await updateUserLevel(request.userId);
            await logAdminAction(req.user.id, req.user.username, 'reject_withdrawal', request.userId, request.username, `رفض سحب بمبلغ ${request.amount}$ (تمت إعادة المبلغ)`, req.ip);
            return res.json({ success: true, message: 'تم رفض السحب وإعادة المبلغ' });
        } else {
            return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ: ' + err.message });
    }
});

app.get('/api/admin/admin-actions', authenticateToken, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM admin_actions ORDER BY timestamp DESC LIMIT 200');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'فشل جلب سجل الإجراءات' });
    }
});

app.get('/api/admin/verify', authenticateToken, (req, res) => {
    if (req.user.role === 'admin' || req.user.type === 'admin_gateway') {
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false, message: 'غير مصرح' });
    }
});

// ========== الباب السري ==========
app.post('/api/auth/verify-admin-gateway', async (req, res) => {
    try {
        const { secretPassword } = req.body;
        if (secretPassword === ADMIN_GATEWAY_SECRET) {
            const tempToken = jwt.sign({ type: 'admin_gateway', role: 'admin' }, JWT_SECRET, { expiresIn: '5m' });
            res.cookie('admin_gateway_token', tempToken, { httpOnly: true, sameSite: 'lax', maxAge: 5 * 60 * 1000 });
            return res.json({ success: true });
        } else {
            return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ====================== نقاط نهاية للتسجيل ======================
app.get('/api/users/check-username', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.json({ exists: false });
        const [rows] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
        res.json({ exists: rows.length > 0 });
    } catch (err) {
        console.error(err);
        res.json({ exists: false });
    }
});

const disposableDomains = [
    'tempmail.com', '10minutemail.com', 'guerrillamail.com', 'mailinator.com',
    'yopmail.com', 'throwawaymail.com', 'sharklasers.com', 'grr.la'
];

app.get('/api/auth/validate-email', async (req, res) => {
    try {
        const { email } = req.query;
        if (!email || !email.includes('@')) return res.json({ valid: false, reason: 'صيغة بريد غير صحيحة' });
        const domain = email.split('@')[1].toLowerCase();
        if (disposableDomains.includes(domain)) return res.json({ valid: false, reason: 'البريد المؤقت غير مسموح به' });
        try {
            await dns.resolveMx(domain);
            return res.json({ valid: true });
        } catch (mxErr) {
            return res.json({ valid: false, reason: 'النطاق لا يستقبل بريداً' });
        }
    } catch (err) {
        console.error(err);
        res.json({ valid: false, reason: 'خطأ في التحقق' });
    }
});

global.tempCodes = new Map();

app.post('/api/users/register', async (req, res) => {
    try {
        const { username, password, fullName, email, origin, currentLocation, currentJob, work, profession, verificationCode, referrerCode } = req.body;
        if (!username || !password || !fullName || !email) return res.status(400).json({ success: false, message: 'البيانات الأساسية مطلوبة' });

        const [existingUser] = await db.execute('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser.length > 0) return res.status(400).json({ success: false, message: 'اسم المستخدم أو البريد موجود مسبقاً' });

        let isVerified = 0;
        if (verificationCode && verificationCode.trim() !== '') {
            const temp = global.tempCodes.get(email);
            if (temp && temp.code === verificationCode && Date.now() <= temp.expiresAt) {
                isVerified = 1;
                global.tempCodes.delete(email);
            }
        }

        let referrerId = null;
        if (referrerCode) {
            const [refRows] = await db.execute('SELECT id FROM users WHERE referralCode = ?', [referrerCode]);
            if (refRows.length > 0) referrerId = refRows[0].id;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = `USER_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const referralCodeGen = username + "_" + Math.random().toString(36).substr(2, 6);

        await db.execute(
            `INSERT INTO users (id, username, password, fullName, email, origin, currentLocation, currentJob, work, profession, createdAt, referrerId, referralCode, isVerified, loginAttempts, lockUntil)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 0, NULL)`,
            [userId, username, hashedPassword, fullName, email, origin || 'غير محدد', currentLocation || 'غير محدد', currentJob || 'غير محدد', work || 'غير محدد', profession || 'غير محدد', referrerId, referralCodeGen, isVerified]
        );

        res.status(201).json({
            success: true,
            message: isVerified ? 'تم التسجيل بنجاح' : 'تم التسجيل، يرجى التحقق من بريدك لتفعيل الحساب',
            isVerified
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم' });
    }
});

app.post('/api/auth/send-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const [existing] = await db.execute('SELECT id, isVerified FROM users WHERE email = ?', [email]);
        if (existing.length > 0 && existing[0].isVerified) return res.status(400).json({ success: false, message: 'البريد مسجل وموثق بالفعل' });
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        global.tempCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
        console.log(`[تطوير] رمز التحقق للبريد ${email} هو: ${code}`);
        res.json({ success: true, message: 'تم إرسال الرمز (في وضع التطوير، تم طباعته في التيرمنال)' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ====================== عجلة الحظ ======================
function getWheelResult(betAmount) {
    const random = Math.random() * 100;
    if (random < 2) return { multiplier: 15, resultText: 'الجائزة الكبرى 15x' };
    if (random < 25) {
        const sub = Math.random();
        if (sub < 0.33) return { multiplier: 1.25, resultText: 'ربح 25%' };
        if (sub < 0.66) return { multiplier: 1.5, resultText: 'ربح 50%' };
        return { multiplier: 2, resultText: 'ضعف المبلغ' };
    }
    const sub = Math.random();
    if (sub < 0.2) return { multiplier: 0, resultText: 'خسارة كلية' };
    if (sub < 0.4) return { multiplier: 0.75, resultText: 'خسارة 25%' };
    if (sub < 0.6) return { multiplier: 0.5, resultText: 'خسارة 50%' };
    if (sub < 0.8) return { multiplier: 0.25, resultText: 'خسارة 75%' };
    return { multiplier: 0.1, resultText: 'خسارة 90%' };
}

app.post('/api/wheel/spin', authenticateToken, async (req, res) => {
    try {
        const { betAmount } = req.body;
        const amount = parseFloat(betAmount);
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, message: 'مبلغ غير صالح' });
        if (amount < 20) return res.status(400).json({ success: false, message: 'الحد الأدنى 20$' });

        const [userRows] = await db.execute('SELECT id, username, balance, profit FROM users WHERE id = ?', [req.user.id]);
        if (userRows.length === 0) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        const user = userRows[0];
        if (user.balance < amount) return res.status(400).json({ success: false, message: 'رصيد غير كاف' });

        const result = getWheelResult(amount);
        const winAmount = amount * result.multiplier;
        const netChange = winAmount - amount;
        const newBalance = user.balance + netChange;
        let newProfit = user.profit;
        if (netChange > 0) newProfit = user.profit + netChange;

        await db.execute('UPDATE users SET balance = ?, profit = ? WHERE id = ?', [newBalance, newProfit, req.user.id]);
        await updateUserLevel(req.user.id);

        if (netChange < 0) {
            await db.execute(
                `INSERT INTO casino_profits (id, username, amount, date, details) VALUES (?,?,?,NOW(),?)`,
                [`LOSS_${Date.now()}_${Math.random().toString(36).substr(2,8)}`, user.username, -netChange, result.resultText]
            );
        }
        await db.execute(
            `INSERT INTO wheel_wins (id, userId, username, betAmount, winAmount, multiplier, date) VALUES (?,?,?,?,?,?,NOW())`,
            [`WIN_${Date.now()}_${Math.random().toString(36).substr(2,8)}`, req.user.id, user.username, amount, winAmount, result.multiplier]
        );

        res.json({ success: true, multiplier: result.multiplier, winAmount, newBalance, newProfit, result: result.resultText, netChange });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء الدوران' });
    }
});

app.get('/api/wheel/top-wins', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT username, winAmount FROM wheel_wins ORDER BY winAmount DESC LIMIT 10');
        res.json(rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

// ====================== توزيع الأرباح اليومية (cron) ======================
async function distributeDailyProfits() {
    console.log('🔄 بدء توزيع الأرباح اليومية...');
    try {
        const investments = await allQuery('SELECT * FROM investments WHERE withdrawnPrincipal = 0');
        for (const inv of investments) {
            const now = new Date();
            const start = new Date(inv.startDate);
            const lastProfit = inv.lastProfitDate ? new Date(inv.lastProfitDate) : start;
            const diffDays = Math.floor((now - lastProfit) / (1000 * 60 * 60 * 24));
            if (diffDays <= 0) continue;
            let profitToAdd = 0;
            if (inv.projectType === 'daily') profitToAdd = inv.amount * 0.15 * diffDays;
            else if (inv.projectType === 'weekly') profitToAdd = (diffDays >= 7 ? inv.amount * 0.7 : 0);
            else if (inv.projectType === 'monthly') profitToAdd = (diffDays >= 30 ? inv.amount * 1.5 : 0);
            if (profitToAdd > 0) {
                await runQuery('UPDATE users SET profit = profit + ? WHERE id = ?', [profitToAdd, inv.userId]);
                await runQuery('UPDATE investments SET lastProfitDate = ? WHERE id = ?', [now, inv.id]);
                await runQuery(`INSERT INTO activity_logs (userId, action, details, timestamp) VALUES (?, 'profit_distributed', ?, NOW())`, [inv.userId, `أرباح يومية: ${profitToAdd}$`]);
            }
        }
        console.log('✅ تم توزيع الأرباح اليومية');
    } catch (err) {
        console.error('خطأ في توزيع الأرباح:', err);
    }
}
cron.schedule('0 0 * * *', () => { distributeDailyProfits(); });

// ====================== النسخ الاحتياطي لقاعدة البيانات ======================
async function backupDatabase() {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup_${timestamp}.sql`);
    const command = `mysqldump -h ${DB_HOST} -u ${DB_USER} ${DB_PASSWORD ? '-p' + DB_PASSWORD : ''} ${DB_NAME} > "${backupFile}"`;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ فشل النسخ الاحتياطي: ${error.message}`);
        } else {
            console.log(`✅ تم إنشاء نسخة احتياطية: ${backupFile}`);
            const files = fs.readdirSync(backupDir);
            const now = Date.now();
            files.forEach(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️ تم حذف نسخة قديمة: ${file}`);
                }
            });
        }
    });
}
cron.schedule('0 2 * * *', () => { backupDatabase(); });

// ====================== مسار اختبار ======================
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is working' });
});

// ====================== تقديم الملفات الثابتة (Frontend داخل مجلد public) ======================
const frontendPath = path.join(__dirname, 'public');
if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    console.log(`✅ Frontend served from: ${frontendPath}`);
} else {
    console.warn(`⚠️ Frontend folder not found at ${frontendPath}. Make sure you have a 'public' folder inside backend containing all HTML files.`);
}

// ====================== معالج الأخطاء العام ======================
if (isValidSentryDsn) {
    app.use(Sentry.Handlers.errorHandler());
}
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
});

// ====================== تشغيل الخادم ======================
initDatabase().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Best Deal Gold System running on http://localhost:${PORT}`);
        console.log(`👑 Admin: username = freeze | password = MHDFREEZE0619`);
        console.log(`🔑 Secret gateway password: ${ADMIN_GATEWAY_SECRET}`);
        console.log(`📁 Frontend (public folder): ${frontendPath}`);
        if (process.env.CLOUDINARY_CLOUD_NAME) console.log(`☁️ Cloudinary: Configured`);
        else console.log(`☁️ Cloudinary: Not configured (using local storage)`);
        if (isValidSentryDsn) console.log(`📡 Sentry: Enabled`);
        else console.log(`📡 Sentry: Disabled (invalid or missing DSN)`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});