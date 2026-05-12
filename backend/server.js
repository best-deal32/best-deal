// ============================================================
// server.js - Fargo | استثمار المعادن والعملات الرقمية (نهائي)
// ============================================================
// الميزات:
// - تسجيل دخول موحد (اسم المستخدم، البريد الإلكتروني، أو رقم الهاتف)
// - تسجيل : بريد أو هاتف (أحدهما إجباري)
// - إيداع بدون صور (المبلغ + رمز المعاملة)
// - سحب أرباح (≥10$) أو أصل
// - استثمار وحيد: 3% يومياً (50$–10,000$)
// - فريق (إحالات) 15% من أول إيداع
// - تذاكر دعم (مستخدمين + زوّار)
// - أدمن كامل مع تحليلات
// - إشعارات فورية (WebSocket)
// - i18n (عربي/إنجليزي/صيني/ألماني)
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
const cloudinary = require('cloudinary').v2;
const rateLimit = require('express-rate-limit');
const dns = require('dns').promises;
const cron = require('node-cron');
const { exec } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const socketIo = require('socket.io');

// i18n
const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');

i18next.use(Backend).use(middleware.LanguageDetector).init({
    fallbackLng: 'ar',
    preload: ['ar', 'en', 'zh', 'de'],
    backend: { loadPath: path.join(__dirname, 'locales/{{lng}}/translation.json') },
    detection: {
        order: ['querystring', 'cookie', 'header'],
        lookupQuerystring: 'lang',
        lookupCookie: 'i18n',
        caches: ['cookie']
    }
});

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'BestDealGoldSystem_SuperSecretKey_2026_!@#$%';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'BestDealRefreshSecret_2026_!@#$%';
const ADMIN_GATEWAY_SECRET = process.env.ADMIN_GATEWAY_SECRET || 'MHDFREEZE2003';
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(middleware.handle(i18next));

// ====================== Cloudinary ======================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- تخزين مؤقت للملفات في الذاكرة ---
const multerStorage = multer.memoryStorage(); // هذا هو المفقود الذي سبب الخطأ

const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('يسمح فقط برفع الصور'), false);
  }
});

async function uploadToCloudinary(buffer, originalname) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'deposits', allowed_formats: ['jpg', 'png', 'jpeg', 'webp'], transformation: [{ width: 1024, height: 1024, crop: 'limit' }] },
      (error, result) => { if (error) reject(error); else resolve(result); }
    );
    uploadStream.end(buffer);
  });
}

// ====================== Database ======================
let db;
async function initDatabase() {
    try {
        if (process.env.MYSQL_URL) {
            db = await mysql.createConnection(process.env.MYSQL_URL);
            console.log('✅ Connected via MYSQL_URL');
        } else {
            db = await mysql.createConnection({
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'fargo',
                port: process.env.DB_PORT || 3306
            });
            console.log('✅ Connected via DB_* variables');
        }
        setInterval(async () => {
            try { await db.query('SELECT 1'); } catch (err) { await initDatabase(); }
        }, 60000);
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    }
}

