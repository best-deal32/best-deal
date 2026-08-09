// ============================================================
// server.js - سلة (Express + PostgreSQL + Telegram Bot)
// النسخة النهائية مع صلاحيات الأدمن العامة وسجل الحذف والإشعارات
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
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'change-me-too';

// ---------- Cloudinary ----------
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('❌ خطأ في إعدادات Cloudinary.');
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log('✅ Cloudinary جاهز');
}

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

// ---------- قاعدة البيانات ----------
let dbUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error('❌ لا يوجد DATABASE_URL'); process.exit(1); }
if (dbUrl === process.env.DATABASE_URL) {
  dbUrl = dbUrl.replace(/(\?|&)sslmode=[^&]*/g, '') + (dbUrl.includes('?') ? '&' : '?') + 'sslmode=disable';
}
const pool = new Pool({ connectionString: dbUrl, ssl: false });

// ---------- تيليجرام ----------
let bot = null;
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  console.log('✅ بوت تيليجرام يعمل');

  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
      console.warn('⚠️ تعارض بوت. إعادة تشغيل...');
      bot.stopPolling().then(() => setTimeout(() => bot.startPolling(), 2000));
    }
  });

  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1]?.trim();
    if (!code) {
      bot.sendMessage(chatId, 'أرسل /start متبوعاً برمز التحقق.');
      return;
    }
    try {
      const result = await pool.query(
        `UPDATE users SET telegram_chat_id = $1, verified = true, verification_code = NULL, verification_code_expires = NULL
         WHERE verification_code = $2 AND verified = false AND verification_code_expires > NOW()
         RETURNING username`,
        [chatId.toString(), code]
      );
      if (result.rowCount > 0) {
        bot.sendMessage(chatId, `✅ تم التحقق! مرحباً ${result.rows[0].username}.`);
      } else {
        bot.sendMessage(chatId, '❌ الرمز غير صحيح أو منتهي الصلاحية.');
      }
    } catch (err) {
      console.error('خطأ تيليجرام:', err);
      bot.sendMessage(chatId, '❌ خطأ. حاول لاحقاً.');
    }
  });
} else {
  console.warn('⚠️ لم يتم توفير TELEGRAM_BOT_TOKEN.');
}

// ---------- إنشاء الجداول ----------
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'seller',
        store_name VARCHAR(100),
        store_image VARCHAR(255),
        contact_phone VARCHAR(20),
        description TEXT,
        telegram_username VARCHAR(50),
        verified BOOLEAN DEFAULT false,
        verification_code VARCHAR(6),
        verification_code_expires TIMESTAMP,
        telegram_chat_id VARCHAR(50),
        refresh_token TEXT,
        max_products INT DEFAULT 20,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'clothing',
        size VARCHAR(100),
        type VARCHAR(100),
        colors VARCHAR(255),
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

      CREATE TABLE IF NOT EXISTS custom_menus (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        seller_id UUID REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL
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

      CREATE TABLE IF NOT EXISTS subscription_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        username VARCHAR(50) NOT NULL,
        pack_name VARCHAR(100) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        extra_products INT NOT NULL,
        payment_receipt VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        duration VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- جدول سجل الحذف والإجراءات الإدارية
      CREATE TABLE IF NOT EXISTS deletion_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_name VARCHAR(255),
        product_id UUID,
        seller_id UUID REFERENCES users(id) ON DELETE SET NULL,
        deleted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const alterQueries = [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code_expires TIMESTAMP`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(50)`,
      `ALTER TABLE users DROP COLUMN IF EXISTS email`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS max_products INT DEFAULT 20`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(50)`,
      `ALTER TABLE subscription_requests ADD COLUMN IF NOT EXISTS duration VARCHAR(50)`
    ];
    for (const q of alterQueries) {
      await client.query(q).catch(() => {});
    }

    console.log('✅ جداول قاعدة البيانات جاهزة');
  } finally { client.release(); }
}

