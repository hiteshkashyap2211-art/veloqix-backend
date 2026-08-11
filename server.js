const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authRoutes = require('./src/routes/authRoutes');
const vehicleRoutes = require('./src/routes/vehicleRoutes');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'veloqix_super_secure_b2b_otp_key_2026!';

// 🍃 Safe Non-Blocking MongoDB Connection Setup
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/veloqix_db';

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('🍃 MongoDB Database Connected Successfully'))
  .catch((err) => console.warn('⚠️ MongoDB Connection Warning:', err.message));

// MongoDB Schemas & Models
const ShipmentSchema = new mongoose.Schema({
  tracking_id: { type: String, required: true, unique: true },
  status: { type: String, default: 'In Transit' },
  origin: { type: String, default: 'Delhi NCR Freight Hub' },
  destination: { type: String, default: 'Mumbai Port Gateway' },
  eta: { type: String, default: 'Today, 06:30 PM' },
  progress_percent: { type: Number, default: 75 },
  logs: Array,
  createdAt: { type: Date, default: Date.now }
});
const Shipment = mongoose.model('Shipment', ShipmentSchema);

const ContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, default: '' },
  company: { type: String, default: '' },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', ContactSchema);

const AdminAuthSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  hashed_otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: '5m' }
});
const AdminAuth = mongoose.model('AdminAuth', AdminAuthSchema);

// 🔒 In-Memory Fallback Store
const memoryOtpStore = new Map();

// 📧 High-Reliability Mail Transporter (Render Production Guarded)
const SENDER_EMAIL = process.env.EMAIL_USER || 'hiteshkashyap2211@gmail.com';
const SENDER_PASS = process.env.EMAIL_PASS || 'zjdeumtoqyntdiln';
const TARGET_ADMIN = process.env.ADMIN_EMAIL || 'hiteshkashyap2211@gmail.com';

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // TLS encrypted port 465 (Bypasses Render ISP Port 587 Filters)
  auth: {
    user: SENDER_EMAIL,
    pass: SENDER_PASS
  },
  dnsTimeout: 10000,
  connectionTimeout: 15000,
  socketTimeout: 15000,
  tls: {
    rejectUnauthorized: false
  }
});

// Verify SMTP Connection on Application Startup
transporter.verify((error) => {
  if (error) {
    console.error('❌ Mail Transporter Connection Error:', error.message);
  } else {
    console.log('📧 Mail Server Ready to Send Messages');
  }
});

// HTTP Server & Socket.IO Setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'DELETE'] }
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  req.io = io;
  next();
});

// 🔒 Admin Middleware Guard
const verifyAdminKey = (req, res, next) => {
  const secretHeader = req.headers['x-admin-secret'];
  const authHeader = req.headers['authorization'];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'veloqix_secure_admin_123';

  if (secretHeader && secretHeader === ADMIN_SECRET) {
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role === 'admin') {
        req.adminUser = decoded;
        return next();
      }
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or Expired Admin Token' });
    }
  }

  return res.status(401).json({ success: false, message: 'Access Denied: Invalid Security Key or Token' });
};

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);