async function createTables() {
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        fullName VARCHAR(100),
        email VARCHAR(100) NULL,
        phoneNumber VARCHAR(20) NULL,
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
        referrerId VARCHAR(50) NULL,
        refreshToken VARCHAR(255),
        loginAttempts INT DEFAULT 0,
        lockUntil DATETIME,
        lastDailyBonus DATE NULL,
        totalDeposits DECIMAL(10,2) DEFAULT 0,
        dailyBonusStreak INT DEFAULT 0
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS deposit_requests (
        id VARCHAR(50) PRIMARY KEY, userId VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL, amount DECIMAL(10,2) NOT NULL,
        method VARCHAR(50), status VARCHAR(20) DEFAULT 'pending',
        screenshotPath VARCHAR(255), date DATETIME NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id VARCHAR(50) PRIMARY KEY, userId VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL, amount DECIMAL(10,2) NOT NULL,
        walletAddress VARCHAR(255) NOT NULL,
        type ENUM('profit', 'principal') DEFAULT 'profit',
        status VARCHAR(20) DEFAULT 'pending', date DATETIME NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS investments (
        id VARCHAR(50) PRIMARY KEY, userId VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL, amount DECIMAL(10,2) NOT NULL,
        projectType VARCHAR(20) NOT NULL DEFAULT 'metals',
        startDate DATETIME NOT NULL, lastProfitDate DATETIME,
        withdrawnProfit DECIMAL(10,2) DEFAULT 0,
        withdrawnPrincipal TINYINT DEFAULT 0,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS referrals (
        id VARCHAR(50) PRIMARY KEY, referrerId VARCHAR(50) NOT NULL,
        referredId VARCHAR(50) NOT NULL, amount DECIMAL(10,2) NOT NULL,
        createdAt DATETIME NOT NULL, level TINYINT DEFAULT 1,
        FOREIGN KEY (referrerId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referredId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY, userId VARCHAR(50),
        action VARCHAR(255), details TEXT, ip VARCHAR(45), timestamp DATETIME,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY, userId VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL, message TEXT NOT NULL,
        isRead TINYINT DEFAULT 0, createdAt DATETIME NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS admin_actions (
        id INT AUTO_INCREMENT PRIMARY KEY, adminId VARCHAR(50) NOT NULL,
        adminUsername VARCHAR(50) NOT NULL, actionType VARCHAR(50) NOT NULL,
        targetUserId VARCHAR(50), targetUsername VARCHAR(50),
        details TEXT, ip VARCHAR(45), timestamp DATETIME,
        FOREIGN KEY (adminId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(100) NOT NULL,
        token VARCHAR(255) NOT NULL, expiresAt DATETIME NOT NULL,
        createdAt DATETIME DEFAULT NOW()
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS support_tickets (
        id VARCHAR(50) PRIMARY KEY, userId VARCHAR(50) NULL,
        username VARCHAR(50) NOT NULL, subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL, priority ENUM('low', 'normal', 'high') DEFAULT 'normal',
        status ENUM('open', 'in_progress', 'closed') DEFAULT 'open',
        attachmentPath VARCHAR(255), createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS support_replies (
        id VARCHAR(50) PRIMARY KEY, ticketId VARCHAR(50) NOT NULL,
        userId VARCHAR(50) NOT NULL, username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL, attachmentPath VARCHAR(255),
        createdAt DATETIME NOT NULL,
        FOREIGN KEY (ticketId) REFERENCES support_tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // تعديل الأعمدة للتوافق
    try { await db.execute(`ALTER TABLE support_tickets MODIFY userId VARCHAR(50) NULL`); } catch (err) {}
    try { await db.execute(`ALTER TABLE users MODIFY email VARCHAR(100) NULL`); } catch (err) {}
    try { await db.execute(`ALTER TABLE users ADD COLUMN phoneNumber VARCHAR(20) NULL`); } catch (err) {}
    try { await db.execute(`ALTER TABLE withdrawal_requests ADD COLUMN type ENUM('profit', 'principal') DEFAULT 'profit'`); } catch (err) {}
    try { await db.execute(`ALTER TABLE users ADD COLUMN referrerId VARCHAR(50) NULL`); } catch (err) {}
    try { await db.execute(`ALTER TABLE users ADD COLUMN lastDailyBonus DATE NULL`); } catch (err) {}
    try { await db.execute(`ALTER TABLE users ADD COLUMN totalDeposits DECIMAL(10,2) DEFAULT 0`); } catch (err) {}
    try { await db.execute(`ALTER TABLE users ADD COLUMN dailyBonusStreak INT DEFAULT 0`); } catch (err) {}

    // إنشاء الأدمن الأول
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', ['freeze']);
    if (existing.length === 0) {
        const hashedPassword = await bcrypt.hash('MHDFREEZE0619', 10);
        await db.execute(
            `INSERT INTO users (id, username, password, role, email, fullName, balance, createdAt, isVerified, referralCode, origin, currentLocation, currentJob, level)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1, ?, 'سوريا', 'دمشق', 'مطور', 'ألماسي')`,
            ['FREEZE_ID', 'freeze', hashedPassword, 'admin', 'freeze@fargo.com', 'Freeze Admin', 50000, 'freeze_ref']
        );
        console.log('✅ Admin user "freeze" created');
    }

    // إعادة تعيين اختياري (تم تعطيله نهائياً)
    // if (process.env.RESET_DATA === 'true') { ... }

    try {
        await db.execute(`UPDATE users u LEFT JOIN (SELECT userId, SUM(amount) as total FROM deposit_requests WHERE status = 'approved' GROUP BY userId) d ON u.id = d.userId SET u.totalDeposits = COALESCE(d.total, 0)`);
    } catch (err) {}
}

// ====================== Helpers ======================
async function runQuery(sql, params) { const [result] = await db.execute(sql, params); return result; }
async function getQuery(sql, params) { const [rows] = await db.execute(sql, params); return rows[0]; }
async function allQuery(sql, params) { const [rows] = await db.execute(sql, params); return rows; }
function generateToken(userId, username, role) { return jwt.sign({ id: userId, username, role }, JWT_SECRET, { expiresIn: '15m' }); }
function generateRefreshToken(userId) { return jwt.sign({ id: userId }, REFRESH_SECRET, { expiresIn: '7d' }); }

async function authenticateToken(req, res, next) {
    let token = req.cookies?.token;
    if (!token) { const authHeader = req.headers['authorization']; token = authHeader && authHeader.split(' ')[1]; }
    if (!token) return res.status(401).json({ success: false, message: req.t('unauthorized') });
    try { const user = jwt.verify(token, JWT_SECRET); req.user = user; next(); }
    catch (err) { return res.status(403).json({ success: false, message: req.t('invalid_token') }); }
}
function adminOnly(req, res, next) {
    if (req.user && req.user.role === 'admin') return next();
    return res.status(403).json({ success: false, message: req.t('admin_required') });
}
async function logAdminAction(adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip) {
    await runQuery(`INSERT INTO admin_actions (adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip]);
}
async function addNotification(userId, title, message) {
    await runQuery(`INSERT INTO notifications (userId, title, message, createdAt, isRead) VALUES (?, ?, ?, NOW(), 0)`, [userId, title, message]);
    sendNotificationToUser(userId, title, message, 'info');
}
async function logActivity(userId, action, details, ip = null) {
    await runQuery(`INSERT INTO activity_logs (userId, action, details, ip, timestamp) VALUES (?, ?, ?, ?, NOW())`, [userId, action, details, ip]);
}

// ====================== WebSocket ======================
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: true, credentials: true } });
const userSockets = new Map();
const adminSockets = new Set();

io.on('connection', (socket) => {
    socket.on('register-user', (userId) => { userSockets.set(userId, socket.id); });
    socket.on('register-admin', (adminId) => { adminSockets.add(socket.id); userSockets.set(adminId, socket.id); });
    socket.on('disconnect', () => {
        for (let [userId, socketId] of userSockets.entries()) if (socketId === socket.id) { userSockets.delete(userId); adminSockets.delete(socketId); break; }
    });
});

function sendNotificationToUser(userId, title, message, type = 'info') {
    const socketId = userSockets.get(userId);
    if (socketId) io.to(socketId).emit('notification', { title, message, type, timestamp: new Date() });
}
function notifyAdmins(event, data) { adminSockets.forEach(socketId => io.to(socketId).emit(event, data)); }

// ====================== Middleware ======================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { success: false, message: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { success: false, message: 'Too many attempts' } });
app.use('/api/', globalLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);

// ====================== AUTH ROUTES ======================
app.post('/api/users/login', async (req, res) => {
    try {
        const { login, password } = req.body;
        if (!login || !password) return res.status(400).json({ success: false, message: req.t('login_required_fields') });
        const user = await getQuery('SELECT * FROM users WHERE username = ? OR email = ? OR phoneNumber = ?', [login, login, login]);
        if (!user) return res.status(401).json({ success: false, message: req.t('invalid_credentials') });
        if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
            const minutesLeft = Math.ceil((new Date(user.lockUntil) - new Date()) / 60000);
            return res.status(423).json({ success: false, message: `الحساب مقفل لمدة ${minutesLeft} دقيقة` });
        }
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            await runQuery('UPDATE users SET loginAttempts = loginAttempts + 1 WHERE id = ?', [user.id]);
            const updated = await getQuery('SELECT loginAttempts FROM users WHERE id = ?', [user.id]);
            if (updated.loginAttempts >= 5) {
                await runQuery('UPDATE users SET lockUntil = ? WHERE id = ?', [new Date(Date.now() + 15*60000), user.id]);
                return res.status(423).json({ success: false, message: 'تم قفل الحساب 15 دقيقة' });
            }
            return res.status(401).json({ success: false, message: req.t('invalid_credentials') });
        }
        await runQuery('UPDATE users SET loginAttempts = 0, lockUntil = NULL WHERE id = ?', [user.id]);
        const token = generateToken(user.id, user.username, user.role);
        const refreshToken = generateRefreshToken(user.id);
        await runQuery('UPDATE users SET refreshToken = ? WHERE id = ?', [refreshToken, user.id]);
        res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 15 * 60 * 1000 });
        res.cookie('refreshToken', refreshToken, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 7 * 24 * 60 * 60 * 1000 });
        const { password: _, ...userData } = user;
        await logActivity(user.id, 'تسجيل دخول', 'تسجيل دخول ناجح', req.ip);
        res.json({ success: true, user: userData });
    } catch (err) { console.error('Login error:', err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

app.post('/api/auth/refresh', async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) return res.status(401).json({ success: false });
    try {
        const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
        const user = await getQuery('SELECT id, username, role FROM users WHERE id = ? AND refreshToken = ?', [decoded.id, refreshToken]);
        if (!user) return res.status(403).json({ success: false });
        const newToken = generateToken(user.id, user.username, user.role);
        res.cookie('token', newToken, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 15 * 60 * 1000 });
        res.json({ success: true });
    } catch (err) { res.status(403).json({ success: false }); }
});

app.get('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery('SELECT id, username, role, fullName, email, phoneNumber, balance, profit, level, isVerified, origin, currentLocation, currentJob, work, profession, referralCode, totalDeposits FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false, message: req.t('user_not_found') });
        res.json({ ...user, withdrawableAmount: (parseFloat(user.balance)||0) + (parseFloat(user.profit)||0) });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

// ====================== DEPOSIT ROUTES ======================
app.post('/api/deposits/add', authenticateToken, async (req, res) => {
    try {
        const { amount, transactionCode } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'المبلغ مطلوب' });
        if (!transactionCode || !transactionCode.trim()) return res.status(400).json({ success: false, message: 'رمز المعاملة مطلوب' });
        const id = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(`INSERT INTO deposit_requests (id, userId, username, amount, method, screenshotPath, date, status) VALUES (?, ?, ?, ?, 'USDT', ?, NOW(), 'pending')`,
            [id, req.user.id, req.user.username, parseFloat(amount), transactionCode.trim()]);
        await logActivity(req.user.id, 'طلب إيداع', `طلب إيداع بقيمة ${amount}$ - رمز: ${transactionCode}`, req.ip);
        notifyAdmins('new-deposit-request', { username: req.user.username, amount: parseFloat(amount) });
        res.json({ success: true, message: 'تم تقديم طلب الإيداع' });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

app.get('/api/admin/deposits', authenticateToken, adminOnly, async (req, res) => {
    res.json(await allQuery('SELECT * FROM deposit_requests WHERE status = "pending" ORDER BY date DESC'));
});
app.get('/api/deposits/my', authenticateToken, async (req, res) => {
    res.json(await allQuery('SELECT * FROM deposit_requests WHERE userId = ? ORDER BY date DESC', [req.user.id]));
});

app.post('/api/admin/deposits/:id/approve', authenticateToken, adminOnly, async (req, res) => {
    try {
        const deposit = await getQuery('SELECT * FROM deposit_requests WHERE id = ?', [req.params.id]);
        if (!deposit || deposit.status !== 'pending') return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        const { userId, amount, username } = deposit;
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
        await db.execute('UPDATE deposit_requests SET status = "approved" WHERE id = ?', [deposit.id]);
        await db.execute('UPDATE users SET totalDeposits = totalDeposits + ? WHERE id = ?', [amount, userId]);
        await logAdminAction(req.user.id, req.user.username, 'approve_deposit', userId, username, `قبول إيداع ${amount}$`, req.ip);
        await addNotification(userId, 'تم قبول الإيداع', `تمت إضافة ${amount}$ إلى رصيدك`);
        await logActivity(userId, 'إيداع مقبول', `تم قبول إيداع ${amount}$`, req.ip);
        const totalDep = (await getQuery('SELECT totalDeposits FROM users WHERE id = ?', [userId])).totalDeposits;
        if (totalDep === amount) await processReferralBonus(userId, amount);
        res.json({ success: true, message: 'تم قبول الإيداع' });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, adminOnly, async (req, res) => {
    try {
        const deposit = await getQuery('SELECT * FROM deposit_requests WHERE id = ?', [req.params.id]);
        if (!deposit || deposit.status !== 'pending') return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        await db.execute('UPDATE deposit_requests SET status = "rejected" WHERE id = ?', [deposit.id]);
        await logAdminAction(req.user.id, req.user.username, 'reject_deposit', deposit.userId, deposit.username, `رفض إيداع ${deposit.amount}$`, req.ip);
        await addNotification(deposit.userId, 'تم رفض الإيداع', `تم رفض إيداعك بقيمة ${deposit.amount}$`);
        await logActivity(deposit.userId, 'إيداع مرفوض', `تم رفض إيداع ${deposit.amount}$`, req.ip);
        res.json({ success: true, message: 'تم رفض الإيداع' });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

app.post('/api/admin/deposits/:id/:action', authenticateToken, adminOnly, async (req, res) => {
    const { id, action } = req.params;
    if (action === 'approve') { req.params.id = id; return app.handle(req, res, { ...req, url: `/api/admin/deposits/${id}/approve`, method: 'POST' }); }
    else if (action === 'reject') { req.params.id = id; return app.handle(req, res, { ...req, url: `/api/admin/deposits/${id}/reject`, method: 'POST' }); }
    else return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
});

// ====================== WITHDRAWAL ROUTES ======================
app.post('/api/withdrawals/add', authenticateToken, async (req, res) => {
    try {
        const { walletAddress, amount, type } = req.body;
        if (!walletAddress || !amount || !type) return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
        const withdrawAmount = parseFloat(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) return res.status(400).json({ success: false, message: 'مبلغ غير صالح' });
        if (type !== 'profit' && type !== 'principal') return res.status(400).json({ success: false, message: 'نوع السحب غير صالح' });
        const user = await getQuery('SELECT balance, profit, totalDeposits FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
        // تم إزالة شرط وجود إيداع سابق للسماح بسحب أرباح الإحالة فوراً
        if (type === 'profit') {
            if (parseFloat(user.profit) < withdrawAmount) return res.status(400).json({ success: false, message: 'الأرباح غير كافية' });
            if (withdrawAmount < 10) return res.status(400).json({ success: false, message: 'الحد الأدنى لسحب الأرباح هو 10$' });
        } else {
            if (parseFloat(user.balance) < withdrawAmount) return res.status(400).json({ success: false, message: 'الرصيد غير كافٍ' });
        }
        const id = `WIT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(`INSERT INTO withdrawal_requests (id, userId, username, amount, walletAddress, type, status, date) VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [id, req.user.id, req.user.username, withdrawAmount, walletAddress, type]);
        await logActivity(req.user.id, 'طلب سحب', `طلب سحب ${withdrawAmount}$`, req.ip);
        await addNotification(req.user.id, 'طلب سحب', `تم تقديم طلب سحب ${withdrawAmount}$`);
        notifyAdmins('new-withdrawal-request', { username: req.user.username, amount: withdrawAmount, type });
        res.json({ success: true, message: 'تم تقديم طلب السحب' });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

app.get('/api/admin/withdrawals', authenticateToken, adminOnly, async (req, res) => {
    res.json(await allQuery('SELECT * FROM withdrawal_requests WHERE status = "pending" ORDER BY date DESC'));
});
app.get('/api/withdrawals/my', authenticateToken, async (req, res) => {
    res.json(await allQuery('SELECT * FROM withdrawal_requests WHERE userId = ? ORDER BY date DESC', [req.user.id]));
});

app.post('/api/admin/withdrawals/:id/approve', authenticateToken, adminOnly, async (req, res) => {
    try {
        const request = await getQuery('SELECT * FROM withdrawal_requests WHERE id = ?', [req.params.id]);
        if (!request || request.status !== 'pending') return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        const { userId, amount, type, walletAddress, username } = request;
        const withdrawAmount = parseFloat(amount);
        const user = await getQuery('SELECT balance, profit FROM users WHERE id = ?', [userId]);
        let newBalance = parseFloat(user.balance), newProfit = parseFloat(user.profit);
        if (type === 'profit') { if (newProfit < withdrawAmount) return res.status(400).json({ success: false, message: 'أرباح غير كافية' }); newProfit -= withdrawAmount; }
        else { if (newBalance < withdrawAmount) return res.status(400).json({ success: false, message: 'رصيد غير كافٍ' }); newBalance -= withdrawAmount; }
        await db.execute('UPDATE users SET balance = ?, profit = ? WHERE id = ?', [newBalance, newProfit, userId]);
        await db.execute('UPDATE withdrawal_requests SET status = "approved" WHERE id = ?', [req.params.id]);
        await logAdminAction(req.user.id, req.user.username, 'approve_withdrawal', userId, username, `قبول سحب ${withdrawAmount}$`, req.ip);
        await addNotification(userId, 'تم قبول السحب', `تم قبول سحب ${withdrawAmount}$`);
        await logActivity(userId, 'سحب مقبول', `تم قبول سحب ${withdrawAmount}$`, req.ip);
        res.json({ success: true, message: 'تم قبول السحب' });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

app.post('/api/admin/withdrawals/:id/reject', authenticateToken, adminOnly, async (req, res) => {
    try {
        const request = await getQuery('SELECT * FROM withdrawal_requests WHERE id = ?', [req.params.id]);
        if (!request || request.status !== 'pending') return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
        await db.execute('UPDATE withdrawal_requests SET status = "rejected" WHERE id = ?', [req.params.id]);
        await logAdminAction(req.user.id, req.user.username, 'reject_withdrawal', request.userId, request.username, `رفض سحب ${request.amount}$`, req.ip);
        await addNotification(request.userId, 'تم رفض السحب', `تم رفض طلب السحب ${request.amount}$`);
        await logActivity(request.userId, 'سحب مرفوض', `تم رفض سحب ${request.amount}$`, req.ip);
        res.json({ success: true, message: 'تم رفض السحب' });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});

app.post('/api/admin/withdrawals/:id/:action', authenticateToken, adminOnly, async (req, res) => {
    const { id, action } = req.params;
    if (action === 'approve') { req.params.id = id; return app.handle(req, res, { ...req, url: `/api/admin/withdrawals/${id}/approve`, method: 'POST' }); }
    else if (action === 'reject') { req.params.id = id; return app.handle(req, res, { ...req, url: `/api/admin/withdrawals/${id}/reject`, method: 'POST' }); }
    else return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
});

// ====================== INVESTMENT ======================
app.post('/api/investments/create', authenticateToken, async (req, res) => {
    try {
        const { amount } = req.body;
        const invest = parseFloat(amount);
        if (isNaN(invest) || invest < 50) return res.status(400).json({ success: false, message: 'الحد الأدنى 50$' });
        if (invest > 10000) return res.status(400).json({ success: false, message: 'الحد الأقصى 10,000$' });
        const user = await getQuery('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        if (!user || user.balance < invest) return res.status(400).json({ success: false, message: 'رصيد غير كافٍ' });
        const id = `INV_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(`INSERT INTO investments (id, userId, username, amount, projectType, startDate, lastProfitDate, withdrawnProfit, withdrawnPrincipal) VALUES (?, ?, ?, ?, 'metals', NOW(), NOW(), 0, 0)`,
            [id, req.user.id, req.user.username, invest]);
        await runQuery('UPDATE users SET balance = balance - ? WHERE id = ?', [invest, req.user.id]);
        await addNotification(req.user.id, 'تم الاستثمار', `استثمار ${invest}$ في المعادن والعملات`);
        await logActivity(req.user.id, 'استثمار جديد', `استثمار ${invest}$`, req.ip);
        res.json({ success: true, message: `تم استثمار ${invest}$` });
    } catch (err) { console.error(err); res.status(500).json({ success: false }); }
});

app.get('/api/investments/my', authenticateToken, async (req, res) => {
    res.json(await allQuery('SELECT * FROM investments WHERE userId = ?', [req.user.id]));
});

app.post('/api/investments/withdraw-profit', authenticateToken, async (req, res) => {
    try {
        const { investmentId } = req.body;
        const [rows] = await db.execute('SELECT * FROM investments WHERE id = ? AND userId = ?', [investmentId, req.user.id]);
        if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'الاستثمار غير موجود' });
        const inv = rows[0];
        const now = new Date(); const lastProfitDate = inv.lastProfitDate ? new Date(inv.lastProfitDate) : new Date(inv.startDate);
        const diffDays = Math.floor((now - lastProfitDate) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) return res.status(400).json({ success: false, message: 'لا توجد أرباح جديدة' });
        const profit = inv.amount * 0.03 * diffDays;
        if (profit < 10) return res.status(400).json({ success: false, message: 'الحد الأدنى لسحب الأرباح 10$' });
        await db.execute('UPDATE users SET profit = profit + ? WHERE id = ?', [profit, req.user.id]);
        await db.execute('UPDATE investments SET withdrawnProfit = withdrawnProfit + ?, lastProfitDate = NOW() WHERE id = ?', [profit, investmentId]);
        await addNotification(req.user.id, 'سحب أرباح', `تم سحب ${profit.toFixed(2)}$ أرباح`);
        await logActivity(req.user.id, 'سحب أرباح استثمار', `سحب ${profit.toFixed(2)}$`, req.ip);
        res.json({ success: true, message: `تم سحب ${profit.toFixed(2)}$ أرباح` });
    } catch (err) { console.error(err); res.status(500).json({ success: false }); }
});

app.post('/api/investments/withdraw-principal', authenticateToken, async (req, res) => {
    try {
        const { investmentId } = req.body;
        const [rows] = await db.execute('SELECT * FROM investments WHERE id = ? AND userId = ?', [investmentId, req.user.id]);
        if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'الاستثمار غير موجود' });
        const inv = rows[0];
        if (inv.withdrawnPrincipal) return res.status(400).json({ success: false, message: 'تم سحب الأصل مسبقاً' });
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [inv.amount, req.user.id]);
        await db.execute('UPDATE investments SET withdrawnPrincipal = 1 WHERE id = ?', [investmentId]);
        await addNotification(req.user.id, 'سحب أصل الاستثمار', `تم إعادة ${inv.amount}$ إلى رصيدك`);
        await logActivity(req.user.id, 'سحب أصل استثمار', `سحب ${inv.amount}$`, req.ip);
        res.json({ success: true, message: `تم سحب أصل الاستثمار ${inv.amount}$` });
    } catch (err) { console.error(err); res.status(500).json({ success: false }); }
});

// ====================== REFERRAL (فريق) ======================
async function processReferralBonus(referredUserId, depositAmount) {
    try {
        const referred = await getQuery('SELECT referrerId FROM users WHERE id = ?', [referredUserId]);
        if (!referred || !referred.referrerId) return;
        const referrer = await getQuery('SELECT id, username FROM users WHERE id = ?', [referred.referrerId]);
        if (!referrer) return;
        const previousDeposits = await getQuery('SELECT COUNT(*) as cnt FROM deposit_requests WHERE userId = ? AND status = "approved"', [referredUserId]);
        if (previousDeposits.cnt > 1) return;
        const bonus = depositAmount * 0.15;
        if (bonus <= 0) return;
        // المكافأة إلى أرباح المُحيل مباشرة
        await db.execute('UPDATE users SET profit = profit + ? WHERE id = ?', [bonus, referrer.id]);
        await addNotification(referrer.id, 'مكافأة فريق', `حصلت على ${bonus.toFixed(2)}$ أرباح من إيداع ${referredUserId}`);
        await logActivity(referrer.id, 'مكافأة فريق (أرباح)', `${bonus.toFixed(2)}$ من إيداع ${referredUserId}`, null);
    } catch (err) { console.error('Referral error:', err); }
}

app.get('/api/referrals/my', authenticateToken, async (req, res) => {
    try {
        const directReferrals = await allQuery('SELECT id, username, email, phoneNumber, createdAt FROM users WHERE referrerId = ?', [req.user.id]);
        let totalEarned = 0; const list = [];
        for (const ref of directReferrals) {
            const firstDep = await getQuery('SELECT amount FROM deposit_requests WHERE userId = ? AND status = "approved" ORDER BY date ASC LIMIT 1', [ref.id]);
            const depositAmount = firstDep ? firstDep.amount : 0;
            const reward = depositAmount * 0.15;
            totalEarned += reward;
            list.push({ username: ref.username, email: ref.email, phoneNumber: ref.phoneNumber, registeredAt: ref.createdAt, depositAmount, reward, status: depositAmount > 0 ? 'eligible' : 'pending' });
        }
        res.json({ success: true, totalReferrals: directReferrals.length, totalEarned, referrals: list });
    } catch (err) { console.error(err); res.status(500).json({ success: false }); }
});

// ====================== NOTIFICATIONS ======================
app.get('/api/notifications', authenticateToken, async (req, res) => {
    res.json(await allQuery('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50', [req.user.id]));
});
app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    await runQuery('UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
});
app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
    await runQuery('UPDATE notifications SET isRead = 1 WHERE userId = ?', [req.user.id]);
    res.json({ success: true });
});

