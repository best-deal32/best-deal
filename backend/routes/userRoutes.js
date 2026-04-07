// ============================================================
// routes/userRoutes.js
// مسارات المستخدم العادي
// ============================================================

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

// الحصول على بيانات المستخدم الحالي (يتطلب توكن صالح)
router.get('/me', authenticateToken, userController.getMe);

module.exports = router;