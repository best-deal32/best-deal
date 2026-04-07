// controllers/authController.js
const bcrypt = require('bcrypt');
const { getDb } = require('../config/db');
const { generateToken, generateRefreshToken } = require('../config/jwt');
const { generateVerificationCode } = require('../utils/helpers');
const config = require('../config');

// دالة تسجيل الدخول (مبسطة ومضمونة)
async function login(req, res) {
    try {
        const { username, password } = req.body;
        const db = getDb();

        // التحقق من وجود المستخدم
        const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        const user = rows[0];

        if (!user) {
            return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        // التحقق من كلمة المرور
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }

        // إنشاء التوكنات
        const token = generateToken(user.id, user.username, user.role);
        const refreshToken = generateRefreshToken(user.id);

        // حفظ refreshToken في قاعدة البيانات (اختياري)
        await db.execute('UPDATE users SET refreshToken = ? WHERE id = ?', [refreshToken, user.id]);

        // تعيين الكوكيز
        res.cookie('token', token, {
            httpOnly: true,
            secure: config.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 15 * 60 * 1000
        });
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: config.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        // إرجاع بيانات المستخدم (بدون كلمة المرور)
        const { password: _, ...userData } = user;
        res.json({ success: true, user: userData });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'حدث خطأ داخلي في الخادم' });
    }
}

// باقي الدوال (register, sendVerification, sendResetCode) كما هي...
// (سأكتبها كاملة أدناه)

async function register(req, res) {
    try {
        const { username, password, fullName, email, origin, currentLocation, currentJob, verificationCode } = req.body;
        const db = getDb();

        // التحقق من وجود المستخدم
        const [existing] = await db.execute('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'اسم المستخدم أو البريد الإلكتروني مستخدم مسبقاً' });
        }

        const hashedPassword = await bcrypt.hash(password, config.SALT_ROUNDS);
        const userId = `USER_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const referralCode = `REF_${username.toUpperCase()}_${Math.random().toString(36).substr(2, 4)}`;

        await db.execute(
            `INSERT INTO users 
            (id, username, password, fullName, email, origin, currentLocation, currentJob, createdAt, isVerified, referralCode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, username, hashedPassword, fullName, email, origin || 'غير محدد', currentLocation || 'غير محدد', currentJob || 'بدون عمل', new Date(), 0, referralCode]
        );

        res.json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'حدث خطأ أثناء التسجيل' });
    }
}

async function sendVerification(req, res) {
    const { email } = req.body;
    const code = generateVerificationCode();
    // إرسال البريد (يمكنك استخدام sendVerificationEmail من utils)
    // هنا نكتفي بطباعة الرمز للاختبار
    console.log(`[Verification] رمز التحقق لـ ${email}: ${code}`);
    res.json({ success: true, message: 'تم إرسال الرمز (للاختبار: تحقق من وحدة التحكم)' });
}

async function sendResetCode(req, res) {
    const { email } = req.body;
    const code = generateVerificationCode();
    console.log(`[Reset] رمز إعادة التعيين لـ ${email}: ${code}`);
    res.json({ success: true, message: 'تم إرسال الرمز' });
}

module.exports = {
    login,
    register,
    sendVerification,
    sendResetCode
};