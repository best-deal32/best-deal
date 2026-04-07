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
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'BestDealGoldSystem_SuperSecretKey_2026_!@#$%';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'BestDealRefreshSecret_2026_!@#$%';
const ADMIN_GATEWAY_SECRET = process.env.ADMIN_GATEWAY_SECRET || 'MHDFREEZE2003';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'bestdeal';
const DB_PORT = parseInt(process.env.DB_PORT) || 3306;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Rate limiting
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20 });
app.use('/api/', globalLimiter);
app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);

// قاعدة البيانات
let db;
async function initDatabase() {
    try {
        db = await mysql.createConnection({
            host: DB_HOST, user: DB_USER, password: DB_PASSWORD,
            database: DB_NAME, port: DB_PORT, multipleStatements: true
        });
        console.log('✅ DB connected');
        await db.execute(`CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(50) PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'user',
            fullName VARCHAR(100), email VARCHAR(100) UNIQUE NOT NULL,
            balance DECIMAL(10,2) DEFAULT 0, profit DECIMAL(10,2) DEFAULT 0,
            level VARCHAR(20) DEFAULT 'برونزي', createdAt DATETIME,
            isVerified TINYINT DEFAULT 0, referralCode VARCHAR(50) UNIQUE,
            refreshToken VARCHAR(255), loginAttempts INT DEFAULT 0, lockUntil DATETIME
        )`);
        // أضف باقي الجداول بنفس الطريقة...
        const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', ['freeze']);
        if (existing.length === 0) {
            const hashed = await bcrypt.hash('MHDFREEZE0619', 10);
            await db.execute(
                `INSERT INTO users (id, username, password, role, email, fullName, balance, createdAt, isVerified, referralCode)
                VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1, ?)`,
                ['FREEZE_ID', 'freeze', hashed, 'admin', 'freeze@bestdeal.com', 'Freeze Admin', 50000, 'freeze_ref']
            );
        }
    } catch (err) { console.error(err); process.exit(1); }
}
initDatabase();

async function getQuery(sql, params) { const [rows] = await db.execute(sql, params); return rows[0]; }

// ========== مسار تسجيل الدخول ==========
app.post('/api/users/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });
        const user = await getQuery('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ success: false, message: 'بيانات غير صحيحة' });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
        const refreshToken = jwt.sign({ id: user.id }, REFRESH_SECRET, { expiresIn: '7d' });
        await db.execute('UPDATE users SET refreshToken = ? WHERE id = ?', [refreshToken, user.id]);
        res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 15 * 60 * 1000 });
        res.cookie('refreshToken', refreshToken, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (err) { res.status(500).json({ success: false, message: 'خطأ في الخادم' }); }
});

// ========== الحصول على بيانات المستخدم ==========
app.get('/api/users/me', async (req, res) => {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ success: false, message: 'غير مصرح' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await getQuery('SELECT id, username, role, fullName, email, balance, profit, level, isVerified FROM users WHERE id = ?', [decoded.id]);
        res.json(user);
    } catch (err) { res.status(401).json({ success: false }); }
});

// ========== مسار اختبار ==========
app.get('/api/test', (req, res) => { res.json({ message: 'Server is working' }); });

// ========== تقديم الملفات الثابتة ==========
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) { app.use(express.static(publicPath)); console.log(`✅ Serving static from ${publicPath}`); }
else { console.warn(`⚠️ public folder not found at ${publicPath}`); }

// ========== تشغيل الخادم ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`👑 Admin: freeze / MHDFREEZE0619`);
});