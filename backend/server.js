// ============================================================
// server.js - MarketHub (Express + PostgreSQL)
// كامل مع تحقق البريد الإلكتروني (Gmail) وتيليجرام
// ============================================================

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const nodemailer = require('nodemailer');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'change-me-too';

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('صور فقط'), false);
  }
});

async function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: 'markethub', allowed_formats: ['jpg','png','jpeg','webp'] },
      (err, result) => err ? reject(err) : resolve(result)
    ).end(buffer);
  });
}

// ---------- البريد الإلكتروني ----------
let transporter = null;
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  console.log('✅ البريد الإلكتروني جاهز');
} else {
  console.warn('⚠️ البريد غير مهيأ. لن يتم إرسال رسائل تحقق.');
}

async function sendVerificationEmail(email, code) {
  if (!transporter) {
    console.log(`رمز التحقق (بريد) لـ ${email}: ${code}`);
    return;
  }
  const mailOptions = {
    from: `"MarketHub" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'رمز التحقق من MarketHub',
    html: `<h2>رمز التحقق الخاص بك هو:</h2><h1 style="color:#059669;">${code}</h1><p>ينتهي خلال 15 دقيقة.</p>`
  };
  await transporter.sendMail(mailOptions);
}

// ---------- تيليجرام ----------
let bot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log('✅ بوت تيليجرام يعمل');

  // أمر /start مع كود التحقق
  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1]?.trim();
    if (!code) {
      bot.sendMessage(chatId, 'أرسل /start متبوعاً برمز التحقق لتفعيل حسابك.');
      return;
    }
    const result = await pool.query(
      `UPDATE users SET telegram_chat_id = $1, verified = true, verification_code = NULL, verification_code_expires = NULL
       WHERE verification_code = $2 AND verified = false AND verification_code_expires > NOW()
       RETURNING username`,
      [chatId.toString(), code]
    );
    if (result.rowCount > 0) {
      bot.sendMessage(chatId, `✅ تم التحقق بنجاح! مرحباً ${result.rows[0].username}. يمكنك الآن تسجيل الدخول.`);
    } else {
      bot.sendMessage(chatId, '❌ الرمز غير صحيح أو منتهي الصلاحية. حاول مرة أخرى.');
    }
  });
} else {
  console.log('ℹ️ بوت تيليجرام غير مفعل. التحقق عبر الهاتف غير متاح.');
}

// ---------- قاعدة البيانات ----------
let dbUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error('❌ لا يوجد DATABASE_URL'); process.exit(1); }
if (dbUrl === process.env.DATABASE_URL) {
  dbUrl = dbUrl.replace(/(\?|&)sslmode=[^&]*/g, '') + (dbUrl.includes('?') ? '&' : '?') + 'sslmode=disable';
}
const pool = new Pool({ connectionString: dbUrl, ssl: false });

async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE,
        phone VARCHAR(20) UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'seller',
        store_name VARCHAR(100),
        store_image VARCHAR(255),
        contact_phone VARCHAR(20),
        verified BOOLEAN DEFAULT false,
        verification_code VARCHAR(6),
        verification_code_expires TIMESTAMP,
        telegram_chat_id VARCHAR(50),
        refresh_token TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category VARCHAR(20) NOT NULL CHECK (category IN ('clothing','food')),
        size VARCHAR(20),
        type VARCHAR(50),
        colors VARCHAR(100),
        image VARCHAR(255),
        seller_id UUID REFERENCES users(id) ON DELETE CASCADE,
        featured BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS offers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        discount VARCHAR(50),
        product_id UUID REFERENCES products(id) ON DELETE SET NULL,
        seller_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS drivers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        seller_id UUID REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS locations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        seller_id UUID REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS featured_offers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id UUID UNIQUE REFERENCES products(id) ON DELETE CASCADE,
        added_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS admin_banners (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        image VARCHAR(255),
        added_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ جداول قاعدة البيانات جاهزة');
  } finally { client.release(); }
}

// ---------- إنشاء حساب الأدمن ----------
async function createAdminUser() {
  const result = await pool.query('SELECT id FROM users WHERE username = $1', ['MHDADMIN123']);
  if (result.rows.length === 0) {
    const hashed = await bcrypt.hash('MHDFREEZE0619', 10);
    await pool.query(
      `INSERT INTO users (username, email, password, role, verified)
       VALUES ($1, $2, $3, 'admin', true)`,
      ['MHDADMIN123', 'admin@markethub.com', hashed]
    );
    console.log('✅ تم إنشاء حساب الأدمن: MHDADMIN123');
  } else {
    await pool.query("UPDATE users SET verified = true, role = 'admin' WHERE username = 'MHDADMIN123'");
  }
}

// ---------- Middleware ----------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.get('/health', (req, res) => res.send('OK'));
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

// ---------- دوال JWT ----------
function generateAccessToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
}
function generateRefreshToken(user) {
  return jwt.sign({ id: user.id }, REFRESH_SECRET, { expiresIn: '7d' });
}

async function authenticate(req, res, next) {
  let token = req.cookies.token;
  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }
  if (!token) return res.status(401).json({ message: 'يرجى تسجيل الدخول' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length === 0) return res.status(401).json({ message: 'المستخدم غير موجود' });
    req.user = result.rows[0];
    next();
  } catch (err) { return res.status(403).json({ message: 'انتهت الجلسة' }); }
}

function sellerOnly(req, res, next) {
  if (req.user.role === 'seller' || req.user.role === 'admin') return next();
  return res.status(403).json({ message: 'يجب أن تكون بائعاً' });
}
function adminOnly(req, res, next) {
  if (req.user.role === 'admin') return next();
  return res.status(403).json({ message: 'صلاحيات الأدمن مطلوبة' });
}

// ---------- دوال مساعدة للتحقق ----------
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ====================== المصادقة ======================

// تسجيل حساب جديد
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, phone, password, storeName } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'اسم المستخدم وكلمة المرور مطلوبان' });
    if (!email && !phone) return res.status(400).json({ message: 'يجب إدخال بريد إلكتروني أو رقم هاتف واحد على الأقل' });

    // التحقق من عدم التكرار
    if (email) {
      const e = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (e.rows.length > 0) return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }
    if (phone) {
      const p = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
      if (p.rows.length > 0) return res.status(400).json({ message: 'رقم الهاتف مستخدم بالفعل' });
    }
    const u = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (u.rows.length > 0) return res.status(400).json({ message: 'اسم المستخدم مستخدم بالفعل' });

    const hashed = await bcrypt.hash(password, 10);
    const code = generateVerificationCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 دقيقة

    await pool.query(
      `INSERT INTO users (username, email, phone, password, store_name, role, verification_code, verification_code_expires)
       VALUES ($1,$2,$3,$4,$5,'seller',$6,$7)`,
      [username, email || null, phone || null, hashed, storeName || null, code, expires]
    );

    // تحضير رابط تيليجرام إن وُجد البوت
    let telegramLink = null;
    if (phone && bot) {
      const botInfo = await bot.getMe();
      telegramLink = `https://t.me/${botInfo.username}?start=${code}`;
    }

    // إرسال بريد إن وُجد
    if (email) {
      sendVerificationEmail(email, code).catch(err => console.error('فشل إرسال البريد:', err));
    }

    res.status(201).json({
      message: 'تم التسجيل بنجاح. يرجى التحقق من وسيلة التواصل.',
      email: email || null,
      phone: phone || null,
      telegramLink
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

// التحقق عبر رمز البريد الإلكتروني
app.post('/api/auth/verify-email', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: 'البريد والرمز مطلوبان' });
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1 AND verification_code = $2 AND verified = false AND verification_code_expires > NOW()',
    [email, code]
  );
  if (result.rows.length === 0) return res.status(400).json({ message: 'رمز غير صحيح أو منتهي الصلاحية' });
  await pool.query('UPDATE users SET verified = true, verification_code = NULL, verification_code_expires = NULL WHERE email = $1', [email]);
  res.json({ message: 'تم التحقق بنجاح' });
});

