// ============================================================
// routes/depositRoutes.js
// مسارات الإيداع
// ============================================================

const express = require('express');
const router = express.Router();
const depositController = require('../controllers/depositController');
const { authenticateToken } = require('../middleware/auth');
const { depositLimiter } = require('../middleware/rateLimiter');

// إضافة طلب إيداع (مع رفع صورة)
router.post('/add', authenticateToken, depositLimiter, depositController.upload.single('screenshot'), depositController.addDeposit);

// (اختياري) جلب طلبات الإيداع المعلقة (للوحة الأدمن)
router.get('/pending', authenticateToken, depositController.getPendingDeposits);

module.exports = router;