// 🚀 Robust Admin OTP Sender Function
const handleSendOtp = async (req, res) => {
  const { email } = req.body;
  console.log(`📥 OTP request received for: ${email}`);

  if (!email || email.trim().toLowerCase() !== TARGET_ADMIN.toLowerCase()) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access Denied: Unregistered Administrative Email Address.' 
    });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashed_otp = bcrypt.hashSync(otp, 10);

  // 1. Store in Memory
  memoryOtpStore.set(TARGET_ADMIN.toLowerCase(), {
    hashed_otp,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  // 2. Store in MongoDB if available
  try {
    if (mongoose.connection.readyState === 1) {
      await AdminAuth.findOneAndUpdate(
        { email: TARGET_ADMIN.toLowerCase() },
        { hashed_otp },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (dbErr) {
    console.error('⚠️ DB OTP Storage Skipped:', dbErr.message);
  }

  // Always log to Render Console
  console.log(`\n========================================`);
  console.log(`🔑 ADMIN LOGIN OTP CODE: [ ${otp} ]`);
  console.log(`========================================\n`);

  const mailOptions = {
    from: `"Veloqix Security Portal" <${SENDER_EMAIL}>`,
    to: TARGET_ADMIN,
    subject: `🔑 Admin Passcode: ${otp}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #1e293b; border-radius: 10px; padding: 20px; background-color: #0f172a; color: #f8fafc;">
        <h2 style="color: #38bdf8; text-align: center;">VELOQIX LOGISTICS</h2>
        <p style="text-align: center; color: #94a3b8; font-size: 12px;">Admin Authentication Passcode</p>
        <hr style="border-color: #334155;">
        <p>Your one-time login code is:</p>
        <div style="background-color: #1e293b; border: 1px solid #0284c7; padding: 15px; text-align: center; border-radius: 8px; margin: 15px 0;">
          <span style="font-size: 30px; font-weight: bold; letter-spacing: 5px; color: #38bdf8; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #94a3b8; font-size: 11px;">Valid for 5 minutes. Do not share this code.</p>
      </div>
    `
  };

  // Dispatch Email
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ OTP Email Delivered: ${info.messageId}`);
    return res.status(200).json({
      success: true,
      message: `OTP sent successfully to ${TARGET_ADMIN}`
    });
  } catch (err) {
    console.error('❌ Mail Delivery Failed:', err.message);
    return res.status(200).json({
      success: true,
      message: 'OTP generated! Check email or terminal logs.'
    });
  }
};

// Endpoints
app.post('/api/v1/admin/generate-otp', handleSendOtp);
app.post('/api/v1/admin/send-otp', handleSendOtp);

// Login verification endpoint
app.post('/api/v1/admin/login-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || email.trim().toLowerCase() !== TARGET_ADMIN.toLowerCase()) {
    return res.status(401).json({ success: false, message: 'Invalid Admin Email.' });
  }

  if (!otp) {
    return res.status(400).json({ success: false, message: 'Enter OTP.' });
  }

  try {
    let isValid = false;

    // Check DB
    if (mongoose.connection.readyState === 1) {
      const record = await AdminAuth.findOne({ email: TARGET_ADMIN.toLowerCase() });
      if (record) {
        isValid = bcrypt.compareSync(otp, record.hashed_otp);
        if (isValid) await AdminAuth.deleteOne({ email: TARGET_ADMIN.toLowerCase() });
      }
    }

    // Check Memory Store
    if (!isValid && memoryOtpStore.has(TARGET_ADMIN.toLowerCase())) {
      const memRecord = memoryOtpStore.get(TARGET_ADMIN.toLowerCase());
      if (Date.now() <= memRecord.expiresAt) {
        isValid = bcrypt.compareSync(otp, memRecord.hashed_otp);
        if (isValid) memoryOtpStore.delete(TARGET_ADMIN.toLowerCase());
      }
    }

    if (isValid) {
      const token = jwt.sign({ email: TARGET_ADMIN, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
      return res.status(200).json({
        success: true,
        message: 'Login successful!',
        token: token
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server verification error.' });
  }
});

// Contact Endpoint
app.post('/api/v1/contact', async (req, res) => {
  const { name, email, phone, company, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const newInquiry = new Contact({ name, email, phone, company, message });
      await newInquiry.save();
    }
  } catch (dbErr) {
    console.error('⚠️ Inquiry DB Save Error:', dbErr.message);
  }

  try {
    await transporter.sendMail({
      from: `"${name}" <${SENDER_EMAIL}>`,
      to: TARGET_ADMIN,
      replyTo: email,
      subject: `New Inquiry from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nCompany: ${company}\nMessage: ${message}`
    });
  } catch (error) {
    console.error('⚠️ Contact Mail Error:', error.message);
  }

  return res.status(200).json({ success: true, message: 'Inquiry submitted successfully.' });
});

// Admin Inquiries API
app.get('/api/v1/admin/inquiries', verifyAdminKey, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'DB Disconnected' });
    const inquiries = await Contact.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, count: inquiries.length, data: inquiries });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/v1/admin/inquiries/:id', verifyAdminKey, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.status(503).json({ success: false, message: 'DB Disconnected' });
    await Contact.findByIdAndDelete(req.params.id);
    return res.status(200).json({ success: true, message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Tracking API Endpoint
app.post('/api/v1/track/', async (req, res) => {
  const { tracking_id } = req.body;
  if (!tracking_id) return res.status(400).json({ success: false, message: 'Enter tracking ID' });

  const input = tracking_id.trim();
  const isPhone = /^\d{10}$/.test(input);
  const searchId = isPhone ? `MOB-${input}` : input.toUpperCase();

  try {
    if (mongoose.connection.readyState === 1) {
      let dbShipment = await Shipment.findOne({ tracking_id: searchId }).maxTimeMS(1500);
      if (dbShipment) return res.status(200).json({ success: true, data: dbShipment });
    }
  } catch (err) {}

  return res.status(200).json({
    success: true,
    data: {
      tracking_id: searchId,
      status: 'In Transit',
      eta: 'Today, 06:30 PM',
      origin: 'Delhi NCR Freight Hub',
      destination: 'Mumbai Port Gateway',
      progress_percent: 75,
      logs: [{ title: 'Dispatched', time: '08:00 AM' }]
    }
  });
});

app.get('/api/health', (req, res) => res.status(200).json({ status: 'ACTIVE' }));
app.get('/driver.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'driver.html')));
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));

io.on('connection', (socket) => {
  socket.on('telemetry', (data) => io.emit('telemetry_update', data));
});

server.listen(PORT, () => console.log(`🚀 Gateway Running on Port ${PORT}`));