// إعادة إرسال رمز البريد
app.post('/api/auth/resend-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'البريد مطلوب' });
  const result = await pool.query('SELECT * FROM users WHERE email = $1 AND verified = false', [email]);
  if (result.rows.length === 0) return res.status(404).json({ message: 'المستخدم غير موجود أو مفعل بالفعل' });
  const code = generateVerificationCode();
  const expires = new Date(Date.now() + 15 * 60 * 1000);
  await pool.query('UPDATE users SET verification_code = $1, verification_code_expires = $2 WHERE email = $3', [code, expires, email]);
  try {
    await sendVerificationEmail(email, code);
    res.json({ message: 'تم إرسال رمز جديد' });
  } catch (err) {
    res.status(500).json({ message: 'فشل إرسال الرمز' });
  }
});

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  const { loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ message: 'بيانات الدخول مطلوبة' });
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1 OR phone = $1 OR username = $1',
    [loginId]
  );
  if (result.rows.length === 0) return res.status(401).json({ message: 'بيانات غير صحيحة' });
  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ message: 'بيانات غير صحيحة' });
  if (!user.verified) return res.status(403).json({ message: 'يجب توثيق الحساب أولاً' });

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

  res.cookie('token', accessToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000
  });
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000
  });

  const { password: _, refresh_token: __, verification_code: ___, ...safeUser } = user;
  const redirectUrl = user.role === 'admin' ? '/admin.html' : '/dashboard.html';
  res.json({ ...safeUser, accessToken, redirect: redirectUrl });
});

