// ============================================================
// server.js - النسخة النهائية المتكاملة
// ============================================================
// الميزات المضافة:
// - WebSockets (Socket.io) للإشعارات الفورية
// - نظام تذاكر الدعم (Support Tickets) مع إرفاق صور وأولويات
// - مكافآت يومية متتالية (Streak Bonus): 0.5$ (أيام 1-7)، 0.75$ (8-14)، 1$ (15+)
// - منع السحب إلا بعد أول إيداع (totalDeposits > 0)
// - تحليلات وإحصائيات متقدمة للأدمن (رسوم بيانية، تقارير، أعلى المستخدمين)
// - إحالات متدرجة (3 مستويات): أول (10%/15%/25%)، ثاني 5%، ثالث 2.5%
// - مكافأة ترحيبية 5$ بعد أول إيداع بقيمة 50$ فأكثر
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

const multerStorage = multer.memoryStorage();
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
      {
        folder: 'deposits',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
        transformation: [{ width: 1024, height: 1024, crop: 'limit' }]
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
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
                database: process.env.DB_NAME || 'bestdeal',
                port: process.env.DB_PORT || 3306
            });
            console.log('✅ Connected via DB_* variables');
        }
        // Keep connection alive
        setInterval(async () => {
            try {
                await db.query('SELECT 1');
                console.log('✅ Database connection keep-alive');
            } catch (err) {
                console.error('❌ Database connection lost, reconnecting...');
                await initDatabase();
            }
        }, 60000);
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        process.exit(1);
    }
}

async function createTables() {
    // جداول المستخدمين (مع إضافة حقل dailyBonusStreak)
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
        referrerId VARCHAR(50) NULL,
        refreshToken VARCHAR(255),
        loginAttempts INT DEFAULT 0,
        lockUntil DATETIME,
        lastDailyBonus DATE NULL,
        totalDeposits DECIMAL(10,2) DEFAULT 0,
        dailyBonusStreak INT DEFAULT 0
    )`);

    // جداول الإيداعات والسحوبات والاستثمارات (موجودة سابقاً)
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
        type ENUM('profit', 'principal') DEFAULT 'profit',
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

    // جدول الإحالات المتدرجة (سيتم تخزين الإحالات مع المستوى)
    await db.execute(`CREATE TABLE IF NOT EXISTS referrals (
        id VARCHAR(50) PRIMARY KEY,
        referrerId VARCHAR(50) NOT NULL,
        referredId VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        createdAt DATETIME NOT NULL,
        level TINYINT DEFAULT 1,
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

    await db.execute(`CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(100) NOT NULL,
        token VARCHAR(255) NOT NULL,
        expiresAt DATETIME NOT NULL,
        createdAt DATETIME DEFAULT NOW()
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS translations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(50) NOT NULL,
        language_code CHAR(2) NOT NULL,
        field_name VARCHAR(50) NOT NULL,
        translated_value TEXT NOT NULL,
        UNIQUE KEY (entity_type, entity_id, language_code, field_name)
    )`);

    // ====================== جداول نظام التذاكر ======================
    await db.execute(`CREATE TABLE IF NOT EXISTS support_tickets (
        id VARCHAR(50) PRIMARY KEY,
        userId VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        priority ENUM('low', 'normal', 'high') DEFAULT 'normal',
        status ENUM('open', 'in_progress', 'closed') DEFAULT 'open',
        attachmentPath VARCHAR(255),
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS support_replies (
        id VARCHAR(50) PRIMARY KEY,
        ticketId VARCHAR(50) NOT NULL,
        userId VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        attachmentPath VARCHAR(255),
        createdAt DATETIME NOT NULL,
        FOREIGN KEY (ticketId) REFERENCES support_tickets(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // إضافة الأعمدة المفقودة
    try {
        await db.execute(`ALTER TABLE withdrawal_requests ADD COLUMN type ENUM('profit', 'principal') DEFAULT 'profit'`);
        console.log('✅ Added type column to withdrawal_requests');
    } catch (err) {}
    try {
        await db.execute(`ALTER TABLE users ADD COLUMN referrerId VARCHAR(50) NULL`);
        console.log('✅ Added referrerId column');
    } catch (err) {}
    try {
        await db.execute(`ALTER TABLE users ADD COLUMN lastDailyBonus DATE NULL`);
        console.log('✅ Added lastDailyBonus column');
    } catch (err) {}
    try {
        await db.execute(`ALTER TABLE users ADD COLUMN totalDeposits DECIMAL(10,2) DEFAULT 0`);
        console.log('✅ Added totalDeposits column');
    } catch (err) {}
    try {
        await db.execute(`ALTER TABLE users ADD COLUMN dailyBonusStreak INT DEFAULT 0`);
        console.log('✅ Added dailyBonusStreak column');
    } catch (err) {}

    // إنشاء المستخدم الأدمن إذا لم يكن موجوداً
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', ['freeze']);
    if (existing.length === 0) {
        const hashedPassword = await bcrypt.hash('MHDFREEZE0619', 10);
        await db.execute(
            `INSERT INTO users (id, username, password, role, email, fullName, balance, createdAt, isVerified, referralCode, origin, currentLocation, currentJob, level)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1, ?, 'سوريا', 'دمشق', 'مطور', 'ألماسي')`,
            ['FREEZE_ID', 'freeze', hashedPassword, 'admin', 'freeze@bestdeal.com', 'Freeze Admin', 50000, 'freeze_ref']
        );
        console.log('✅ Admin user "freeze" created');
    }
}

// ====================== Helper functions ======================
async function runQuery(sql, params) {
    try {
        const [result] = await db.execute(sql, params);
        return result;
    } catch (err) {
        console.error('❌ SQL Error:', err.message, sql);
        throw err;
    }
}
async function getQuery(sql, params) {
    try {
        const [rows] = await db.execute(sql, params);
        return rows[0];
    } catch (err) {
        console.error('❌ SQL Error:', err.message, sql);
        throw err;
    }
}
async function allQuery(sql, params) {
    try {
        const [rows] = await db.execute(sql, params);
        return rows;
    } catch (err) {
        console.error('❌ SQL Error:', err.message, sql);
        throw err;
    }
}
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
    if (!token) return res.status(401).json({ success: false, message: req.t('unauthorized') });
    try {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ success: false, message: req.t('invalid_token') });
    }
}
function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: req.t('admin_required') });
    next();
}
async function logAdminAction(adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip) {
    await runQuery(
        `INSERT INTO admin_actions (adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [adminId, adminUsername, actionType, targetUserId, targetUsername, details, ip]
    );
}
async function addNotification(userId, title, message) {
    await runQuery(
        `INSERT INTO notifications (userId, title, message, createdAt, isRead) VALUES (?, ?, ?, NOW(), 0)`,
        [userId, title, message]
    );
    // إرسال إشعار فوري عبر WebSocket إذا كان المستخدم متصلاً
    sendNotificationToUser(userId, title, message, 'info');
}

// ====================== WebSocket (Socket.io) ======================
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: true, credentials: true } });
const userSockets = new Map(); // userId -> socketId
const adminSockets = new Set(); // socketIds للأدمن

io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);
    
    socket.on('register-user', (userId) => {
        if (userId) {
            userSockets.set(userId, socket.id);
            console.log(`✅ User ${userId} registered with socket ${socket.id}`);
        }
    });
    
    socket.on('register-admin', (adminId) => {
        adminSockets.add(socket.id);
        userSockets.set(adminId, socket.id);
        console.log(`👑 Admin ${adminId} registered`);
    });
    
    socket.on('disconnect', () => {
        for (let [userId, socketId] of userSockets.entries()) {
            if (socketId === socket.id) {
                userSockets.delete(userId);
                adminSockets.delete(socketId);
                console.log(`❌ User ${userId} disconnected`);
                break;
            }
        }
    });
});