// ---------- إنشاء حساب الأدمن ----------
async function createAdminUser() {
  const result = await pool.query('SELECT id FROM users WHERE username = $1', ['MHDADMIN123']);
  if (result.rows.length === 0) {
    const hashed = await bcrypt.hash('MHDFREEZE0619', 10);
    await pool.query(
      `INSERT INTO users (username, phone, password, role, verified, max_products)
       VALUES ($1, $2, $3, 'admin', true, 9999)`,
      ['MHDADMIN123', '0000000000', hashed]
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

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function addNotification(userId, message) {
  await pool.query('INSERT INTO notifications (user_id, message) VALUES ($1, $2)', [userId, message]);
}

// ====================== المصادقة ======================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, phone, password, storeName } = req.body;
    if (!username || !phone || !password) return res.status(400).json({ message: 'اسم المستخدم ورقم الهاتف وكلمة المرور مطلوبة' });

    const p = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (p.rows.length > 0) return res.status(400).json({ message: 'رقم الهاتف مستخدم بالفعل' });
    const u = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (u.rows.length > 0) return res.status(400).json({ message: 'اسم المستخدم مستخدم بالفعل' });

    const hashed = await bcrypt.hash(password, 10);
    const code = generateVerificationCode();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `INSERT INTO users (username, phone, password, store_name, role, verification_code, verification_code_expires)
       VALUES ($1,$2,$3,$4,'seller',$5,$6)`,
      [username, phone, hashed, storeName || null, code, expires]
    );

    let telegramLink = null;
    if (bot) {
      try {
        const botInfo = await bot.getMe();
        telegramLink = `https://t.me/${botInfo.username}?start=${code}`;
      } catch (e) { /* تجاهل */ }
    }

    if (!telegramLink) return res.status(500).json({ message: 'التحقق عبر تيليجرام غير متاح حالياً.' });

    res.status(201).json({ message: 'تم التسجيل. افتح تيليجرام للتحقق.', telegramLink });
  } catch (err) { console.error(err); res.status(500).json({ message: 'خطأ في الخادم' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { loginId, password } = req.body;
    if (!loginId || !password) return res.status(400).json({ message: 'بيانات الدخول مطلوبة' });
    const result = await pool.query('SELECT * FROM users WHERE username = $1 OR phone = $1', [loginId]);
    if (result.rows.length === 0) return res.status(401).json({ message: 'بيانات غير صحيحة' });
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'بيانات غير صحيحة' });
    if (!user.verified) return res.status(403).json({ message: 'يجب توثيق الحساب أولاً' });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    res.cookie('token', accessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });

    const { password: _, refresh_token: __, verification_code: ___, ...safeUser } = user;
    const redirectUrl = user.role === 'admin' ? '/admin.html' : '/dashboard.html';
    res.json({ ...safeUser, accessToken, redirect: redirectUrl });
  } catch (err) { console.error(err); res.status(500).json({ message: 'خطأ في الخادم' }); }
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
    res.cookie('token', newAccess, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 15 * 60 * 1000 });
    res.json({ accessToken: newAccess });
  } catch (err) { res.status(403).json({ message: 'جلسة منتهية' }); }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
  await pool.query('UPDATE users SET refresh_token = NULL WHERE id = $1', [req.user.id]);
  res.clearCookie('token');
  res.clearCookie('refreshToken');
  res.json({ message: 'تم تسجيل الخروج' });
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  const { password, refresh_token, verification_code, ...safe } = req.user;
  const count = await pool.query('SELECT COUNT(*)::int AS cnt FROM products WHERE seller_id = $1', [req.user.id]);
  res.json({ ...safe, currentProducts: count.rows[0].cnt, maxProducts: req.user.max_products || 20 });
});

