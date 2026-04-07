// ============================================================
// routes/adminRoutes.js
// مسارات لوحة الإدارة
// ============================================================

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');

// ====================== إدارة المستخدمين ======================
router.get('/users', authenticateToken, adminOnly, adminController.getAllUsers);
router.get('/user/:id', authenticateToken, adminOnly, adminController.getUserDetails);
router.post('/set-user-balance', authenticateToken, adminOnly, adminController.setUserBalance);
router.post('/reset-user-password', authenticateToken, adminOnly, adminController.resetUserPassword);

// ====================== إدارة طلبات الإيداع ======================
router.get('/deposits', authenticateToken, adminOnly, adminController.getPendingDeposits);
router.post('/deposits/:id/:action', authenticateToken, adminOnly, adminController.handleDeposit);

// ====================== إدارة طلبات السحب ======================
router.get('/withdrawals', authenticateToken, adminOnly, adminController.getAllWithdrawals);
router.post('/withdrawals/:id/:action', authenticateToken, adminOnly, adminController.handleWithdrawal);

// ====================== التحقق من صلاحية المدير ======================
router.get('/verify', authenticateToken, adminController.verifyAdmin);

module.exports = router;