function sendNotificationToUser(userId, title, message, type = 'info') {
    const socketId = userSockets.get(userId);
    if (socketId) {
        io.to(socketId).emit('notification', { title, message, type, timestamp: new Date() });
        console.log(`📢 Notification sent to user ${userId}: ${title}`);
    }
}

function notifyAdmins(event, data) {
    adminSockets.forEach(socketId => {
        io.to(socketId).emit(event, data);
    });
}

// ====================== تحديث المستوى ومكافآت الرتب ======================
async function updateUserLevel(userId) {
    try {
        const [user] = await db.execute('SELECT balance, level FROM users WHERE id = ?', [userId]);
        if (!user.length) return;
        const balance = parseFloat(user[0].balance);
        const currentLevel = user[0].level;
        let newLevel = 'برونزي';
        let levelBonus = 0;
        if (balance >= 5000) { newLevel = 'ألماسي'; levelBonus = 500; }
        else if (balance >= 1000) { newLevel = 'ذهبي'; levelBonus = 50; }
        else if (balance >= 300) { newLevel = 'فضي'; levelBonus = 25; }
        if (currentLevel !== newLevel) {
            await db.execute('UPDATE users SET level = ? WHERE id = ?', [newLevel, userId]);
            console.log(`✅ User ${userId} level updated to ${newLevel}`);
            if (levelBonus > 0) {
                await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [levelBonus, userId]);
                await addNotification(userId, 'مكافأة ترقية المستوى', `تهانينا! تمت ترقيتك إلى المستوى ${newLevel} وحصلت على مكافأة ${levelBonus}$ فوراً.`);
            } else {
                await addNotification(userId, 'ترقية المستوى', `تهانينا! تمت ترقيتك إلى المستوى ${newLevel}`);
            }
        }
    } catch (err) { console.error('Error updating level:', err); }
}

// ====================== نظام الإحالات المتدرجة (3 مستويات) ======================
async function processReferralBonus(referredUserId, depositAmount) {
    try {
        // الحصول على المُحيل المباشر (المستوى الأول)
        const referred = await getQuery('SELECT referrerId FROM users WHERE id = ?', [referredUserId]);
        if (!referred || !referred.referrerId) return;
        const firstReferrerId = referred.referrerId;
        
        // جلب بيانات المُحيل الأول
        const firstReferrer = await getQuery('SELECT id, level, username FROM users WHERE id = ?', [firstReferrerId]);
        if (!firstReferrer) return;
        
        // تحديد نسبة المكافأة للمستوى الأول حسب مستوى المُحيل
        let firstBonusPercentage = 0;
        if (firstReferrer.level === 'ألماسي') firstBonusPercentage = 25;
        else if (firstReferrer.level === 'ذهبي') firstBonusPercentage = 15;
        else if (firstReferrer.level === 'فضي') firstBonusPercentage = 10;
        else if (firstReferrer.level === 'برونزي' && depositAmount >= 50) firstBonusPercentage = 2; // مكافأة ثابتة 2$ تعامل كنسبة 2$ من المبلغ؟ سنتعامل معها كمبلغ ثابت
        
        let firstBonusAmount = 0;
        if (firstBonusPercentage > 0) {
            if (firstReferrer.level === 'برونزي') firstBonusAmount = 2;
            else firstBonusAmount = depositAmount * (firstBonusPercentage / 100);
        }
        
        if (firstBonusAmount > 0) {
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [firstBonusAmount, firstReferrer.id]);
            await addNotification(firstReferrer.id, 'مكافأة إحالة (مستوى أول)', `حصلت على مكافأة إحالة بقيمة ${firstBonusAmount.toFixed(2)}$ من إيداع المُحال ${depositAmount}$.`);
            console.log(`✅ Level 1 referral bonus ${firstBonusAmount}$ to ${firstReferrer.username}`);
        }
        
        // المستوى الثاني: المُحيل الثاني (الذي دعا المُحيل الأول)
        const secondReferrer = await getQuery('SELECT referrerId FROM users WHERE id = ?', [firstReferrerId]);
        if (secondReferrer && secondReferrer.referrerId) {
            const secondReferrerData = await getQuery('SELECT id, username FROM users WHERE id = ?', [secondReferrer.referrerId]);
            if (secondReferrerData) {
                const secondBonusAmount = depositAmount * 0.05; // 5%
                if (secondBonusAmount > 0) {
                    await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [secondBonusAmount, secondReferrerData.id]);
                    await addNotification(secondReferrerData.id, 'مكافأة إحالة (مستوى ثاني)', `حصلت على مكافأة إحالة من المستوى الثاني بقيمة ${secondBonusAmount.toFixed(2)}$ من إيداع المُحال ${depositAmount}.`);
                    console.log(`✅ Level 2 referral bonus ${secondBonusAmount}$ to ${secondReferrerData.username}`);
                }
            }
        }
        
        // المستوى الثالث: المُحيل الثالث
        const thirdReferrer = await getQuery('SELECT referrerId FROM users WHERE id = ?', [secondReferrer?.referrerId]);
        if (thirdReferrer && thirdReferrer.referrerId) {
            const thirdReferrerData = await getQuery('SELECT id, username FROM users WHERE id = ?', [thirdReferrer.referrerId]);
            if (thirdReferrerData) {
                const thirdBonusAmount = depositAmount * 0.025; // 2.5%
                if (thirdBonusAmount > 0) {
                    await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [thirdBonusAmount, thirdReferrerData.id]);
                    await addNotification(thirdReferrerData.id, 'مكافأة إحالة (مستوى ثالث)', `حصلت على مكافأة إحالة من المستوى الثالث بقيمة ${thirdBonusAmount.toFixed(2)}$ من إيداع المُحال ${depositAmount}.`);
                    console.log(`✅ Level 3 referral bonus ${thirdBonusAmount}$ to ${thirdReferrerData.username}`);
                }
            }
        }
    } catch (err) { console.error('Error processing multi-level referral bonus:', err); }
}

// ====================== نظام المكافآت اليومية المتتالية (Streak Bonus) ======================
async function getDailyBonusAmount(streak) {
    if (streak >= 15) return 1.0;
    if (streak >= 8) return 0.75;
    return 0.5;
}

// ====================== Middleware ======================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { success: false, message: 'Too many requests' } });
const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { success: false, message: 'Too many attempts' } });
const depositLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 5, message: { success: false, message: 'Max 5 deposit requests per day' } });
const withdrawLimiter = rateLimit({ windowMs: 24 * 60 * 60 * 1000, max: 3, message: { success: false, message: 'Max 3 withdrawal requests per day' } });

app.use('/api/', globalLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/deposits/add', depositLimiter);
app.use('/api/withdrawals/add', withdrawLimiter);

// ====================== AUTH ROUTES ======================
app.post('/api/users/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: req.t('login_required_fields') });

        const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ success: false, message: req.t('invalid_credentials') });

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            await runQuery('UPDATE users SET loginAttempts = loginAttempts + 1 WHERE id = ?', [user.id]);
            return res.status(401).json({ success: false, message: req.t('invalid_credentials') });
        }
        await runQuery('UPDATE users SET loginAttempts = 0 WHERE id = ?', [user.id]);

        const token = generateToken(user.id, user.username, user.role);
        const refreshToken = generateRefreshToken(user.id);
        await runQuery('UPDATE users SET refreshToken = ? WHERE id = ?', [refreshToken, user.id]);

        res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 15 * 60 * 1000 });
        res.cookie('refreshToken', refreshToken, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 7 * 24 * 60 * 60 * 1000 });

        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
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
    } catch (err) {
        res.status(403).json({ success: false });
    }
});

