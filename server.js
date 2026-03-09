const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const axios = require('axios');
const useragent = require('useragent');
const moment = require('moment');
const fs = require('fs'); // أضفنا هذا للسطر

const app = express();
const server = http.createServer(app);

// إعدادات CORS
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// تخزين بيانات الزوار
let visitors = [];
let onlineVisitors = 0;

// ✅ الأهم: تحديد المسار الصحيح للمجلد العام
// في Render، المسار الحالي هو /opt/render/project/src
const currentDir = process.cwd();
const publicPath = path.join(currentDir, 'public');

console.log('📁 المسار الحالي:', currentDir);
console.log('📁 مجلد public:', publicPath);

// التحقق من وجود المجلد public
if (!fs.existsSync(publicPath)) {
    console.log('⚠️ مجلد public غير موجود! سيتم إنشاؤه');
    fs.mkdirSync(publicPath, { recursive: true });
}

// تجهيز الملفات الثابتة - طريقتان للتأكد
app.use(express.static(publicPath));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// دالة للحصول على IP الحقيقي
function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0];
    }
    return req.socket.remoteAddress || req.connection.remoteAddress;
}

// دالة للحصول على معلومات الموقع
async function getLocationFromIP(ip) {
    let cleanIP = ip;
    if (ip && ip.includes('::ffff:')) {
        cleanIP = ip.replace('::ffff:', '');
    }
    
    if (!cleanIP || cleanIP === '::1' || cleanIP === '127.0.0.1' || 
        cleanIP.includes('192.168.') || cleanIP.includes('10.0.')) {
        return { country: 'محلي', city: 'شبكة محلية', flag: null };
    }
    
    try {
        const response = await axios.get(`http://ip-api.com/json/${cleanIP}`, { timeout: 3000 });
        if (response.data && response.data.status === 'success') {
            return {
                country: response.data.country || 'غير معروف',
                city: response.data.city || 'غير معروف',
                flag: response.data.countryCode ? 
                    `https://flagcdn.com/24x18/${response.data.countryCode.toLowerCase()}.png` : null
            };
        }
    } catch (error) {
        console.log(`⚠️ خطأ في الحصول على موقع IP: ${error.message}`);
    }
    
    return { country: 'غير معروف', city: 'غير معروف', flag: null };
}

// دالة لتحليل معلومات الجهاز
function getDeviceInfo(userAgentString) {
    try {
        const agent = useragent.parse(userAgentString);
        return {
            browser: agent.family || 'غير معروف',
            os: agent.os.toString() || 'غير معروف',
            device: agent.device.toString() || 'Desktop'
        };
    } catch (error) {
        return { browser: 'غير معروف', os: 'غير معروف', device: 'غير معروف' };
    }
}

// ✅ مسار اختبار لمعرفة المشكلة (مهم جداً)
app.get('/debug', (req, res) => {
    const files = {
        currentDir: currentDir,
        publicPath: publicPath,
        publicExists: fs.existsSync(publicPath),
        files: [],
        publicFiles: []
    };
    
    try {
        files.files = fs.readdirSync(currentDir);
        if (fs.existsSync(publicPath)) {
            files.publicFiles = fs.readdirSync(publicPath);
        }
    } catch(e) {
        files.error = e.message;
    }
    
    res.json(files);
});

// ✅ الصفحة الرئيسية مع التحقق من وجود الملف
app.get('/', (req, res) => {
    const possiblePaths = [
        path.join(publicPath, 'index.html'),
        path.join(currentDir, 'public', 'index.html'),
        path.join(__dirname, 'public', 'index.html')
    ];
    
    for (const filePath of possiblePaths) {
        if (fs.existsSync(filePath)) {
            console.log('✅ تم العثور على index.html في:', filePath);
            return res.sendFile(filePath);
        }
    }
    
    // إذا لم يوجد الملف
    res.status(404).send(`
        <html>
        <head><title>خطأ</title></head>
        <body style="font-family:Arial; text-align:center; padding:50px; direction:rtl">
            <h1>❌ الملف index.html غير موجود</h1>
            <p>المسارات التي تم البحث فيها:</p>
            <ul style="text-align:right">
                ${possiblePaths.map(p => `<li>${p}</li>`).join('')}
            </ul>
            <p>الملفات الموجودة في المجلد الحالي:</p>
            <pre>${JSON.stringify(fs.readdirSync(currentDir), null, 2)}</pre>
            <hr>
            <p>جرب <a href="/debug">/debug</a> لمعرفة المزيد</p>
        </body>
        </html>
    `);
});