// ====================== المنتجات (ألبسة فقط) ======================
app.post('/api/products', authenticate, sellerOnly, upload.single('image'), async (req, res) => {
  try {
    const countResult = await pool.query('SELECT COUNT(*)::int AS cnt FROM products WHERE seller_id = $1', [req.user.id]);
    const currentCount = countResult.rows[0].cnt;
    const maxAllowed = req.user.max_products || 20;
    if (currentCount >= maxAllowed) {
      return res.status(403).json({
        message: 'لقد تجاوزت الحد المسموح من المنتجات. يرجى ترقية باقتك.',
        current: currentCount,
        max: maxAllowed
      });
    }

    const { name, description, price, size, type, colors } = req.body;
    if (!name || !price) return res.status(400).json({ message: 'اسم المنتج والسعر مطلوبان' });

    let imageUrl = null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      imageUrl = result.secure_url;
    }

    const result = await pool.query(
      `INSERT INTO products (name, description, price, category, size, type, colors, image, seller_id)
       VALUES ($1,$2,$3,'clothing',$4,$5,$6,$7,$8) RETURNING *`,
      [name, description || null, parseFloat(price), size || null, type || null, colors || null, imageUrl, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'خطأ في الخادم' }); }
});

app.get('/api/products/my', authenticate, sellerOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM products WHERE seller_id = $1 ORDER BY created_at DESC', [req.user.id]);
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

app.put('/api/products/:id', authenticate, sellerOnly, upload.single('image'), async (req, res) => {
  const prod = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  // السماح للأدمن بالتعديل على أي منتج
  if (req.user.role !== 'admin' && (prod.rows.length === 0 || prod.rows[0].seller_id !== req.user.id)) {
    return res.status(403).json({ message: 'غير مصرح' });
  }
  let image = prod.rows[0].image;
  if (req.file) {
    const result = await uploadToCloudinary(req.file.buffer);
    image = result.secure_url;
  }
  const { name, description, price, size, type, colors } = req.body;
  const updated = await pool.query(
    `UPDATE products SET name=$1, description=$2, price=$3, size=$4, type=$5, colors=$6, image=$7 WHERE id=$8 RETURNING *`,
    [
      name || prod.rows[0].name,
      description !== undefined ? description : prod.rows[0].description,
      price ? parseFloat(price) : prod.rows[0].price,
      size !== undefined ? size : prod.rows[0].size,
      type !== undefined ? type : prod.rows[0].type,
      colors !== undefined ? colors : prod.rows[0].colors,
      image,
      req.params.id
    ]
  );
  res.json(updated.rows[0]);
});

app.delete('/api/products/:id', authenticate, sellerOnly, async (req, res) => {
  const prod = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  // السماح للأدمن بحذف أي منتج
  if (req.user.role !== 'admin' && (prod.rows.length === 0 || prod.rows[0].seller_id !== req.user.id)) {
    return res.status(403).json({ message: 'غير مصرح' });
  }

  const reason = req.body.reason || 'حذف من قبل الإدارة';

  // تسجيل عملية الحذف
  await pool.query(
    'INSERT INTO deletion_logs (product_name, product_id, seller_id, deleted_by, reason) VALUES ($1,$2,$3,$4,$5)',
    [prod.rows[0].name, req.params.id, prod.rows[0].seller_id, req.user.id, reason]
  );

  // إرسال إشعار للمستخدم
  if (prod.rows[0].seller_id) {
    await addNotification(prod.rows[0].seller_id, `تم حذف منتجك "${prod.rows[0].name}" بواسطة الإدارة. السبب: ${reason}`);
  }

  await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف المنتج بنجاح' });
});

// ====================== العروض ======================
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
  if (req.user.role !== 'admin' && (off.rows.length === 0 || off.rows[0].seller_id !== req.user.id)) {
    return res.status(403).json({ message: 'غير مصرح' });
  }
  await pool.query('DELETE FROM offers WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف العرض' });
});

// ====================== الملف الشخصي ======================
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
  const menus = await pool.query('SELECT name FROM custom_menus WHERE seller_id = $1', [req.user.id]);
  const deletedProducts = await pool.query('SELECT * FROM deletion_logs WHERE seller_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({
    ...safe,
    drivers: drivers.rows,
    locations: locations.rows,
    products: products.rows,
    offers: offers.rows,
    custom_menus: menus.rows.map(r => r.name),
    deletedProducts: deletedProducts.rows
  });
});