// Refresh, Logout, Me (نفس السابق)
app.post('/api/auth/refresh', async (req, res) => { /* ... */ });
app.post('/api/auth/logout', authenticate, async (req, res) => { /* ... */ });
app.get('/api/auth/me', authenticate, async (req, res) => {
  const { password, refresh_token, verification_code, ...safe } = req.user;
  res.json(safe);
});

// ====================== المنتجات ======================
app.post('/api/products', authenticate, sellerOnly, upload.single('image'), async (req, res) => { /* ... */ });
app.get('/api/products/my', authenticate, sellerOnly, async (req, res) => { /* ... */ });
app.get('/api/products/:id', async (req, res) => { /* ... */ });
app.put('/api/products/:id', authenticate, sellerOnly, upload.single('image'), async (req, res) => { /* ... */ });
app.delete('/api/products/:id', authenticate, sellerOnly, async (req, res) => { /* ... */ });

// ====================== العروض ======================
app.post('/api/offers', authenticate, sellerOnly, async (req, res) => { /* ... */ });
app.get('/api/offers/my', authenticate, sellerOnly, async (req, res) => { /* ... */ });
app.delete('/api/offers/:id', authenticate, sellerOnly, async (req, res) => { /* ... */ });

// ====================== الملف الشخصي ======================
app.put('/api/profile', authenticate, sellerOnly, upload.single('storeImage'), async (req, res) => { /* ... */ });
app.get('/api/profile', authenticate, sellerOnly, async (req, res) => { /* ... */ });

// ====================== مناديب التوصيل ======================
app.post('/api/drivers', authenticate, sellerOnly, async (req, res) => { /* ... */ });
app.get('/api/drivers', authenticate, sellerOnly, async (req, res) => { /* ... */ });
app.delete('/api/drivers/:id', authenticate, sellerOnly, async (req, res) => { /* ... */ });

// ====================== مناطق التوصيل ======================
app.post('/api/locations', authenticate, sellerOnly, async (req, res) => { /* ... */ });
app.get('/api/locations', authenticate, sellerOnly, async (req, res) => { /* ... */ });
app.delete('/api/locations/:id', authenticate, sellerOnly, async (req, res) => { /* ... */ });

// ====================== العروض المميزة (أدمن) ======================
app.post('/api/admin/featured', authenticate, adminOnly, async (req, res) => { /* ... */ });
app.get('/api/featured', async (req, res) => { /* ... */ });
app.delete('/api/admin/featured/:id', authenticate, adminOnly, async (req, res) => { /* ... */ });

// إعلانات عامة
app.post('/api/admin/banners', authenticate, adminOnly, upload.single('image'), async (req, res) => { /* ... */ });
app.delete('/api/admin/banners/:id', authenticate, adminOnly, async (req, res) => { /* ... */ });

// ====================== البحث ======================
app.get('/api/search', async (req, res) => { /* ... */ });

// ====================== إدارة المستخدمين (أدمن) ======================
app.get('/api/admin/users', authenticate, adminOnly, async (req, res) => { /* ... */ });
app.put('/api/admin/user/:id', authenticate, adminOnly, async (req, res) => { /* ... */ });

// ---------- بدء الخادم ----------
(async () => {
  try {
    await createTables();
    await createAdminUser();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 MarketHub يعمل على المنفذ ${PORT}`);
    });
  } catch (err) {
    console.error('فشل بدء الخادم:', err);
    process.exit(1);
  }
})();
