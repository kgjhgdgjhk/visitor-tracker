const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const axios = require('axios');
const useragent = require('useragent');
const moment = require('moment');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // يستمع على كل الواجهات الشبكية

// دالة للحصول على IP المحلي للجهاز
function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // اختيار IPv4 وغير داخلي
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

// تخزين بيانات الزوار
let visitors = [];
let onlineVisitors = 0;

// تجهيز الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// دالة للحصول على معلومات الموقع من IP
async function getLocationFromIP(ip) {
    // تنظيف الـ IP من أي بيانات إضافية
    let cleanIP = ip;
    if (ip.includes('::ffff:')) {
        cleanIP = ip.replace('::ffff:', '');
    }
    
    // تجاهل الـ IP المحلي والعناوين الخاصة
    if (cleanIP === '::1' || 
        cleanIP === '127.0.0.1' || 
        cleanIP.startsWith('192.168.') || 
        cleanIP.startsWith('10.0.') ||
        cleanIP.startsWith('172.16.') ||
        cleanIP.startsWith('169.254.')) {
        return { 
            country: 'محلي', 
            city: 'شبكة محلية', 
            flag: null 
        };
    }
    
    try {
        // استخدام API مجاني للحصول على الموقع
        const response = await axios.get(`http://ip-api.com/json/${cleanIP}`, {
            timeout: 3000 // مهلة 3 ثواني فقط
        });
        
        if (response.data && response.data.status === 'success') {
            return {
                country: response.data.country || 'غير معروف',
                city: response.data.city || 'غير معروف',
                flag: response.data.countryCode ? 
                    `https://flagcdn.com/24x18/${response.data.countryCode.toLowerCase()}.png` : 
                    null
            };
        }
    } catch (error) {
        console.log(`⚠️ خطأ في الحصول على موقع IP ${cleanIP}:`, error.message);
    }
    
    return { 
        country: 'غير معروف', 
        city: 'غير معروف', 
        flag: null 
    };
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
        console.log('خطأ في تحليل معلومات الجهاز:', error.message);
        return {
            browser: 'غير معروف',
            os: 'غير معروف',
            device: 'غير معروف'
        };
    }
}

// الصفحة الرئيسية - عرض الإحصائيات
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API لجلب بيانات الزوار
app.get('/api/visitors', (req, res) => {
    res.json(visitors);
});

// صفحة اختبار الاتصال
app.get('/ping', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'السيرفر يعمل بشكل طبيعي',
        time: moment().format('YYYY-MM-DD HH:mm:ss'),
        visitorsCount: visitors.length,
        onlineVisitors: onlineVisitors
    });
});

// عند زيارة الرابط الخاص بالتتبع
app.get('/track', async (req, res) => {
    try {
        // الحصول على IP العميل
        const clientIP = req.headers['x-forwarded-for'] || 
                        req.socket.remoteAddress || 
                        req.connection.remoteAddress;
        
        const userAgentString = req.headers['user-agent'] || 'غير معروف';
        const referer = req.headers['referer'] || 'زيارة مباشرة';
        
        console.log(`👤 زائر جديد من IP: ${clientIP}`);
        
        // الحصول على معلومات الموقع والجهاز
        const [location, deviceInfo] = await Promise.all([
            getLocationFromIP(clientIP),
            Promise.resolve(getDeviceInfo(userAgentString))
        ]);
        
        // إنشاء كائن الزائر
        const visitor = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            ip: clientIP,
            timestamp: moment().format('YYYY-MM-DD HH:mm:ss'),
            timeAgo: moment().fromNow(),
            location: location,
            device: deviceInfo,
            referer: referer,
            page: req.query.page || 'غير محدد',
            userAgent: userAgentString.substring(0, 50) + '...' // اختصار للعرض
        };
        
        // إضافة الزائر للقائمة (الحد الأقصى 50 زائر)
        visitors.unshift(visitor);
        if (visitors.length > 50) visitors.pop();
        
        // إرسال بيانات الزائر عبر Socket.io
        io.emit('new-visitor', visitor);
        io.emit('visitors-update', visitors);
        
        console.log(`✅ تم تسجيل زائر من: ${location.country} - ${location.city}`);
        
        // إرسال ملف HTML للتتبع
        res.sendFile(path.join(__dirname, 'public', 'track.html'));
        
    } catch (error) {
        console.log('❌ خطأ في معالجة طلب التتبع:', error.message);
        
        // في حالة الخطأ، نرسل صفحة مبسطة
        res.send(`
            <!DOCTYPE html>
            <html>
                <head>
                    <meta charset="UTF-8">
                    <title>تمت الزيارة</title>
                    <style>
                        body { 
                            font-family: Arial; 
                            text-align: center; 
                            padding: 50px; 
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .message {
                            background: rgba(255,255,255,0.1);
                            padding: 30px;
                            border-radius: 20px;
                            backdrop-filter: blur(10px);
                        }
                    </style>
                </head>
                <body>
                    <div class="message">
                        <h1>✅ تم تسجيل زيارتك</h1>
                        <p>شكراً لزيارتك</p>
                    </div>
                </body>
            </html>
        `);
    }
});

// Socket.io للاتصال المباشر
io.on('connection', (socket) => {
    onlineVisitors++;
    io.emit('online-count', onlineVisitors);
    
    console.log(`🔌 مستخدم جديد متصل - العدد الحالي: ${onlineVisitors}`);
    
    // إرسال البيانات الحالية للمستخدم الجديد
    socket.emit('visitors-update', visitors);
    
    socket.on('disconnect', () => {
        onlineVisitors--;
        io.emit('online-count', onlineVisitors);
        console.log(`🔌 مستخدم قطع الاتصال - العدد الحالي: ${onlineVisitors}`);
    });
});

// تشغيل السيرفر على كل الواجهات
server.listen(PORT, HOST, () => {
    const localIP = getLocalIP();
    console.log('\n' + '='.repeat(50));
    console.log(`🚀 السيرفر يعمل بنجاح!`);
    console.log('='.repeat(50));
    console.log(`📱 محلياً (هذا الجهاز فقط): http://localhost:${PORT}`);
    console.log(`🌐 من الشبكة (لأجهزة الواي فاي): http://${localIP}:${PORT}`);
    console.log('\n📊 روابط مهمة:');
    console.log(`📋 لوحة التحكم: http://${localIP}:${PORT}`);
    console.log(`🔗 رابط التتبع: http://${localIP}:${PORT}/track?page=facebook-ad`);
    console.log(`🏓 اختبار الاتصال: http://${localIP}:${PORT}/ping`);
    console.log('='.repeat(50));
    console.log('⚠️  ملاحظة: للأجهزة الأخرى استخدم الرابط الذي يبدأ بـ IP');
    console.log('📱 تأكد أن جميع الأجهزة متصلة بنفس شبكة الواي فاي');
    console.log('='.repeat(50) + '\n');
});