// ✅ مسار التتبع
app.get('/track', async (req, res) => {
    try {
        const clientIP = getClientIP(req);
        const userAgentString = req.headers['user-agent'] || 'غير معروف';
        const referer = req.headers['referer'] || 'زيارة مباشرة';
        const pageName = req.query.page || 'غير محدد';
        
        console.log(`👤 زائر جديد من IP: ${clientIP} - الصفحة: ${pageName}`);
        
        const [location, deviceInfo] = await Promise.all([
            getLocationFromIP(clientIP),
            Promise.resolve(getDeviceInfo(userAgentString))
        ]);
        
        const visitor = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            ip: clientIP,
            timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
            timeAgo: moment().fromNow(),
            location: location,
            device: deviceInfo,
            referer: referer,
            page: pageName
        };
        
        visitors.unshift(visitor);
        if (visitors.length > 50) visitors.pop();
        
        io.emit('new-visitor', visitor);
        io.emit('visitors-update', visitors);
        
        console.log(`✅ تم تسجيل زائر من: ${location.country} - ${location.city}`);
        
        // البحث عن ملف track.html
        const trackPaths = [
            path.join(publicPath, 'track.html'),
            path.join(currentDir, 'public', 'track.html'),
            path.join(__dirname, 'public', 'track.html')
        ];
        
        for (const filePath of trackPaths) {
            if (fs.existsSync(filePath)) {
                return res.sendFile(filePath);
            }
        }
        
        // إذا لم يوجد الملف
        res.send(`
            <!DOCTYPE html>
            <html>
                <head><meta charset="UTF-8"><title>تمت الزيارة</title>
                <style>body{font-family:Arial;text-align:center;padding:50px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;}.message{background:rgba(255,255,255,0.1);padding:30px;border-radius:20px;backdrop-filter:blur(10px);}</style>
                </head>
                <body><div class="message"><h1>✅ تم تسجيل زيارتك</h1><p>شكراً لزيارتك</p></div></body>
            </html>
        `);
        
    } catch (error) {
        console.log('❌ خطأ:', error.message);
        res.send(`<h1>خطأ: ${error.message}</h1>`);
    }
});

// API لجلب بيانات الزوار
app.get('/api/visitors', (req, res) => {
    res.json(visitors);
});

// صفحة اختبار الاتصال
app.get('/ping', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'السيرفر يعمل على Render',
        time: moment().format('YYYY-MM-DD HH:mm:ss'),
        visitorsCount: visitors.length,
        onlineVisitors: onlineVisitors
    });
});

// Socket.io
io.on('connection', (socket) => {
    onlineVisitors++;
    io.emit('online-count', onlineVisitors);
    socket.emit('visitors-update', visitors);
    
    socket.on('disconnect', () => {
        onlineVisitors--;
        io.emit('online-count', onlineVisitors);
    });
});

// تشغيل السيرفر
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log(`🚀 السيرفر يعمل بنجاح على Render!`);
    console.log('='.repeat(50));
    console.log(`📊 المنفذ: ${PORT}`);
    console.log(`🌐 الرابط: https://visitor-tracker-ebc4.onrender.com`);
    console.log(`🔍 Debug: https://visitor-tracker-ebc4.onrender.com/debug`);
    console.log(`🏓 Ping: https://visitor-tracker-ebc4.onrender.com/ping`);
    console.log(`📋 لوحة التحكم: https://visitor-tracker-ebc4.onrender.com/`);
    console.log(`🔗 رابط التتبع: https://visitor-tracker-ebc4.onrender.com/track?page=example`);
    console.log('='.repeat(50) + '\n');
});