// ============================================================
// config/index.js - الملف المركزي للإعدادات
// ============================================================

const dotenv = require('dotenv');
const path = require('path');

// تحميل متغيرات البيئة من ملف .env (إذا وجد)
dotenv.config({ path: path.join(__dirname, '../.env') });

module.exports = {
    // السيرفر
    PORT: process.env.PORT || 5000,
    SERVER_URL: process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`,
    NODE_ENV: process.env.NODE_ENV || 'development',

    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'BestDealGoldSystem_SuperSecretKey_2026_!@#$%',
    REFRESH_SECRET: process.env.REFRESH_SECRET || 'BestDealRefreshSecret_2026_!@#$%',

    // Admin Gateway (كلمة المرور السري للباب السري)
    ADMIN_GATEWAY_SECRET: process.env.ADMIN_GATEWAY_SECRET || 'MHDFREEZE2003',

    // CORS
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:5000'],

    // قاعدة البيانات
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || '',
    DB_NAME: process.env.DB_NAME || 'bestdeal',
    DB_PORT: parseInt(process.env.DB_PORT) || 3306,

    // التشفير
    SALT_ROUNDS: 10,

    // البريد الإلكتروني (اختياري)
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,

    // مسارات الملفات
    UPLOAD_DIR: path.join(__dirname, '../private_uploads'),
    BACKUP_DIR: path.join(__dirname, '../backups'),
    LOGS_DIR: path.join(__dirname, '../logs'),
};