app.get('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery('SELECT id, username, role, fullName, email, balance, profit, level, isVerified, origin, currentLocation, currentJob, work, profession, referralCode, totalDeposits FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false, message: req.t('user_not_found') });
        const withdrawableAmount = (user.balance || 0) + (user.profit || 0);
        res.json({ ...user, withdrawableAmount });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/users/update-balance', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { balance, profit, level } = req.body;
        if (balance !== undefined) await runQuery('UPDATE users SET balance = ? WHERE id = ?', [balance, req.user.id]);
        if (profit !== undefined) await runQuery('UPDATE users SET profit = ? WHERE id = ?', [profit, req.user.id]);
        if (level !== undefined) await runQuery('UPDATE users SET level = ? WHERE id = ?', [level, req.user.id]);
        await updateUserLevel(req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ====================== DEPOSIT ROUTES ======================
app.post('/api/deposits/add', authenticateToken, upload.single('screenshot'), async (req, res) => {
    try {
        const { amount, method = 'USDT' } = req.body;
        const file = req.file;
        if (!amount || amount <= 0) return res.status(400).json({ success: false, message: req.t('invalid_amount') });
        if (!file) return res.status(400).json({ success: false, message: req.t('screenshot_required') });

        const uploadResult = await uploadToCloudinary(file.buffer, file.originalname);
        const screenshotUrl = uploadResult.secure_url;

        const id = `DEP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO deposit_requests (id, userId, username, amount, method, screenshotPath, date, status)
             VALUES (?, ?, ?, ?, ?, ?, NOW(), 'pending')`,
            [id, req.user.id, req.user.username, parseFloat(amount), method, screenshotUrl]
        );
        // إشعار للمشرفين
        notifyAdmins('new-deposit-request', { username: req.user.username, amount: parseFloat(amount) });
        res.json({ success: true, message: req.t('deposit_submitted') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('deposit_error') });
    }
});

