// ============================================================
// middleware/rateLimiter.js
// Rate Limiters محسنة ومنظمة
// ============================================================

const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,        // 15 دقيقة
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة لاحقاً' }
});

const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,        // ساعة
    max: 15,
    message: { success: false, message: 'تم تجاوز عدد محاولات تسجيل الدخول/التسجيل' }
});

const depositLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'الحد الأقصى 5 طلبات إيداع في اليوم' }
});

const withdrawLimiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 3,
    message: { success: false, message: 'الحد الأقصى 3 طلبات سحب في اليوم' }
});

module.exports = {
    globalLimiter,
    authLimiter,
    depositLimiter,
    withdrawLimiter
};