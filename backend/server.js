// ============================================================
// server.js - MarketHub (Express + PostgreSQL مباشر)
// متوافق مع Railway و PostgreSQL كخدمة مرتبطة
// يستخدم DATABASE_PRIVATE_URL إذا وُجد (أسرع وأكثر أمانًا داخل Railway)
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

// ---------- Multer ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('صور فقط'), false);
  }
});

// ---------- رفع صورة إلى Cloudinary ----------
async function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'markethub', allowed_formats: ['jpg','png','jpeg','webp'] },
      (err, result) => err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

// ---------- إعداد قاعدة البيانات (يفضّل DATABASE_PRIVATE_URL) ----------
// في Railway، عند ربط PostgreSQL، ستحصل على DATABASE_URL و DATABASE_PRIVATE_URL
const dbUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('❌ خطأ: لا يوجد متغير DATABASE_URL أو DATABASE_PRIVATE_URL.');
  console.error('تأكد من ربط خدمة PostgreSQL مع هذه الخدمة في Railway.');
  process.exit(1);
}

// إذا كان الرابط لا يحتوي على sslmode وكان DATABASE_URL هو المستخدم (وليس PRIVATE)، نضيف sslmode
const finalUrl = (dbUrl === process.env.DATABASE_URL && !dbUrl.includes('sslmode'))
  ? dbUrl + (dbUrl.includes('?') ? '&' : '?') + 'sslmode=require'
  : dbUrl;

const pool = new Pool({
  connectionString: finalUrl,
  // SSL فقط إذا استخدمنا DATABASE_URL العادي، أما PRIVATE فلا يحتاج SSL
  ssl: dbUrl === process.env.DATABASE_PRIVATE_URL ? false : { rejectUnauthorized: false }
});

// ---------- إنشاء الجداول عند بدء التشغيل ----------
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
    console.log('✅ تم تجهيز جداول قاعدة البيانات');
  } finally {
    client.release();
  }
}

// ---------- Middleware ----------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

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
      'INSERT INTO users (username, email, phone, password, store_name, role, verification_code) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [username, email, phone || null, hashed, storeName || null, 'seller', code]
    );
    console.log(`رمز التحقق لـ ${email}: ${code}`);
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
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const { password: _, refresh_token: __, verification_code: ___, ...safeUser } = user;
    res.json({ ...safeUser, accessToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ message: 'لا جلسة' });
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1 AND refresh_token = $2', [decoded.id, token]);
    if (result.rows.length === 0) return res.status(403).json({ message: 'جلسة غير صالحة' });
    const user = result.rows[0];
    const newAccess = generateAccessToken(user);
    res.cookie('token', newAccess, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000
    });
    res.json({ accessToken: newAccess });
  } catch (err) {
    res.status(403).json({ message: 'جلسة منتهية' });
  }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  await pool.query('UPDATE users SET refresh_token = NULL WHERE id = $1', [req.user.id]);
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  res.json({ message: 'تم تسجيل الخروج' });
});

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
      'INSERT INTO products (name, description, price, category, size, type, colors, image, seller_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [name, description || null, parseFloat(price), category, size || null, type || null, colors || null, imageUrl, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في الخادم' });
  }
});

app.get('/api/products/my', authenticate, sellerOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM products WHERE seller_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json(result.rows);
});

app.get('/api/products/:id', async (req, res) => {
  const result = await pool.query(
    'SELECT p.*, u.store_name, u.contact_phone, u.store_image FROM products p JOIN users u ON p.seller_id = u.id WHERE p.id = $1',
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ message: 'المنتج غير موجود' });
  res.json(result.rows[0]);
});

app.put('/api/products/:id', authenticate, sellerOnly, upload.single('image'), async (req, res) => {
  const prod = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (prod.rows.length === 0 || prod.rows[0].seller_id !== req.user.id) return res.status(403).json({ message: 'غير مصرح' });
  let image = prod.rows[0].image;
  if (req.file) {
    const result = await uploadToCloudinary(req.file.buffer);
    image = result.secure_url;
  }
  const { name, description, price } = req.body;
  const updated = await pool.query(
    'UPDATE products SET name=$1, description=$2, price=$3, image=$4 WHERE id=$5 RETURNING *',
    [name || prod.rows[0].name, description || prod.rows[0].description, parseFloat(price) || prod.rows[0].price, image, req.params.id]
  );
  res.json(updated.rows[0]);
});

app.delete('/api/products/:id', authenticate, sellerOnly, async (req, res) => {
  const prod = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (prod.rows.length === 0 || prod.rows[0].seller_id !== req.user.id) return res.status(403).json({ message: 'غير مصرح' });
  await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف المنتج' });
});

// ====================== [3] العروض ======================
app.post('/api/offers', authenticate, sellerOnly, async (req, res) => {
  const { title, discount, productId } = req.body;
  if (!title) return res.status(400).json({ message: 'العنوان مطلوب' });
  const result = await pool.query(
    'INSERT INTO offers (title, discount, product_id, seller_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [title, discount || null, productId || null, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

app.get('/api/offers/my', authenticate, sellerOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM offers WHERE seller_id = $1', [req.user.id]);
  res.json(result.rows);
});

app.delete('/api/offers/:id', authenticate, sellerOnly, async (req, res) => {
  const off = await pool.query('SELECT * FROM offers WHERE id = $1', [req.params.id]);
  if (off.rows.length === 0 || off.rows[0].seller_id !== req.user.id) return res.status(403).json({ message: 'غير مصرح' });
  await pool.query('DELETE FROM offers WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف العرض' });
});

// ====================== [4] الملف الشخصي ======================
app.put('/api/profile', authenticate, sellerOnly, upload.single('storeImage'), async (req, res) => {
  const updates = {};
  if (req.file) {
    const result = await uploadToCloudinary(req.file.buffer);
    updates.store_image = result.secure_url;
  }
  if (req.body.contactPhone) updates.contact_phone = req.body.contactPhone;
  if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'لا توجد بيانات للتحديث' });
  const keys = Object.keys(updates);
  const values = Object.values(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await pool.query(`UPDATE users SET ${setClause} WHERE id = $${values.length + 1}`, [...values, req.user.id]);
  const updated = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const { password, refresh_token, verification_code, ...safe } = updated.rows[0];
  res.json(safe);
});