app.get('/api/admin/deposits', authenticateToken, adminOnly, async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM deposit_requests WHERE status = "pending" ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/deposits/my', authenticateToken, async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM deposit_requests WHERE userId = ? ORDER BY date DESC', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

app.post('/api/admin/deposits/:id/approve', authenticateToken, adminOnly, async (req, res) => {
    try {
        const depositId = req.params.id;
        const deposit = await getQuery('SELECT * FROM deposit_requests WHERE id = ?', [depositId]);
        if (!deposit || deposit.status !== 'pending') return res.status(404).json({ success: false, message: req.t('deposit_not_found') });
        const { userId, amount, username } = deposit;
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, userId]);
        await db.execute('UPDATE deposit_requests SET status = "approved" WHERE id = ?', [depositId]);
        await db.execute('UPDATE users SET totalDeposits = totalDeposits + ? WHERE id = ?', [amount, userId]);
        
        // مكافأة ترحيبية (5$) لأول إيداع بقيمة 50$ فأكثر
        const userTotalDeposits = await getQuery('SELECT totalDeposits FROM users WHERE id = ?', [userId]);
        if (userTotalDeposits.totalDeposits === amount && amount >= 50) {
            await db.execute('UPDATE users SET balance = balance + 5 WHERE id = ?', [userId]);
            await addNotification(userId, '🎁 مكافأة ترحيبية', `شكراً لانضمامك! حصلت على مكافأة ترحيبية بقيمة 5$ بعد إيداعك الأول.`);
        }
        
        await logAdminAction(req.user.id, req.user.username, 'approve_deposit', userId, username, `قبول إيداع بمبلغ ${amount}$`, req.ip);
        await addNotification(userId, req.t('deposit_approved_title'), req.t('deposit_approved_message', { amount }));
        await processReferralBonus(userId, amount);
        res.json({ success: true, message: req.t('deposit_approved') });
    } catch (error) {
        console.error('Error approving deposit:', error);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/admin/deposits/:id/reject', authenticateToken, adminOnly, async (req, res) => {
    try {
        const depositId = req.params.id;
        const deposit = await getQuery('SELECT * FROM deposit_requests WHERE id = ?', [depositId]);
        if (!deposit || deposit.status !== 'pending') return res.status(404).json({ success: false, message: req.t('deposit_not_found') });
        await db.execute('UPDATE deposit_requests SET status = "rejected" WHERE id = ?', [depositId]);
        await logAdminAction(req.user.id, req.user.username, 'reject_deposit', deposit.userId, deposit.username, `رفض إيداع بمبلغ ${deposit.amount}$`, req.ip);
        await addNotification(deposit.userId, req.t('deposit_rejected_title'), req.t('deposit_rejected_message', { amount: deposit.amount }));
        res.json({ success: true, message: req.t('deposit_rejected') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/admin/deposits/:id/:action', authenticateToken, adminOnly, async (req, res) => {
    const { id, action } = req.params;
    if (action === 'approve') {
        req.params.id = id;
        return app.handle(req, res, { ...req, url: `/api/admin/deposits/${id}/approve`, method: 'POST' });
    } else if (action === 'reject') {
        req.params.id = id;
        return app.handle(req, res, { ...req, url: `/api/admin/deposits/${id}/reject`, method: 'POST' });
    } else {
        return res.status(400).json({ success: false, message: req.t('invalid_action') });
    }
});

// ====================== WITHDRAWAL ROUTES (مع منع السحب بدون إيداع) ======================
app.post('/api/withdrawals/add', authenticateToken, async (req, res) => {
    try {
        const { walletAddress, amount, type } = req.body;
        if (!walletAddress || !amount || !type) {
            return res.status(400).json({ success: false, message: req.t('withdrawal_missing_fields') });
        }
        const withdrawAmount = parseFloat(amount);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
            return res.status(400).json({ success: false, message: req.t('invalid_amount') });
        }
        if (type !== 'profit' && type !== 'principal') {
            return res.status(400).json({ success: false, message: req.t('invalid_withdrawal_type') });
        }

        const user = await getQuery('SELECT balance, profit, totalDeposits FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false, message: req.t('user_not_found') });
        
        // منع السحب إذا لم يقم المستخدم بأي إيداع سابق
        if ((user.totalDeposits || 0) <= 0) {
            return res.status(400).json({ success: false, message: 'لا يمكنك السحب قبل القيام بأول إيداع.' });
        }

        if (type === 'profit') {
            const profitBalance = parseFloat(user.profit) || 0;
            if (withdrawAmount > profitBalance) {
                return res.status(400).json({ success: false, message: req.t('insufficient_profit', { balance: profitBalance.toFixed(2) }) });
            }
        } else {
            const balanceAmount = parseFloat(user.balance) || 0;
            if (withdrawAmount > balanceAmount) {
                return res.status(400).json({ success: false, message: req.t('insufficient_balance', { balance: balanceAmount.toFixed(2) }) });
            }
        }

        const id = `WIT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO withdrawal_requests (id, userId, username, amount, walletAddress, type, status, date)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [id, req.user.id, req.user.username, withdrawAmount, walletAddress, type]
        );
        await addNotification(req.user.id, req.t('withdrawal_request_title'), req.t('withdrawal_request_message', { amount: withdrawAmount, type: type === 'profit' ? req.t('profit') : req.t('principal') }));
        notifyAdmins('new-withdrawal-request', { username: req.user.username, amount: withdrawAmount, type });
        res.json({ success: true, message: req.t('withdrawal_submitted') });
    } catch (err) {
        console.error('Withdrawal error:', err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.get('/api/admin/withdrawals', authenticateToken, adminOnly, async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM withdrawal_requests ORDER BY date DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/withdrawals/my', authenticateToken, async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM withdrawal_requests WHERE userId = ? ORDER BY date DESC', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

app.post('/api/admin/withdrawals/:id/approve', authenticateToken, adminOnly, async (req, res) => {
    try {
        const withdrawalId = req.params.id;
        const request = await getQuery('SELECT * FROM withdrawal_requests WHERE id = ?', [withdrawalId]);
        if (!request || request.status !== 'pending') return res.status(404).json({ success: false, message: req.t('withdrawal_not_found') });
        const { userId, amount, username, walletAddress, type } = request;
        const withdrawAmount = parseFloat(amount);
        const user = await getQuery('SELECT balance, profit FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ success: false, message: req.t('user_not_found') });
        let newBalance = parseFloat(user.balance);
        let newProfit = parseFloat(user.profit);
        if (type === 'profit') {
            if (newProfit < withdrawAmount) return res.status(400).json({ success: false, message: req.t('insufficient_profit_balance') });
            newProfit -= withdrawAmount;
        } else {
            if (newBalance < withdrawAmount) return res.status(400).json({ success: false, message: req.t('insufficient_principal_balance') });
            newBalance -= withdrawAmount;
        }
        await db.execute('UPDATE users SET balance = ?, profit = ? WHERE id = ?', [newBalance, newProfit, userId]);
        await db.execute('UPDATE withdrawal_requests SET status = "approved" WHERE id = ?', [withdrawalId]);
        await logAdminAction(req.user.id, req.user.username, 'approve_withdrawal', userId, username, `قبول سحب ${type === 'profit' ? 'أرباح' : 'أصل'} بمبلغ ${withdrawAmount}$ إلى عنوان ${walletAddress}`, req.ip);
        await addNotification(userId, req.t('withdrawal_approved_title'), req.t('withdrawal_approved_message', { amount: withdrawAmount, type: type === 'profit' ? req.t('profit') : req.t('principal') }));
        res.json({ success: true, message: req.t('withdrawal_approved') });
    } catch (err) {
        console.error('Error approving withdrawal:', err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/admin/withdrawals/:id/reject', authenticateToken, adminOnly, async (req, res) => {
    try {
        const withdrawalId = req.params.id;
        const request = await getQuery('SELECT * FROM withdrawal_requests WHERE id = ?', [withdrawalId]);
        if (!request || request.status !== 'pending') return res.status(404).json({ success: false, message: req.t('withdrawal_not_found') });
        await db.execute('UPDATE withdrawal_requests SET status = "rejected" WHERE id = ?', [withdrawalId]);
        await logAdminAction(req.user.id, req.user.username, 'reject_withdrawal', request.userId, request.username, `رفض سحب ${request.type === 'profit' ? 'أرباح' : 'أصل'} بمبلغ ${request.amount}$`, req.ip);
        await addNotification(request.userId, req.t('withdrawal_rejected_title'), req.t('withdrawal_rejected_message', { amount: request.amount }));
        res.json({ success: true, message: req.t('withdrawal_rejected') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/admin/withdrawals/:id/:action', authenticateToken, adminOnly, async (req, res) => {
    const { id, action } = req.params;
    if (action === 'approve') {
        req.params.id = id;
        return app.handle(req, res, { ...req, url: `/api/admin/withdrawals/${id}/approve`, method: 'POST' });
    } else if (action === 'reject') {
        req.params.id = id;
        return app.handle(req, res, { ...req, url: `/api/admin/withdrawals/${id}/reject`, method: 'POST' });
    } else {
        return res.status(400).json({ success: false, message: req.t('invalid_action') });
    }
});

// ====================== INVESTMENT ROUTES (بما في ذلك VIP) ======================
app.post('/api/investments/create', authenticateToken, async (req, res) => {
    try {
        const { amount, projectType } = req.body;
        const user = await getQuery('SELECT balance FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ success: false });
        let min = 0;
        if (projectType === 'daily') min = 90;
        else if (projectType === 'weekly') min = 285;
        else if (projectType === 'monthly') min = 490;
        else if (projectType === 'vip') min = 5000;
        else return res.status(400).json({ success: false });
        const invest = parseFloat(amount);
        if (isNaN(invest) || invest < min) return res.status(400).json({ success: false, message: req.t('min_investment', { min }) });
        if (invest > user.balance) return res.status(400).json({ success: false, message: req.t('insufficient_balance') });
        const id = `INV_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO investments (id, userId, username, amount, projectType, startDate, lastProfitDate, withdrawnProfit, withdrawnPrincipal)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 0, 0)`,
            [id, req.user.id, req.user.username, invest, projectType]
        );
        await runQuery('UPDATE users SET balance = balance - ? WHERE id = ?', [invest, req.user.id]);
        await updateUserLevel(req.user.id);
        await addNotification(req.user.id, req.t('investment_created_title'), req.t('investment_created_message', { amount: invest, type: req.t(projectType) }));
        res.json({ success: true, message: req.t('investment_created') });
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
        res.status(500).json({ success: false });
    }
});

app.post('/api/investments/withdraw-profit', authenticateToken, async (req, res) => {
    try {
        const { investmentId } = req.body;
        const [rows] = await db.execute('SELECT * FROM investments WHERE id = ? AND userId = ?', [investmentId, req.user.id]);
        if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: req.t('investment_not_found') });
        const inv = rows[0];
        const now = new Date();
        const lastProfitDate = inv.lastProfitDate ? new Date(inv.lastProfitDate) : new Date(inv.startDate);
        let profit = 0;
        let canWithdraw = false;
        if (inv.projectType === 'daily') {
            const diffDays = Math.floor((now - lastProfitDate) / (1000 * 60 * 60 * 24));
            if (diffDays > 0) { profit = inv.amount * 0.05 * diffDays; canWithdraw = true; }
        } else if (inv.projectType === 'weekly') {
            const diffDays = Math.floor((now - lastProfitDate) / (1000 * 60 * 60 * 24));
            if (diffDays >= 7) { const weeks = Math.floor(diffDays / 7); profit = inv.amount * 0.08 * 7 * weeks; canWithdraw = true; }
        } else if (inv.projectType === 'monthly') {
            return res.status(400).json({ success: false, message: req.t('monthly_withdraw_profit_disabled') });
        } else if (inv.projectType === 'vip') {
            return res.status(400).json({ success: false, message: 'في مشروع VIP، يتم سحب الربح مع الأصل بعد 30 يوم.' });
        }
        if (!canWithdraw || profit <= 0) return res.status(400).json({ success: false, message: req.t('no_profit_to_withdraw') });
        await db.execute('UPDATE users SET profit = profit + ? WHERE id = ?', [profit, req.user.id]);
        await db.execute('UPDATE investments SET withdrawnProfit = withdrawnProfit + ?, lastProfitDate = NOW() WHERE id = ?', [profit, investmentId]);
        await updateUserLevel(req.user.id);
        await addNotification(req.user.id, req.t('profit_withdrawn_title'), req.t('profit_withdrawn_message', { profit }));
        res.json({ success: true, message: req.t('profit_withdrawn', { profit }) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/investments/withdraw-principal', authenticateToken, async (req, res) => {
    try {
        const { investmentId } = req.body;
        const [rows] = await db.execute('SELECT * FROM investments WHERE id = ? AND userId = ?', [investmentId, req.user.id]);
        if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: req.t('investment_not_found') });
        const inv = rows[0];
        if (inv.withdrawnPrincipal) return res.status(400).json({ success: false, message: req.t('principal_already_withdrawn') });
        const now = new Date();
        const startDate = new Date(inv.startDate);
        const daysPassed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        let canWithdrawPrincipal = false;
        let totalReturn = inv.amount;
        if (inv.projectType === 'daily' && daysPassed >= 10) canWithdrawPrincipal = true;
        else if (inv.projectType === 'weekly' && daysPassed >= 15) canWithdrawPrincipal = true;
        else if (inv.projectType === 'monthly' && daysPassed >= 30) { canWithdrawPrincipal = true; totalReturn = inv.amount * 4; }
        else if (inv.projectType === 'vip' && daysPassed >= 30) { canWithdrawPrincipal = true; totalReturn = inv.amount * 5; }
        if (!canWithdrawPrincipal) {
            let required = (inv.projectType === 'monthly' || inv.projectType === 'vip') ? 30 : (inv.projectType === 'weekly' ? 15 : 10);
            return res.status(400).json({ success: false, message: req.t('cannot_withdraw_principal', { days: required }) });
        }
        await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [totalReturn, req.user.id]);
        await db.execute('UPDATE investments SET withdrawnPrincipal = 1 WHERE id = ?', [investmentId]);
        await addNotification(req.user.id, req.t('principal_withdrawn_title'), req.t('principal_withdrawn_message', { amount: totalReturn }));
        res.json({ success: true, message: req.t('principal_withdrawn') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

// ====================== REFERRAL ROUTES (متدرجة) ======================
app.get('/api/referrals/my', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery('SELECT username, level, referralCode FROM users WHERE id = ?', [req.user.id]);
        // الإحالات المباشرة (المستوى الأول)
        const directReferrals = await allQuery('SELECT id, username, email, createdAt, balance FROM users WHERE referrerId = ?', [req.user.id]);
        let totalEarned = 0;
        const referralsList = [];
        
        for (const ref of directReferrals) {
            const firstDeposit = await getQuery('SELECT amount FROM deposit_requests WHERE userId = ? AND status = "approved" ORDER BY date ASC LIMIT 1', [ref.id]);
            const depositAmount = firstDeposit ? firstDeposit.amount : 0;
            let reward = 0;
            if (user.level === 'ألماسي') reward = depositAmount * 0.25;
            else if (user.level === 'ذهبي') reward = depositAmount * 0.15;
            else if (user.level === 'فضي') reward = depositAmount * 0.10;
            else if (user.level === 'برونزي' && depositAmount >= 50) reward = 2;
            totalEarned += reward;
            referralsList.push({
                username: ref.username,
                email: ref.email,
                registeredAt: ref.createdAt,
                depositAmount: depositAmount,
                reward,
                status: reward > 0 ? req.t('eligible') : req.t('pending'),
                level: 1
            });
        }
        
        // المستوى الثاني (إحالات المُحالين المباشرين)
        const secondLevelReferrals = [];
        for (const ref of directReferrals) {
            const secondLevel = await allQuery('SELECT username, email, createdAt, balance FROM users WHERE referrerId = ?', [ref.id]);
            for (const sref of secondLevel) {
                const firstDeposit = await getQuery('SELECT amount FROM deposit_requests WHERE userId = ? AND status = "approved" ORDER BY date ASC LIMIT 1', [sref.id]);
                const depositAmount = firstDeposit ? firstDeposit.amount : 0;
                const reward2 = depositAmount * 0.05;
                totalEarned += reward2;
                referralsList.push({
                    username: sref.username,
                    email: sref.email,
                    registeredAt: sref.createdAt,
                    depositAmount: depositAmount,
                    reward: reward2,
                    status: reward2 > 0 ? req.t('eligible') : req.t('pending'),
                    level: 2
                });
                // المستوى الثالث
                const thirdLevel = await allQuery('SELECT username, email, createdAt, balance FROM users WHERE referrerId = ?', [sref.id]);
                for (const tref of thirdLevel) {
                    const depositAmount3 = (await getQuery('SELECT amount FROM deposit_requests WHERE userId = ? AND status = "approved" ORDER BY date ASC LIMIT 1', [tref.id]))?.amount || 0;
                    const reward3 = depositAmount3 * 0.025;
                    totalEarned += reward3;
                    referralsList.push({
                        username: tref.username,
                        email: tref.email,
                        registeredAt: tref.createdAt,
                        depositAmount: depositAmount3,
                        reward: reward3,
                        status: reward3 > 0 ? req.t('eligible') : req.t('pending'),
                        level: 3
                    });
                }
            }
        }
        
        const referralLink = `${req.protocol}://${req.get('host')}/register.html?ref=${user.referralCode || ''}`;
        res.json({ success: true, referralLink, totalReferrals: directReferrals.length, totalEarned, referrals: referralsList });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// مسابقة الشهر (نفس السابق)
app.get('/api/referrals/contest', authenticateToken, async (req, res) => {
    try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const startOfMonth = `${year}-${month.toString().padStart(2,'0')}-01 00:00:00`;
        const endOfMonth = new Date(year, month, 0, 23, 59, 59);
        const leaderboard = await allQuery(
            `SELECT u.username, COUNT(r.id) as referralsCount
             FROM referrals r
             JOIN users u ON r.referrerId = u.id
             WHERE r.createdAt >= ? AND r.createdAt <= ?
             GROUP BY u.id
             ORDER BY referralsCount DESC
             LIMIT 10`,
            [startOfMonth, endOfMonth]
        );
        let userRank = null;
        if (leaderboard.length) {
            const userIndex = leaderboard.findIndex(entry => entry.username === req.user.username);
            if (userIndex !== -1) userRank = userIndex + 1;
        }
        res.json({ month: `${year}/${month}`, leaderboard, userRank });
    } catch (err) {
        console.error(err);
        res.status(500).json({ leaderboard: [], userRank: null });
    }
});

// ====================== NOTIFICATIONS ======================
app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        await runQuery('UPDATE notifications SET isRead = 1 WHERE id = ? AND userId = ?', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await runQuery('UPDATE notifications SET isRead = 1 WHERE userId = ?', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ====================== DAILY BONUS (Streak) ======================
app.get('/api/daily-bonus/status', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery('SELECT totalDeposits, lastDailyBonus, dailyBonusStreak FROM users WHERE id = ?', [req.user.id]);
        const hasDeposit = (user.totalDeposits || 0) > 0;
        if (!hasDeposit) {
            return res.json({ canClaim: false, reason: 'يجب أن تقوم بإيداع أولاً لتفعيل المكافأة اليومية' });
        }
        const today = new Date().toISOString().slice(0,10);
        const lastBonus = user.lastDailyBonus ? user.lastDailyBonus.toISOString().slice(0,10) : null;
        const canClaim = (lastBonus !== today);
        let currentStreak = user.dailyBonusStreak || 0;
        if (lastBonus) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().slice(0,10);
            if (lastBonus !== yesterdayStr && lastBonus !== today) {
                // تم تفويت يوم -> إعادة تعيين السلسلة
                currentStreak = 0;
                await db.execute('UPDATE users SET dailyBonusStreak = 0 WHERE id = ?', [req.user.id]);
            }
        }
        const nextBonusAmount = await getDailyBonusAmount(currentStreak);
        res.json({ canClaim, lastClaimDate: user.lastDailyBonus, currentStreak, nextBonusAmount });
    } catch (err) {
        console.error(err);
        res.status(500).json({ canClaim: false });
    }
});

app.post('/api/daily-bonus/claim', authenticateToken, async (req, res) => {
    try {
        const user = await getQuery('SELECT totalDeposits, lastDailyBonus, dailyBonusStreak, balance, profit FROM users WHERE id = ?', [req.user.id]);
        if ((user.totalDeposits || 0) <= 0) {
            return res.status(400).json({ success: false, message: 'لا يمكنك الحصول على المكافأة اليومية بدون أي إيداع سابق' });
        }
        const today = new Date().toISOString().slice(0,10);
        const lastBonus = user.lastDailyBonus ? user.lastDailyBonus.toISOString().slice(0,10) : null;
        if (lastBonus === today) {
            return res.status(400).json({ success: false, message: 'لقد حصلت على مكافأة اليوم بالفعل' });
        }
        let currentStreak = user.dailyBonusStreak || 0;
        if (lastBonus) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().slice(0,10);
            if (lastBonus === yesterdayStr) {
                currentStreak++;
            } else {
                currentStreak = 1;
            }
        } else {
            currentStreak = 1;
        }
        const bonusAmount = await getDailyBonusAmount(currentStreak);
        await db.execute('UPDATE users SET profit = profit + ?, lastDailyBonus = CURDATE(), dailyBonusStreak = ? WHERE id = ?', [bonusAmount, currentStreak, req.user.id]);
        await addNotification(req.user.id, 'مكافأة يومية', `لقد حصلت على مكافأة يومية بقيمة ${bonusAmount}$ (السلسلة: ${currentStreak} يوم)`);
        res.json({ success: true, message: `تم إضافة ${bonusAmount}$ إلى أرباحك`, amount: bonusAmount, streak: currentStreak });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ' });
    }
});

// ====================== ANALYTICS (للمستخدم) ======================
app.get('/api/analytics/user', authenticateToken, async (req, res) => {
    try {
        const activities = await allQuery(
            `SELECT DATE(timestamp) as date, 
                    SUM(CASE WHEN action LIKE 'إيداع%' OR action LIKE 'ربح%' OR action LIKE 'مكافأة%' THEN 1 ELSE 0 END) as positive_events,
                    SUM(CASE WHEN action LIKE 'سحب%' OR action LIKE 'استثمار%' THEN 1 ELSE 0 END) as negative_events
             FROM activity_logs 
             WHERE userId = ? AND timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(timestamp)`,
            [req.user.id]
        );
        const investments = await allQuery('SELECT projectType, SUM(amount) as total FROM investments WHERE userId = ? GROUP BY projectType', [req.user.id]);
        const investmentDistribution = {};
        investments.forEach(inv => { investmentDistribution[inv.projectType] = parseFloat(inv.total); });
        const referralStats = await getQuery('SELECT COUNT(*) as totalReferrals, SUM(amount) as totalEarned FROM referrals WHERE referrerId = ?', [req.user.id]);
        res.json({
            dailyBalance: activities,
            investmentDistribution,
            referralStats: {
                totalReferrals: referralStats.totalReferrals || 0,
                totalEarned: referralStats.totalEarned || 0
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({});
    }
});

// ====================== ADMIN ANALYTICS (متقدم) ======================
app.get('/api/admin/analytics', authenticateToken, adminOnly, async (req, res) => {
    try {
        // إجمالي الإيداعات المعتمدة
        const totalDeposits = await getQuery('SELECT SUM(amount) as total FROM deposit_requests WHERE status = "approved"');
        // إجمالي السحوبات المعتمدة
        const totalWithdrawals = await getQuery('SELECT SUM(amount) as total FROM withdrawal_requests WHERE status = "approved"');
        // أرباح المنصة (العمولات + رسوم؟ يمكن حسابها كإجمالي إيداعات - سحوبات)
        const platformProfit = (totalDeposits.total || 0) - (totalWithdrawals.total || 0);
        // عمولات الإحالات (المجموع من referrals)
        const referralCommissions = await getQuery('SELECT SUM(amount) as total FROM referrals');
        // عدد المستخدمين
        const totalUsers = await getQuery('SELECT COUNT(*) as count FROM users');
        // رسم بياني لتطور عدد المستخدمين خلال آخر 30 يوم
        const userGrowth = await allQuery(
            `SELECT DATE(createdAt) as date, COUNT(*) as count
             FROM users
             WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(createdAt)
             ORDER BY date ASC`
        );
        // رسم بياني للإيداعات اليومية
        const dailyDeposits = await allQuery(
            `SELECT DATE(date) as date, SUM(amount) as total
             FROM deposit_requests
             WHERE status = 'approved' AND date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(date)
             ORDER BY date ASC`
        );
        // أعلى 10 مستخدمين حسب الرصيد
        const topBalanceUsers = await allQuery('SELECT username, balance, profit FROM users ORDER BY balance DESC LIMIT 10');
        // أعلى 10 مستخدمين حسب عدد الإحالات
        const topReferrers = await allQuery(
            `SELECT u.username, COUNT(r.id) as referralCount
             FROM users u
             LEFT JOIN referrals r ON u.id = r.referrerId
             GROUP BY u.id
             ORDER BY referralCount DESC
             LIMIT 10`
        );
        
        res.json({
            totalDeposits: totalDeposits.total || 0,
            totalWithdrawals: totalWithdrawals.total || 0,
            platformProfit: platformProfit || 0,
            referralCommissions: referralCommissions.total || 0,
            totalUsers: totalUsers.count || 0,
            userGrowth,
            dailyDeposits,
            topBalanceUsers,
            topReferrers
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({});
    }
});

// ====================== SUPPORT TICKETS SYSTEM ======================
// إرفاق ملفات التذاكر (لنستخدم نفس إعدادات Cloudinary ولكن مجلد منفصل)
const ticketUpload = multer({
    storage: multerStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('يسمح فقط برفع الصور'), false);
    }
});

async function uploadTicketAttachment(buffer, originalname) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'support_tickets', allowed_formats: ['jpg', 'png', 'jpeg', 'webp'] },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        uploadStream.end(buffer);
    });
}

// إنشاء تذكرة جديدة
app.post('/api/support/tickets', authenticateToken, ticketUpload.single('attachment'), async (req, res) => {
    try {
        const { subject, message, priority = 'normal' } = req.body;
        if (!subject || !message) return res.status(400).json({ success: false, message: 'الموضوع والرسالة مطلوبة' });
        let attachmentUrl = null;
        if (req.file) {
            const uploadResult = await uploadTicketAttachment(req.file.buffer, req.file.originalname);
            attachmentUrl = uploadResult.secure_url;
        }
        const id = `TKT_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO support_tickets (id, userId, username, subject, message, priority, status, attachmentPath, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NOW(), NOW())`,
            [id, req.user.id, req.user.username, subject, message, priority, attachmentUrl]
        );
        await addNotification(req.user.id, 'تم فتح تذكرة دعم', `تم فتح تذكرتك بنجاح. سيتم الرد عليها قريباً.`);
        notifyAdmins('new-ticket', { username: req.user.username, subject });
        res.json({ success: true, message: 'تم فتح التذكرة بنجاح', ticketId: id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ' });
    }
});

// جلب تذاكر المستخدم
app.get('/api/support/tickets', authenticateToken, async (req, res) => {
    try {
        const tickets = await allQuery('SELECT * FROM support_tickets WHERE userId = ? ORDER BY createdAt DESC', [req.user.id]);
        res.json(tickets);
    } catch (err) {
        res.status(500).json([]);
    }
});

// جلب تذكرة محددة مع ردودها
app.get('/api/support/tickets/:id', authenticateToken, async (req, res) => {
    try {
        const ticket = await getQuery('SELECT * FROM support_tickets WHERE id = ? AND (userId = ? OR ? = ?)', [req.params.id, req.user.id, req.user.role, 'admin']);
        if (!ticket) return res.status(404).json({ success: false, message: 'التذكرة غير موجودة' });
        const replies = await allQuery('SELECT * FROM support_replies WHERE ticketId = ? ORDER BY createdAt ASC', [req.params.id]);
        res.json({ ticket, replies });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// إضافة رد على تذكرة (من المستخدم أو الأدمن)
app.post('/api/support/tickets/:id/reply', authenticateToken, ticketUpload.single('attachment'), async (req, res) => {
    try {
        const ticketId = req.params.id;
        const ticket = await getQuery('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
        if (!ticket) return res.status(404).json({ success: false, message: 'التذكرة غير موجودة' });
        if (ticket.userId !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'غير مصرح' });
        }
        const { message } = req.body;
        if (!message) return res.status(400).json({ success: false, message: 'الرسالة مطلوبة' });
        let attachmentUrl = null;
        if (req.file) {
            const uploadResult = await uploadTicketAttachment(req.file.buffer, req.file.originalname);
            attachmentUrl = uploadResult.secure_url;
        }
        const replyId = `REP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        await runQuery(
            `INSERT INTO support_replies (id, ticketId, userId, username, message, attachmentPath, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [replyId, ticketId, req.user.id, req.user.username, message, attachmentUrl]
        );
        await runQuery('UPDATE support_tickets SET updatedAt = NOW(), status = ? WHERE id = ?', 
            [req.user.role === 'admin' ? 'in_progress' : 'open', ticketId]);
        // إشعار للمستخدم أو الأدمن
        if (req.user.role === 'admin') {
            await addNotification(ticket.userId, 'تم الرد على تذكرتك', `قام الدعم بالرد على تذكرتك: ${ticket.subject}`);
            // إشعار فوري للمستخدم إذا كان متصلاً
            sendNotificationToUser(ticket.userId, 'رد جديد على التذكرة', `تم الرد على تذكرتك: ${ticket.subject}`, 'info');
        } else {
            notifyAdmins('ticket-reply', { username: req.user.username, subject: ticket.subject });
        }
        res.json({ success: true, message: 'تم إضافة الرد' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// إدارة التذاكر للأدمن (تغيير الحالة)
app.put('/api/admin/support/tickets/:id/status', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['open', 'in_progress', 'closed'].includes(status)) return res.status(400).json({ success: false });
        await runQuery('UPDATE support_tickets SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// جلب جميع التذاكر للأدمن
app.get('/api/admin/support/tickets', authenticateToken, adminOnly, async (req, res) => {
    try {
        const tickets = await allQuery('SELECT * FROM support_tickets ORDER BY createdAt DESC');
        res.json(tickets);
    } catch (err) {
        res.status(500).json([]);
    }
});

// ====================== CHANGE EMAIL / PASSWORD ======================
app.put('/api/users/change-email', authenticateToken, async (req, res) => {
    try {
        const { newEmail, password } = req.body;
        if (!newEmail || !password) return res.status(400).json({ success: false, message: req.t('change_email_required') });
        const user = await getQuery('SELECT password FROM users WHERE id = ?', [req.user.id]);
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ success: false, message: req.t('incorrect_password') });
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ? AND id != ?', [newEmail, req.user.id]);
        if (existing.length > 0) return res.status(400).json({ success: false, message: req.t('email_taken') });
        await runQuery('UPDATE users SET email = ? WHERE id = ?', [newEmail, req.user.id]);
        await addNotification(req.user.id, req.t('email_changed_title'), req.t('email_changed_message'));
        res.json({ success: true, message: req.t('email_changed') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.put('/api/users/change-password', authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: req.t('change_password_required') });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: req.t('password_too_short') });
        const user = await getQuery('SELECT password FROM users WHERE id = ?', [req.user.id]);
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) return res.status(401).json({ success: false, message: req.t('incorrect_current_password') });
        const hashed = await bcrypt.hash(newPassword, 10);
        await runQuery('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
        await addNotification(req.user.id, req.t('password_changed_title'), req.t('password_changed_message'));
        res.json({ success: true, message: req.t('password_changed') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// ====================== FORGOT PASSWORD ======================
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: req.t('email_required') });
        const user = await getQuery('SELECT id FROM users WHERE email = ?', [email]);
        if (!user) return res.status(404).json({ success: false, message: req.t('email_not_found') });
        await runQuery('DELETE FROM password_resets WHERE email = ?', [email]);
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        await runQuery('INSERT INTO password_resets (email, token, expiresAt) VALUES (?, ?, ?)', [email, token, expiresAt]);
        const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
        console.log(`🔐 Password reset link for ${email}: ${resetLink}`);
        res.json({ success: true, message: req.t('reset_link_sent') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ success: false, message: req.t('reset_required_fields') });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: req.t('password_too_short') });
        const reset = await getQuery('SELECT * FROM password_resets WHERE token = ? AND expiresAt > NOW()', [token]);
        if (!reset) return res.status(400).json({ success: false, message: req.t('invalid_token') });
        const hashed = await bcrypt.hash(newPassword, 10);
        await runQuery('UPDATE users SET password = ? WHERE email = ?', [hashed, reset.email]);
        await runQuery('DELETE FROM password_resets WHERE token = ?', [token]);
        await addNotification(reset.email, req.t('password_reset_title'), req.t('password_reset_message'));
        res.json({ success: true, message: req.t('password_reset_success') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

// ====================== ADMIN ROUTES ======================
app.get('/api/admin/users', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { search } = req.query;
        let query = 'SELECT id, username, fullName, email, balance, profit, level, createdAt, isVerified, origin, currentLocation, currentJob, work, profession, totalDeposits FROM users';
        let params = [];
        if (search) {
            query += ' WHERE username LIKE ? OR email LIKE ? OR fullName LIKE ?';
            params = [`%${search}%`, `%${search}%`, `%${search}%`];
        }
        query += ' ORDER BY createdAt DESC';
        const users = await allQuery(query, params);
        res.json({ users, total: users.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/user/:id', authenticateToken, adminOnly, async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: req.t('user_not_found') });
        res.json({ success: true, user: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/set-user-balance', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { userId, newBalance } = req.body;
        const [userRows] = await db.execute('SELECT username FROM users WHERE id = ?', [userId]);
        const oldBalance = await getQuery('SELECT balance FROM users WHERE id = ?', [userId]);
        await db.execute('UPDATE users SET balance = ? WHERE id = ?', [parseFloat(newBalance), userId]);
        await updateUserLevel(userId);
        await logAdminAction(req.user.id, req.user.username, 'set_balance', userId, userRows[0]?.username || '', `تعديل الرصيد من ${oldBalance.balance} إلى ${newBalance}`, req.ip);
        res.json({ success: true, message: req.t('balance_updated') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/set-user-level', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { userId, newLevel } = req.body;
        const allowedLevels = ['برونزي', 'فضي', 'ذهبي', 'ألماسي'];
        if (!allowedLevels.includes(newLevel)) return res.status(400).json({ success: false, message: req.t('invalid_level') });
        const [userRows] = await db.execute('SELECT username FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) return res.status(404).json({ success: false, message: req.t('user_not_found') });
        await db.execute('UPDATE users SET level = ? WHERE id = ?', [newLevel, userId]);
        await logAdminAction(req.user.id, req.user.username, 'set_level', userId, userRows[0].username, `تغيير الرتبة إلى ${newLevel}`, req.ip);
        await addNotification(userId, req.t('level_changed_title'), req.t('level_changed_message', { level: newLevel }));
        res.json({ success: true, message: req.t('level_updated') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/reset-user-password', authenticateToken, adminOnly, async (req, res) => {
    try {
        const { userId, newPassword } = req.body;
        const [userRows] = await db.execute('SELECT username FROM users WHERE id = ?', [userId]);
        const hashed = await bcrypt.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
        await logAdminAction(req.user.id, req.user.username, 'reset_password', userId, userRows[0]?.username || '', 'إعادة تعيين كلمة المرور', req.ip);
        await addNotification(userId, req.t('password_reset_admin_title'), req.t('password_reset_admin_message'));
        res.json({ success: true, message: req.t('password_reset_admin_success') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/admin-actions', authenticateToken, adminOnly, async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM admin_actions ORDER BY timestamp DESC LIMIT 200');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/verify', authenticateToken, (req, res) => {
    if (req.user.role === 'admin') {
        res.json({ success: true });
    } else {
        res.status(403).json({ success: false, message: req.t('unauthorized') });
    }
});

app.post('/api/auth/verify-admin-gateway', async (req, res) => {
    try {
        const { secretPassword } = req.body;
        if (secretPassword === ADMIN_GATEWAY_SECRET) {
            const tempToken = jwt.sign({ type: 'admin_gateway', role: 'admin' }, JWT_SECRET, { expiresIn: '5m' });
            res.cookie('admin_gateway_token', tempToken, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 5 * 60 * 1000 });
            return res.json({ success: true });
        }
        return res.status(401).json({ success: false, message: req.t('invalid_gateway_password') });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ====================== REGISTRATION & EMAIL VALIDATION ======================
app.get('/api/users/check-username', async (req, res) => {
    try {
        const { username } = req.query;
        if (!username) return res.json({ exists: false });
        const [rows] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
        res.json({ exists: rows.length > 0 });
    } catch (err) {
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
        if (!email || !email.includes('@')) return res.json({ valid: false, reason: req.t('invalid_email_format') });
        const domain = email.split('@')[1].toLowerCase();
        if (disposableDomains.includes(domain)) return res.json({ valid: false, reason: req.t('disposable_email_not_allowed') });
        try {
            await dns.resolveMx(domain);
            return res.json({ valid: true });
        } catch (mxErr) {
            return res.json({ valid: false, reason: req.t('domain_no_mx') });
        }
    } catch (err) {
        res.json({ valid: false, reason: req.t('validation_error') });
    }
});

global.tempCodes = new Map();

app.post('/api/users/register', async (req, res) => {
    try {
        const { username, password, fullName, email, origin, currentLocation, currentJob, work, profession, verificationCode, referrerCode } = req.body;
        if (!username || !password || !fullName || !email) return res.status(400).json({ success: false, message: req.t('register_required_fields') });

        const [existingUser] = await db.execute('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser.length > 0) return res.status(400).json({ success: false, message: req.t('username_or_email_taken') });

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
            `INSERT INTO users (id, username, password, fullName, email, origin, currentLocation, currentJob, work, profession, createdAt, referrerId, referralCode, isVerified, loginAttempts, lockUntil, totalDeposits)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 0, NULL, 0)`,
            [userId, username, hashedPassword, fullName, email, origin || 'غير محدد', currentLocation || 'غير محدد', currentJob || 'غير محدد', work || 'غير محدد', profession || 'غير محدد', referrerId, referralCodeGen, isVerified]
        );

        res.status(201).json({
            success: true,
            message: isVerified ? req.t('register_success_verified') : req.t('register_success_unverified'),
            isVerified
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/auth/send-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const [existing] = await db.execute('SELECT id, isVerified FROM users WHERE email = ?', [email]);
        if (existing.length > 0 && existing[0].isVerified) return res.status(400).json({ success: false, message: req.t('email_already_verified') });
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        global.tempCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
        console.log(`[تطوير] رمز التحقق للبريد ${email} هو: ${code}`);
        res.json({ success: true, message: req.t('verification_code_sent') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: req.t('server_error') });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.clearCookie('refreshToken');
    res.clearCookie('admin_gateway_token');
    res.json({ success: true });
});

app.get('/api/activity-logs/recent', authenticateToken, async (req, res) => {
    try {
        const rows = await allQuery('SELECT action, details, timestamp FROM activity_logs WHERE userId = ? ORDER BY timestamp DESC LIMIT 10', [req.user.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

// ====================== CRON JOBS ======================
async function distributeDailyProfits() {
    console.log('🔄 بدء توزيع الأرباح التلقائية...');
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [investments] = await connection.execute('SELECT * FROM investments WHERE withdrawnPrincipal = 0 FOR UPDATE');
        const now = new Date();
        for (const inv of investments) {
            const lastProfitDate = inv.lastProfitDate ? new Date(inv.lastProfitDate) : new Date(inv.startDate);
            let profitToAdd = 0;
            let updateLastProfit = false;
            if (inv.projectType === 'daily') {
                const diffDays = Math.floor((now - lastProfitDate) / (1000 * 60 * 60 * 24));
                if (diffDays > 0) { profitToAdd = inv.amount * 0.05 * diffDays; updateLastProfit = true; }
            } else if (inv.projectType === 'weekly') {
                const diffDays = Math.floor((now - lastProfitDate) / (1000 * 60 * 60 * 24));
                if (diffDays > 0) { profitToAdd = inv.amount * 0.08 * diffDays; updateLastProfit = true; }
            } else if (inv.projectType === 'monthly' || inv.projectType === 'vip') {
                continue;
            }
            if (profitToAdd > 0) {
                await connection.execute('UPDATE users SET profit = profit + ? WHERE id = ?', [profitToAdd, inv.userId]);
                if (updateLastProfit) await connection.execute('UPDATE investments SET lastProfitDate = ? WHERE id = ?', [now, inv.id]);
                console.log(`✅ تم توزيع ${profitToAdd.toFixed(2)}$ على المستخدم ${inv.userId} (${inv.projectType})`);
            }
        }
        await connection.commit();
        console.log('✅ انتهى توزيع الأرباح التلقائية');
    } catch (err) {
        await connection.rollback();
        console.error('خطأ في توزيع الأرباح:', err);
    } finally {
        connection.release();
    }
}
cron.schedule('0 * * * *', () => { distributeDailyProfits(); });

async function backupDatabase() {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup_${timestamp}.sql`);
    let command;
    if (process.env.MYSQL_URL) {
        const url = new URL(process.env.MYSQL_URL);
        const host = url.hostname;
        const user = url.username;
        const password = url.password;
        const database = url.pathname.slice(1);
        command = `mysqldump -h ${host} -u ${user} -p${password} ${database} > "${backupFile}"`;
    } else {
        command = `mysqldump -h ${process.env.DB_HOST || 'localhost'} -u ${process.env.DB_USER || 'root'} ${process.env.DB_PASSWORD ? '-p' + process.env.DB_PASSWORD : ''} ${process.env.DB_NAME || 'bestdeal'} > "${backupFile}"`;
    }
    exec(command, (error, stdout, stderr) => {
        if (error) console.error(`❌ فشل النسخ الاحتياطي: ${error.message}`);
        else console.log(`✅ تم إنشاء نسخة احتياطية: ${backupFile}`);
    });
}
cron.schedule('0 2 * * *', () => { backupDatabase(); });

// ====================== SERVE STATIC FRONTEND & LOCALES ======================
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));
    console.log(`✅ Frontend served from ${publicPath}`);
} else {
    console.warn(`⚠️ public folder not found at ${publicPath}`);
}
app.use('/locales', express.static(path.join(__dirname, 'locales')));
console.log(`✅ Locales folder served from ${path.join(__dirname, 'locales')}`);

// ====================== ERROR HANDLER ======================
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, message: req.t('server_error') });
});

process.on('uncaughtException', (err) => { console.error('⚠️ Uncaught Exception:', err); });
process.on('unhandledRejection', (reason, promise) => { console.error('⚠️ Unhandled Rejection:', reason); });

// ====================== START SERVER ======================
(async () => {
    await initDatabase();
    await createTables();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Server running on http://localhost:${PORT}`);
        console.log(`👑 Admin: freeze / MHDFREEZE0619`);
        console.log(`🔑 Gateway secret: ${ADMIN_GATEWAY_SECRET}`);
        console.log(`📸 Cloudinary configured: ${process.env.CLOUDINARY_CLOUD_NAME ? '✅' : '❌'}`);
        console.log(`🌍 Multi-language support: ar, en, zh, de`);
        console.log(`🎁 Daily bonus streak: 0.5/0.75/1$`);
        console.log(`💎 VIP project: min 5000$, 400% monthly return`);
        console.log(`🏆 Monthly referral contest enabled`);
        console.log(`📧 Support ticket system with attachments`);
        console.log(`📊 Advanced admin analytics`);
        console.log(`🔔 WebSocket notifications ready`);
    });
})();