// ====================== ANALYTICS ======================
app.get('/api/analytics/user', authenticateToken, async (req, res) => {
    try {
        const activities = await allQuery(`SELECT DATE(timestamp) as date, SUM(CASE WHEN action LIKE 'إيداع%' OR action LIKE 'ربح%' OR action LIKE 'مكافأة%' THEN 1 ELSE 0 END) as positive_events FROM activity_logs WHERE userId = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY DATE(timestamp)`, [req.user.id]);
        const investments = await allQuery('SELECT projectType, SUM(amount) as total FROM investments WHERE userId = ? GROUP BY projectType', [req.user.id]);
        const investmentDistribution = {}; investments.forEach(inv => { investmentDistribution[inv.projectType] = parseFloat(inv.total); });
        const referralStats = await getQuery('SELECT COUNT(*) as totalReferrals, SUM(amount) as totalEarned FROM referrals WHERE referrerId = ?', [req.user.id]);
        res.json({ dailyBalance: activities, investmentDistribution, referralStats: { totalReferrals: referralStats.totalReferrals || 0, totalEarned: referralStats.totalEarned || 0 } });
    } catch (err) { res.status(500).json({}); }
});

app.get('/api/admin/analytics', authenticateToken, adminOnly, async (req, res) => {
    try {
        const totalDeposits = await getQuery('SELECT SUM(amount) as total FROM deposit_requests WHERE status = "approved"');
        const totalWithdrawals = await getQuery('SELECT SUM(amount) as total FROM withdrawal_requests WHERE status = "approved"');
        const platformProfit = (totalDeposits.total || 0) - (totalWithdrawals.total || 0);
        const referralCommissions = await getQuery('SELECT SUM(amount) as total FROM referrals');
        const totalUsers = await getQuery('SELECT COUNT(*) as count FROM users');
        const userGrowth = await allQuery(`SELECT DATE(createdAt) as date, COUNT(*) as count FROM users WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY DATE(createdAt) ORDER BY date ASC`);
        const dailyDeposits = await allQuery(`SELECT DATE(date) as date, SUM(amount) as total FROM deposit_requests WHERE status = 'approved' AND date >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY DATE(date) ORDER BY date ASC`);
        const topBalanceUsers = await allQuery('SELECT username, balance, profit FROM users ORDER BY balance DESC LIMIT 10');
        const topReferrers = await allQuery(`SELECT u.username, COUNT(r.id) as referralCount FROM users u LEFT JOIN referrals r ON u.id = r.referrerId GROUP BY u.id ORDER BY referralCount DESC LIMIT 10`);
        res.json({ totalDeposits: totalDeposits.total||0, totalWithdrawals: totalWithdrawals.total||0, platformProfit: platformProfit||0, referralCommissions: referralCommissions.total||0, totalUsers: totalUsers.count||0, userGrowth, dailyDeposits, topBalanceUsers, topReferrers });
    } catch (err) { res.status(500).json({}); }
});