app.get('/api/profile', authenticate, sellerOnly, async (req, res) => {
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (user.rows.length === 0) return res.status(404).json({ message: 'غير موجود' });
  const { password, refresh_token, verification_code, ...safe } = user.rows[0];
  const drivers = await pool.query('SELECT * FROM drivers WHERE seller_id = $1', [req.user.id]);
  const locations = await pool.query('SELECT * FROM locations WHERE seller_id = $1', [req.user.id]);
  const products = await pool.query('SELECT * FROM products WHERE seller_id = $1', [req.user.id]);
  const offers = await pool.query('SELECT * FROM offers WHERE seller_id = $1', [req.user.id]);
  res.json({ ...safe, drivers: drivers.rows, locations: locations.rows, products: products.rows, offers: offers.rows });
});

// ====================== [5] مناديب التوصيل ======================
app.post('/api/drivers', authenticate, sellerOnly, async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ message: 'الاسم والهاتف مطلوبان' });
  const result = await pool.query(
    'INSERT INTO drivers (name, phone, seller_id) VALUES ($1,$2,$3) RETURNING *',
    [name, phone, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

app.get('/api/drivers', authenticate, sellerOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM drivers WHERE seller_id = $1', [req.user.id]);
  res.json(result.rows);
});

app.delete('/api/drivers/:id', authenticate, sellerOnly, async (req, res) => {
  const driver = await pool.query('SELECT * FROM drivers WHERE id = $1', [req.params.id]);
  if (driver.rows.length === 0 || driver.rows[0].seller_id !== req.user.id) return res.status(403).json({ message: 'غير مصرح' });
  await pool.query('DELETE FROM drivers WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف المندوب' });
});

// ====================== [6] مناطق التوصيل ======================
app.post('/api/locations', authenticate, sellerOnly, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'اسم المنطقة مطلوب' });
  const result = await pool.query(
    'INSERT INTO locations (name, seller_id) VALUES ($1,$2) RETURNING *',
    [name, req.user.id]
  );
  res.status(201).json(result.rows[0]);
});

app.get('/api/locations', authenticate, sellerOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM locations WHERE seller_id = $1', [req.user.id]);
  res.json(result.rows);
});

app.delete('/api/locations/:id', authenticate, sellerOnly, async (req, res) => {
  const loc = await pool.query('SELECT * FROM locations WHERE id = $1', [req.params.id]);
  if (loc.rows.length === 0 || loc.rows[0].seller_id !== req.user.id) return res.status(403).json({ message: 'غير مصرح' });
  await pool.query('DELETE FROM locations WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف المنطقة' });
});

// ====================== [7] العروض المميزة (أدمن) ======================
app.post('/api/admin/featured', authenticate, adminOnly, async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ message: 'معرف المنتج مطلوب' });
  const product = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
  if (product.rows.length === 0) return res.status(404).json({ message: 'المنتج غير موجود' });
  const exists = await pool.query('SELECT * FROM featured_offers WHERE product_id = $1', [productId]);
  if (exists.rows.length > 0) return res.status(400).json({ message: 'المنتج مميز بالفعل' });
  await pool.query('INSERT INTO featured_offers (product_id, added_by) VALUES ($1,$2)', [productId, req.user.id]);
  res.status(201).json({ message: 'تمت إضافة المنتج إلى المميزة' });
});

app.get('/api/featured', async (req, res) => {
  const result = await pool.query(
    `SELECT f.id as feature_id, p.*, u.store_name, u.contact_phone, u.store_image
     FROM featured_offers f
     JOIN products p ON f.product_id = p.id
     JOIN users u ON p.seller_id = u.id`
  );
  res.json(result.rows);
});

app.delete('/api/admin/featured/:id', authenticate, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM featured_offers WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم إزالة التمييز' });
});

// ====================== [8] البحث ======================
app.get('/api/search', async (req, res) => {
  const { keyword } = req.query;
  let query = 'SELECT p.*, u.store_name FROM products p JOIN users u ON p.seller_id = u.id';
  const params = [];
  if (keyword) {
    query += ' WHERE p.name ILIKE $1 OR p.description ILIKE $1 OR u.store_name ILIKE $1';
    params.push(`%${keyword}%`);
  }
  const result = await pool.query(query, params);
  res.json(result.rows);
});

// ====================== [9] إدارة المستخدمين (أدمن) ======================
app.get('/api/admin/users', authenticate, adminOnly, async (req, res) => {
  const result = await pool.query('SELECT id, username, email, phone, role, store_name, verified, created_at FROM users');
  res.json(result.rows);
});

app.put('/api/admin/user/:id', authenticate, adminOnly, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'seller', 'admin'].includes(role)) return res.status(400).json({ message: 'دور غير صالح' });
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  res.json({ message: 'تم تحديث الدور' });
});

// ---------- بدء الخادم ----------
createTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 MarketHub يعمل على المنفذ ${PORT}`);
    });
  })
  .catch(err => {
    console.error('فشل بدء الخادم:', err);
    process.exit(1);
  });
