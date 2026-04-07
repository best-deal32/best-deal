// ============================================================
// routes/authRoutes.js
// جميع مسارات المصادقة
// ============================================================

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');

// تسجيل حساب جديد
router.post('/register', authLimiter, authController.register);

// تسجيل الدخول
router.post('/login', authLimiter, authController.login);

// إرسال رمز التحقق للتسجيل
router.post('/send-verification', authController.sendVerification);

// إرسال رمز إعادة تعيين كلمة المرور
router.post('/send-reset-code', authController.sendResetCode);

// (يمكن إضافة باقي مسارات 2FA أو refresh token لاحقاً)

module.exports = router;