// ====================== إعدادات المتجر ======================
app.put('/api/profile/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ message: 'مطلوب كلمة المرور الحالية والجديدة' });
  const user = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
  const match = await bcrypt.compare(currentPassword, user.rows[0].password);
  if (!match) return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
  const hashed = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);
  res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
});

app.put('/api/profile/description', authenticate, sellerOnly, async (req, res) => {
  const { description } = req.body;
  await pool.query('UPDATE users SET description = $1 WHERE id = $2', [description || null, req.user.id]);
  res.json({ message: 'تم حفظ الوصف' });
});

app.post('/api/profile/custom-menu', authenticate, sellerOnly, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'اسم القائمة مطلوب' });
  await pool.query('INSERT INTO custom_menus (seller_id, name) VALUES ($1, $2)', [req.user.id, name]);
  res.json({ message: 'تم إضافة القائمة' });
});

app.put('/api/profile/telegram', authenticate, sellerOnly, async (req, res) => {
  const { telegramUsername } = req.body;
  await pool.query('UPDATE users SET telegram_username = $1 WHERE id = $2', [telegramUsername || null, req.user.id]);
  res.json({ message: 'تم تحديث حساب التليجرام' });
});

// ====================== مناديب ومناطق ======================
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
  if (req.user.role !== 'admin' && (driver.rows.length === 0 || driver.rows[0].seller_id !== req.user.id)) {
    return res.status(403).json({ message: 'غير مصرح' });
  }
  await pool.query('DELETE FROM drivers WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف المندوب' });
});

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
  if (req.user.role !== 'admin' && (loc.rows.length === 0 || loc.rows[0].seller_id !== req.user.id)) {
    return res.status(403).json({ message: 'غير مصرح' });
  }
  await pool.query('DELETE FROM locations WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف المنطقة' });
});

// ====================== العروض المميزة والإعلانات ======================
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
  const productFeatured = await pool.query(
    `SELECT f.id as feature_id, p.*, u.store_name, u.contact_phone, u.store_image
     FROM featured_offers f JOIN products p ON f.product_id = p.id
     JOIN users u ON p.seller_id = u.id`
  );
  const banners = await pool.query('SELECT * FROM admin_banners ORDER BY created_at DESC');
  res.json({ products: productFeatured.rows, banners: banners.rows });
});
app.delete('/api/admin/featured/:id', authenticate, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM featured_offers WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم إزالة التمييز' });
});

app.post('/api/admin/banners', authenticate, adminOnly, upload.single('image'), async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) return res.status(400).json({ message: 'العنوان مطلوب' });
    if (!process.env.CLOUDINARY_CLOUD_NAME) return res.status(500).json({ message: 'إعدادات Cloudinary غير مكتملة.' });
    let imageUrl = null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      imageUrl = result.secure_url;
    }
    const banner = await pool.query(
      'INSERT INTO admin_banners (title, description, image, added_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [title, description || null, imageUrl, req.user.id]
    );
    res.status(201).json(banner.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ message: 'خطأ في الخادم' }); }
});
app.delete('/api/admin/banners/:id', authenticate, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM admin_banners WHERE id = $1', [req.params.id]);
  res.json({ message: 'تم حذف الإعلان' });
});

// ====================== البحث وإدارة المستخدمين ======================
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

app.get('/api/admin/users', authenticate, adminOnly, async (req, res) => {
  const result = await pool.query('SELECT id, username, phone, role, store_name, verified, max_products, created_at FROM users');
  res.json(result.rows);
});
app.put('/api/admin/user/:id', authenticate, adminOnly, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'seller', 'admin'].includes(role)) return res.status(400).json({ message: 'دور غير صالح' });
  await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
  res.json({ message: 'تم تحديث الدور' });
});
app.delete('/api/admin/user/:id', authenticate, adminOnly, async (req, res) => {
  const result = await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [req.params.id, 'admin']);
  if (result.rowCount === 0) return res.status(404).json({ message: 'المستخدم غير موجود أو لا يمكن حذف أدمن آخر' });
  res.json({ message: 'تم حذف المستخدم بنجاح' });
});

