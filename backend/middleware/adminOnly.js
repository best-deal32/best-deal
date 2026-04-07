// ============================================================
// middleware/adminOnly.js
// التحقق من أن المستخدم مدير (يجب أن يأتي بعد auth)
// ============================================================

/**
 * Middleware للتحقق من صلاحية المدير
 */
function adminOnly(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            message: 'غير مصرح - يرجى تسجيل الدخول'
        });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'صلاحيات مدير مطلوبة لهذا الطلب'
        });
    }

    next();
}

module.exports = { adminOnly };