// ====================== SUPPORT TICKETS ======================
const ticketUpload = multer({ storage: multerStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => { if (file.mimetype.startsWith('image/')) cb(null, true); else cb(new Error('صور فقط'), false); } });
async function uploadTicketAttachment(buffer, originalname) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({ folder: 'support_tickets', allowed_formats: ['jpg', 'png', 'jpeg', 'webp'] }, (error, result) => { if (error) reject(error); else resolve(result); });
        uploadStream.end(buffer);
    });
}

app.post('/api/support/tickets', authenticateToken, ticketUpload.single('attachment'), async (req, res) => {
    try {
        const { subject, message, priority = 'normal' } = req.body; if (!subject || !message) return res.status(400).json({ success: false, message: 'الموضوع والرسالة مطلوبان' });
        let attachmentUrl = null; if (req.file) { const result = await uploadTicketAttachment(req.file.buffer, req.file.originalname); attachmentUrl = result.secure_url; }
        const id = `TKT_${Date.now()}_${Math.random().toString(36).substr(2,8)}`;
        await runQuery(`INSERT INTO support_tickets (id, userId, username, subject, message, priority, status, attachmentPath, createdAt, updatedAt) VALUES (?,?,?,?,?,?,'open',?,NOW(),NOW())`, [id, req.user.id, req.user.username, subject, message, priority, attachmentUrl]);
        await addNotification(req.user.id, 'تم فتح تذكرة', 'سيتم الرد قريباً'); notifyAdmins('new-ticket', { username: req.user.username, subject });
        res.json({ success: true, ticketId: id });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'حدث خطأ' }); }
});