// ====================== نظام الباقات والترقيات ======================
app.post('/api/subscription/request', authenticate, sellerOnly, upload.single('receipt'), async (req, res) => {
  try {
    const { pack, duration, amount: priceAmount } = req.body;
    const extraProducts = parseInt(pack);
    if (![50, 100, 150, 200].includes(extraProducts)) {
      return res.status(400).json({ message: 'باقة غير صالحة.' });
    }
    const finalAmount = parseFloat(priceAmount) || (extraProducts / 50) * 5;

    let receiptUrl = null;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer);
      receiptUrl = result.secure_url;
    } else {
      return res.status(400).json({ message: 'يجب رفع إيصال الدفع.' });
    }

    await pool.query(
      `INSERT INTO subscription_requests (user_id, username, pack_name, amount, extra_products, payment_receipt, duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [req.user.id, req.user.username, `${extraProducts} منتج إضافي`, finalAmount, extraProducts, receiptUrl, duration || 'شهر']
    );

    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    for (const admin of admins.rows) {
      await addNotification(admin.id, `طلب ترقية جديد من ${req.user.username} - ${extraProducts} منتج إضافي.`);
    }

    res.json({ message: 'تم تقديم طلب الترقية بنجاح. سنقوم بمراجعته قريباً.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'خطأ في تقديم الطلب.' });
  }
});

app.get('/api/admin/subscription-requests', authenticate, adminOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM subscription_requests ORDER BY created_at DESC');
  res.json(result.rows);
});

app.put('/api/admin/subscription-requests/:id/approve', authenticate, adminOnly, async (req, res) => {
  const reqId = req.params.id;
  const request = await pool.query('SELECT * FROM subscription_requests WHERE id = $1', [reqId]);
  if (request.rows.length === 0) return res.status(404).json({ message: 'الطلب غير موجود' });
  if (request.rows[0].status !== 'pending') return res.status(400).json({ message: 'الطلب ليس قيد الانتظار' });

  const { user_id, extra_products } = request.rows[0];

  await pool.query('UPDATE users SET max_products = COALESCE(max_products, 20) + $1 WHERE id = $2', [extra_products, user_id]);
  await pool.query('UPDATE subscription_requests SET status = $1 WHERE id = $2', ['approved', reqId]);

  await addNotification(user_id, `تمت الموافقة على ترقية باقتك! تمت إضافة ${extra_products} منتج إضافي.`);

  res.json({ message: 'تمت الموافقة على الترقية.' });
});

app.put('/api/admin/subscription-requests/:id/reject', authenticate, adminOnly, async (req, res) => {
  const reqId = req.params.id;
  await pool.query('UPDATE subscription_requests SET status = $1 WHERE id = $2', ['rejected', reqId]);

  const request = await pool.query('SELECT user_id, extra_products FROM subscription_requests WHERE id = $1', [reqId]);
  if (request.rows.length > 0) {
    await addNotification(request.rows[0].user_id, `تم رفض طلب ترقية الباقة (${request.rows[0].extra_products} منتج).`);
  }

  res.json({ message: 'تم رفض الطلب.' });
});

// ====================== الإشعارات ======================
app.get('/api/notifications', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json(result.rows);
});

app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ message: 'ok' });
});

// ====================== سجل الحذف (للأدمن) ======================
app.get('/api/admin/deletion-logs', authenticate, adminOnly, async (req, res) => {
  const result = await pool.query(
    `SELECT dl.*, u.username as deleted_by_username, seller.username as seller_username
     FROM deletion_logs dl
     LEFT JOIN users u ON dl.deleted_by = u.id
     LEFT JOIN users seller ON dl.seller_id = seller.id
     ORDER BY dl.created_at DESC`
  );
  res.json(result.rows);
});

// ---------- معالجة الأخطاء ----------
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection:', reason);
});

// ---------- بدء الخادم ----------
(async () => {
  try {
    await createTables();
    await createAdminUser();
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 سلة تعمل على المنفذ ${PORT}`));
  } catch (err) {
    console.error('فشل بدء الخادم:', err);
    process.exit(1);
  }
})();
