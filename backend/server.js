// ============================================================
// server.js - MarketHub (Express + PostgreSQL مباشر بدون Prisma)
// ============================================================

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');              // PostgreSQL
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'change-me-too';

// ---------- إعداد Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ---------- Multer (ذاكرة مؤقتة) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('صور فقط'), false);
  }
});

// ---------- دالة رفع إلى Cloudinary ----------
async function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'markethub', allowed_formats: ['jpg','png','jpeg','webp'] },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

// ---------- إعداد قاعدة البيانات ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// إنشاء الجداول تلقائياً عند بدء التشغيل
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone VARCHAR(20),
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'seller',
        store_name VARCHAR(100),
        store_image VARCHAR(255),
        contact_phone VARCHAR(20),
        verified BOOLEAN DEFAULT false,
        verification_code VARCHAR(6),
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
    `);
    console.log('✅ جداول قاعدة البيانات جاهزة');
  } finally {
    client.release();
  }
}

// تشغيل الدالة عند البدء
createTables().catch(err => {
  console.error('فشل إنشاء الجداول:', err);
  process.exit(1);
});

// ---------- Middleware ----------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));   // خدمة الواجهة

// ---------- دوال التوكن ----------
function generateAccessToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '15m' });
}
function generateRefreshToken(user) {
  return jwt.sign({ id: user.id }, REFRESH_SECRET, { expiresIn: '7d' });
}

// ---------- Middleware المصادقة ----------
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
  } catch (err) {
    return res.status(403).json({ message: 'انتهت الجلسة' });
  }
}

function sellerOnly(req, res, next) {
  if (req.user.role === 'seller' || req.user.role === 'admin') return next();
  return res.status(403).json({ message: 'يجب أن تكون بائعاً' });
}

function adminOnly(req, res, next) {
  if (req.user.role === 'admin') return next();
  return res.status(403).json({ message: 'صلاحيات الأدمن مطلوبة' });
}

// ====================== [1] المصادقة ======================

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, phone, password, storeName } = req.body;
    if (!username || !email || !password) return res.status(400).json({ message: 'اسم المستخدم والبريد وكلمة المرور مطلوبة' });

    const exists = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (exists.rows.length > 0) return res.status(400).json({ message: 'اسم المستخدم أو البريد مستخدم مسبقاً' });

    const hashed = await bcrypt.hash(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(
      `INSERT INTO users (username, email, phone, password, store_name, role, verification_code)
       VALUES ($1,$2,$3,$4,$5,'seller',$6)`,
      [username, email, phone || null, hashed, storeName || null, code]
    );
    console.log(`رمز التحقق لـ ${email}: ${code}`); // استبدل بإرسال بريد حقيقي لاحقاً
    res.status(201).json({ message: 'تم التسجيل، تحقق من بريدك الإلكتروني' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  const { email, code } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1 AND verification_code = $2', [email, code]);
  if (result.rows.length === 0) return res.status(400).json({ message: 'رمز التحقق غير صحيح' });
  await pool.query('UPDATE users SET verified = true, verification_code = NULL WHERE email = $1', [email]);
  res.json({ message: 'تم التحقق بنجاح' });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { loginId, password } = req.body;
    if (!loginId || !password) return res.status(400).json({ message: 'يرجى إدخال بيانات الدخول' });

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $1 OR phone = $1',
      [loginId]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    if (!user.verified) return res.status(403).json({ message: 'يجب توثيق الحساب أولاً' });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    res.cookie('token', accessToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 15 * 60 * 1000
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const { password: _, refresh_token: __, verification_code: ___, ...safeUser } = user;
    res.json({ ...safeUser, accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

app.post('/api/auth/refresh', async (req, res) => { /* ... مشابه للنسخة السابقة ... */ });
app.post('/api/auth/logout', authenticate, async (req, res) => { /* ... */ });
app.get('/api/auth/me', authenticate, async (req, res) => {
  const { password, refresh_token, verification_code, ...safe } = req.user;
  res.json(safe);
});

// ====================== [2] المنتجات ======================

app.post('/api/products', authenticate, sellerOnly, upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, size, type, colors } = req.body;
    if (!name || !price || !category) return res.status(400).json({ message: 'الاسم والسعر والفئة مطلوبة' });

    let imageUrl = null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      imageUrl = result.secure_url;
    }

    const result = await pool.query(
      `INSERT INTO products (name, description, price, category, size, type, colors, image, seller_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, description, parseFloat(price), category, size, type, colors, imageUrl, req.user.id]
    );
    res.status(201).json({ product: result.rows[0], message: 'تم إضافة المنتج' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

app.get('/api/products/my', authenticate, sellerOnly, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM products WHERE seller_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(result.rows);
});

app.get('/api/products/:id', async (req, res) => {
  const result = await pool.query(
    `SELECT p.*, u.store_name, u.contact_phone, u.store_image
     FROM products p JOIN users u ON p.seller_id = u.id WHERE p.id = $1`,
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ message: 'المنتج غير موجود' });
  res.json(result.rows[0]);
});

// ... باقي المسارات (تعديل، حذف) مشابهة مع استعلامات SQL مباشرة

// ====================== [3] العروض ======================
app.post('/api/offers', authenticate, sellerOnly, async (req, res) => {
  const { title, discount, productId } = req.body;
  if (!title) return res.status(400).json({ message: 'العنوان مطلوب' });
  const result = await pool.query(
    'INSERT INTO offers (title, discount, product_id, seller_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [title, discount, productId || null, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

app.get('/api/offers/my', authenticate, sellerOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM offers WHERE seller_id = $1', [req.user.id]);
  res.json(result.rows);
});

// ... حذف العرض

// ====================== [4] الملف الشخصي ======================
app.put('/api/profile', authenticate, sellerOnly, upload.single('storeImage'), async (req, res) => {
  const fields = [];
  const values = [];
  if (req.file) {
    const result = await uploadToCloudinary(req.file.buffer);
    fields.push('store_image = $' + (fields.length + 1));
    values.push(result.secure_url);
  }
  if (req.body.contactPhone) {
    fields.push('contact_phone = $' + (fields.length + 1));
    values.push(req.body.contactPhone);
  }
  if (fields.length > 0) {
    values.push(req.user.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}`, values);
  }
  res.json({ message: 'تم التحديث' });
});

app.get('/api/profile', authenticate, sellerOnly, async (req, res) => {
  const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = userResult.rows[0];
  const drivers = await pool.query('SELECT * FROM drivers WHERE seller_id = $1', [req.user.id]);
  const locations = await pool.query('SELECT * FROM locations WHERE seller_id = $1', [req.user.id]);
  const products = await pool.query('SELECT * FROM products WHERE seller_id = $1', [req.user.id]);
  const offers = await pool.query('SELECT * FROM offers WHERE seller_id = $1', [req.user.id]);
  const { password, refresh_token, verification_code, ...safe } = user;
  res.json({
    ...safe,
    drivers: drivers.rows,
    locations: locations.rows,
    products: products.rows,
    offers: offers.rows
  });
});

// ... مناديب، مناطق، مميزة، بحث، أدمن (بنفس النمط، استعلامات SQL مباشرة)

// ====================== بدء الخادم ======================
app.listen(PORT, () => {
  console.log(`🚀 MarketHub يعمل على http://localhost:${PORT}`);
});