app.post('/api/support/tickets/guest', async (req, res) => {
    try {
        const { name, subject, message } = req.body; if (!subject || !message) return res.status(400).json({ success: false, message: 'الموضوع والرسالة مطلوبان' });
        const id = `TKT_GUEST_${Date.now()}_${Math.random().toString(36).substr(2,8)}`;
        await runQuery(`INSERT INTO support_tickets (id, userId, username, subject, message, priority, status, createdAt, updatedAt) VALUES (?, NULL, ?, ?, ?, 'normal', 'open', NOW(), NOW())`, [id, name || 'زائر', subject, message]);
        res.json({ success: true, ticketId: id });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'حدث خطأ' }); }
});

app.get('/api/support/tickets', authenticateToken, async (req, res) => {
    res.json(await allQuery('SELECT * FROM support_tickets WHERE userId = ? ORDER BY createdAt DESC', [req.user.id]));
});
app.get('/api/support/tickets/:id', authenticateToken, async (req, res) => {
    const ticket = await getQuery('SELECT * FROM support_tickets WHERE id = ? AND (userId = ? OR ? = "admin")', [req.params.id, req.user.id, req.user.role]);
    if (!ticket) return res.status(404).json({ success: false });
    res.json({ ticket, replies: await allQuery('SELECT * FROM support_replies WHERE ticketId = ? ORDER BY createdAt ASC', [req.params.id]) });
});
app.post('/api/support/tickets/:id/reply', authenticateToken, ticketUpload.single('attachment'), async (req, res) => {
    try {
        const ticket = await getQuery('SELECT * FROM support_tickets WHERE id = ?', [req.params.id]); if (!ticket) return res.status(404).json({ success: false, message: 'التذكرة غير موجودة' });
        if (ticket.userId !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ success: false });
        const { message } = req.body; if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
        let attachmentUrl = null; if (req.file) { const result = await uploadTicketAttachment(req.file.buffer, req.file.originalname); attachmentUrl = result.secure_url; }
        const replyId = `REP_${Date.now()}_${Math.random().toString(36).substr(2,8)}`;
        await runQuery(`INSERT INTO support_replies (id, ticketId, userId, username, message, attachmentPath, createdAt) VALUES (?,?,?,?,?,?,NOW())`, [replyId, req.params.id, req.user.id, req.user.username, message, attachmentUrl]);
        await runQuery('UPDATE support_tickets SET updatedAt = NOW(), status = ? WHERE id = ?', [req.user.role === 'admin' ? 'in_progress' : 'open', req.params.id]);
        if (req.user.role === 'admin') { await addNotification(ticket.userId, 'تم الرد على تذكرتك', `رد على: ${ticket.subject}`); }
        else { notifyAdmins('ticket-reply', { username: req.user.username, subject: ticket.subject }); }
        res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ success: false }); }
});
app.put('/api/admin/support/tickets/:id/status', authenticateToken, adminOnly, async (req, res) => {
    const { status } = req.body; if (!['open','in_progress','closed'].includes(status)) return res.status(400).json({ success: false });
    await runQuery('UPDATE support_tickets SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
});
app.get('/api/admin/support/tickets', authenticateToken, adminOnly, async (req, res) => {
    res.json(await allQuery('SELECT * FROM support_tickets ORDER BY createdAt DESC'));
});

// ====================== ADMIN ======================
app.get('/api/admin/users', authenticateToken, adminOnly, async (req, res) => {
    const { search } = req.query; let query = 'SELECT id, username, fullName, email, phoneNumber, balance, profit, level, createdAt, isVerified, origin, currentLocation, currentJob, work, profession, totalDeposits, referralCode FROM users'; let params = [];
    if (search) { query += ' WHERE username LIKE ? OR email LIKE ? OR phoneNumber LIKE ? OR fullName LIKE ?'; params = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`]; }
    res.json({ users: await allQuery(query + ' ORDER BY createdAt DESC', params) });
});
app.get('/api/admin/user/:id', authenticateToken, adminOnly, async (req, res) => {
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    res.json({ success: true, user: rows[0] });
});
app.post('/api/admin/set-user-balance', authenticateToken, adminOnly, async (req, res) => {
    const { userId, newBalance } = req.body;
    await db.execute('UPDATE users SET balance = ? WHERE id = ?', [parseFloat(newBalance), userId]);
    await logAdminAction(req.user.id, req.user.username, 'set_balance', userId, '', `تعديل الرصيد إلى ${newBalance}`, req.ip);
    res.json({ success: true, message: 'تم تحديث الرصيد' });
});
app.post('/api/admin/reset-user-password', authenticateToken, adminOnly, async (req, res) => {
    const { userId, newPassword } = req.body; const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    await logAdminAction(req.user.id, req.user.username, 'reset_password', userId, '', 'إعادة تعيين كلمة المرور', req.ip);
    res.json({ success: true, message: 'تم تغيير كلمة المرور' });
});
app.get('/api/admin/admin-actions', authenticateToken, adminOnly, async (req, res) => {
    res.json(await allQuery('SELECT * FROM admin_actions ORDER BY timestamp DESC LIMIT 200'));
});
app.get('/api/admin/verify', authenticateToken, (req, res) => res.json({ success: req.user.role === 'admin' }));

app.post('/api/auth/verify-admin-gateway', async (req, res) => {
    try {
        if (req.body.secretPassword === ADMIN_GATEWAY_SECRET) {
            const adminToken = jwt.sign({ id: 'admin_gateway', username: 'admin_gateway', role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
            res.cookie('token', adminToken, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 });
            return res.json({ success: true });
        }
        res.status(401).json({ success: false, message: req.t('invalid_gateway_password') });
    } catch (err) { res.status(500).json({ success: false }); }
});

// ====================== REGISTRATION ======================
app.get('/api/users/check-username', async (req, res) => {
    if (!req.query.username) return res.json({ exists: false });
    const [rows] = await db.execute('SELECT id FROM users WHERE username = ?', [req.query.username]);
    res.json({ exists: rows.length > 0 });
});
app.get('/api/auth/validate-email', async (req, res) => {
    const email = req.query.email; if (!email || !email.includes('@')) return res.json({ valid: false, reason: 'بريد غير صالح' });
    const domain = email.split('@')[1].toLowerCase();
    try { await dns.resolveMx(domain); return res.json({ valid: true }); } catch { return res.json({ valid: false, reason: 'نطاق غير صالح' }); }
});
global.tempCodes = new Map();
app.post('/api/users/register', async (req, res) => {
    try {
        const { username, password, fullName, email, phoneNumber, referrerCode, verificationCode } = req.body;
        if (!username || !password || !fullName) return res.status(400).json({ success: false, message: 'جميع الحقول الأساسية مطلوبة' });
        const cleanEmail = email ? email.trim() : null;
        const cleanPhone = phoneNumber ? phoneNumber.trim() : null;
        if (!cleanEmail && !cleanPhone) return res.status(400).json({ success: false, message: 'يجب إدخال البريد الإلكتروني أو رقم الهاتف' });

        const [existingUser] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
        if (existingUser.length > 0) return res.status(400).json({ success: false, message: 'اسم المستخدم موجود مسبقاً' });

        if (cleanPhone) {
            const digits = cleanPhone.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 15) return res.status(400).json({ success: false, message: 'رقم الهاتف يجب أن يكون بين 10 و15 رقماً' });
        }

        let isVerified = 0;
        if (verificationCode && cleanEmail) {
            const temp = global.tempCodes.get(cleanEmail);
            if (temp && temp.code === verificationCode && Date.now() <= temp.expiresAt) { isVerified = 1; global.tempCodes.delete(cleanEmail); }
        }

        let referrerId = null;
        if (referrerCode) { const [refRows] = await db.execute('SELECT id FROM users WHERE referralCode = ?', [referrerCode]); if (refRows.length > 0) referrerId = refRows[0].id; }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = `USER_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const referralCodeGen = username + "_" + Math.random().toString(36).substr(2, 6);

        await db.execute(
            `INSERT INTO users (id, username, password, fullName, email, phoneNumber, origin, currentLocation, currentJob, work, profession, createdAt, referrerId, referralCode, isVerified, loginAttempts, lockUntil, totalDeposits)
             VALUES (?, ?, ?, ?, ?, ?, 'غير محدد', 'غير محدد', 'غير محدد', 'غير محدد', 'غير محدد', NOW(), ?, ?, ?, 0, NULL, 0)`,
            [userId, username, hashedPassword, fullName, cleanEmail || null, cleanPhone || null, referrerId, referralCodeGen, isVerified]
        );
        res.status(201).json({ success: true, message: 'تم التسجيل بنجاح' });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});
app.post('/api/auth/send-verification', async (req, res) => {
    try { const { email } = req.body; if (!email) return res.status(400).json({ success: false, message: 'البريد مطلوب' }); const code = Math.floor(100000 + Math.random() * 900000).toString(); global.tempCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 }); console.log(`رمز التحقق: ${code}`); res.json({ success: true, message: 'تم إرسال رمز التحقق' }); }
    catch (err) { console.error(err); res.status(500).json({ success: false, message: req.t('server_error') }); }
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.clearCookie('refreshToken'); res.clearCookie('admin_gateway_token'); res.json({ success: true }); });
app.get('/api/activity-logs/recent', authenticateToken, async (req, res) => {
    res.json(await allQuery('SELECT action, details, timestamp FROM activity_logs WHERE userId = ? ORDER BY timestamp DESC LIMIT 50', [req.user.id]));
});

