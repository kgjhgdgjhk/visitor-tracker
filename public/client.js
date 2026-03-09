const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 20000
});

let currentUser = '';
let typingTimeout;

// التحقق من اتصال Socket
socket.on('connect', () => {
    console.log('✅ متصل بالسيرفر');
    // طلب تحديث البيانات
    socket.emit('request-update');
});

socket.on('connect_error', (error) => {
    console.log('❌ خطأ في الاتصال:', error);
    // محاولة إعادة الاتصال
    setTimeout(() => {
        socket.connect();
    }, 2000);
});

socket.on('connected', (data) => {
    console.log('📡 رسالة من السيرفر:', data.message);
});

socket.on('ping-server', (data) => {
    console.log('🏓 تحديث من السيرفر:', data.time, 'المتصلين:', data.online);
});

// دالة تسجيل الدخول
function login() {
    const username = document.getElementById('username').value.trim();
    
    if (username) {
        currentUser = username;
        socket.emit('user-login', username);
        
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('chat-container').style.display = 'flex';
        
        addMessage('النظام', `مرحباً بك ${username} في الدردشة`, 'system');
    } else {
        alert('الرجاء إدخال اسم المستخدم');
    }
}

// دالة إرسال الرسالة
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    
    if (message) {
        socket.emit('send-message', message);
        input.value = '';
    }
}

// إضافة رسالة إلى الشاشة
function addMessage(user, text, type = 'received') {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    
    if (user === 'النظام') {
        messageDiv.className = 'system-message';
        messageDiv.textContent = text;
    } else {
        messageDiv.className = `message ${type === 'sent' ? 'sent' : 'received'}`;
        messageDiv.innerHTML = `
            <div class="user">${user}</div>
            <div class="text">${text}</div>
            <div class="time">${new Date().toLocaleTimeString()}</div>
        `;
    }
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// التعامل مع كتابة الرسالة
document.getElementById('message-input').addEventListener('input', () => {
    socket.emit('typing');
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('stop-typing');
    }, 1000);
});

// استقبال الرسائل
socket.on('message', (data) => {
    const type = data.user === currentUser ? 'sent' : 'received';
    addMessage(data.user, data.text, type);
});

// تحديث قائمة المستخدمين
socket.on('users-update', (users) => {
    document.getElementById('online-count').textContent = users.length;
});

// مؤشر الكتابة
socket.on('user-typing', (username) => {
    document.getElementById('typing').textContent = `${username} يكتب...`;
});

socket.on('user-stop-typing', () => {
    document.getElementById('typing').textContent = '';
});

// استقبال تحديث الزوار
socket.on('visitors-update', (data) => {
    console.log('📊 تحديث الزوار:', data.length);
    updateVisitorsTable(data);
});

socket.on('new-visitor', (visitor) => {
    console.log('👤 زائر جديد:', visitor);
    if (Notification.permission === 'granted') {
        new Notification('زائر جديد!', {
            body: `من ${visitor.location.country} - ${visitor.location.city}`,
            icon: visitor.location.flag
        });
    }
});

socket.on('online-count', (count) => {
    document.getElementById('online-visitors').textContent = count;
});

// طلب الإذن للإشعارات
if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

// إرسال الرسالة عند الضغط على Enter
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// دالة تحديث جدول الزوار
function updateVisitorsTable(visitors) {
    const tbody = document.getElementById('visitors-body');
    if (!tbody) return;
    
    if (!visitors || visitors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">لا يوجد زوار</td></tr>';
        return;
    }
    
    tbody.innerHTML = visitors.map(v => `
        <tr>
            <td>${v.timestamp}</td>
            <td>${v.location.country} - ${v.location.city}</td>
            <td>${v.ip}</td>
            <td>${v.device.device}</td>
            <td>${v.device.browser}</td>
            <td>${v.device.os}</td>
            <td>${v.page}</td>
        </tr>
    `).join('');
}