// ============================================================
// utils/logger.js
// نظام تسجيل الأخطاء
// ============================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');

const logsDir = config.LOGS_DIR;
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const errorLogStream = fs.createWriteStream(path.join(logsDir, 'error.log'), { flags: 'a' });

function logError(error, req = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${req ? req.method + ' ' + req.url : ''} - ${error.stack || error.message || error}\n`;
    errorLogStream.write(logEntry);
    console.error(logEntry);
}

function logInfo(message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] INFO: ${message} ${data ? JSON.stringify(data) : ''}\n`;
    console.log(logEntry);
}

module.exports = { logError, logInfo };