// ====================== CRON ======================
async function distributeMetalProfits() {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [investments] = await connection.execute('SELECT * FROM investments WHERE withdrawnPrincipal = 0 AND projectType = "metals" FOR UPDATE');
        const now = new Date();
        for (const inv of investments) {
            const lastProfitDate = inv.lastProfitDate ? new Date(inv.lastProfitDate) : new Date(inv.startDate);
            const diffDays = Math.floor((now - lastProfitDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 0) {
                const profit = inv.amount * 0.03 * diffDays;
                await connection.execute('UPDATE users SET profit = profit + ? WHERE id = ?', [profit, inv.userId]);
                await connection.execute('UPDATE investments SET lastProfitDate = ? WHERE id = ?', [now, inv.id]);
                await logActivity(inv.userId, 'ربح استثمار معادن وعملات', `ربح ${profit.toFixed(2)}$`);
            }
        }
        await connection.commit();
    } catch (err) { await connection.rollback(); console.error('Profit error:', err); } finally { connection.release(); }
}
cron.schedule('0 * * * *', distributeMetalProfits);

// ====================== SERVE STATIC ======================
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) { app.use(express.static(publicPath)); console.log(`✅ Frontend served from ${publicPath}`); }
app.use('/locales', express.static(path.join(__dirname, 'locales')));

app.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ success: false, message: req.t('server_error') }); });
process.on('uncaughtException', (err) => { console.error('⚠️ Uncaught Exception:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ Unhandled Rejection:', reason); });

(async () => {
    await initDatabase();
    await createTables();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Fargo Server running on http://localhost:${PORT}`);
        console.log(`👑 Admin: freeze / MHDFREEZE0619`);
        console.log(`📌 Metals 3% daily (50$-10,000$) | Team 15%`);
    });
})();
