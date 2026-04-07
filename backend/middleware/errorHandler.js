// ============================================================
// middleware/errorHandler.js
// معالج الأخطاء المركزي
// ============================================================

const { logError } = require('../utils/logger');

/**
 * Error Handler مركزي لجميع الأخطاء غير المتوقعة
 */
function errorHandler(err, req, res, next) {
    logError(err, req);

    const statusCode = err.status || 500;
    const message = statusCode === 500 
        ? 'حدث خطأ داخلي في الخادم، يرجى المحاولة لاحقاً'
        : (err.message || 'حدث خطأ غير متوقع');

    res.status(statusCode).json({
        success: false,
        message: message,
        ...(process.env.NODE_ENV === 'development' && {
            error: err.message,
            stack: err.stack
        })
    });
}

module.exports = { errorHandler };