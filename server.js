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

// MongoDB Shipment Schema & Model
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

// 📝 MongoDB Contact Inquiry Schema & Model
const ContactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, default: '' },
  company: { type: String, default: '' },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Contact = mongoose.model('Contact', ContactSchema);

// 🔑 MongoDB Admin OTP Authentication Schema & Model
const AdminAuthSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  hashed_otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: '5m' } // OTP expires in 5 minutes
});

const AdminAuth = mongoose.model('AdminAuth', AdminAuthSchema);

// 🔒 In-Memory Fallback Store (In case MongoDB is disconnected/sleeping)
const memoryOtpStore = new Map();

// 📧 High-Reliability IPv4 Gmail Transporter (Fixes Render ENETUNREACH & Port Blocks)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  family: 4, // 👈 Forces IPv4 to prevent ENETUNREACH IPv6 routing errors
  auth: {
    user: process.env.EMAIL_USER || 'hiteshkashyap2211@gmail.com',
    pass: process.env.EMAIL_PASS || 'zjdeumtoqyntdiln'
  }
});

// HTTP Server & Socket.IO Setup
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Pass Socket.io instance to request pipeline (Middleware)
app.use((req, res, next) => {
  req.io = io;
  next();
});

// 🔒 Admin Middleware Guard (Supports Secret Header OR Bearer Token)
const verifyAdminKey = (req, res, next) => {
  const secretHeader = req.headers['x-admin-secret'];
  const authHeader = req.headers['authorization'];
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'veloqix_secure_admin_123';

  // 1️⃣ Validate Secret Header
  if (secretHeader && secretHeader === ADMIN_SECRET) {
    return next();
  }

  // 2️⃣ Validate JWT Bearer Token
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

// 🚀 ADMIN OTP AUTHENTICATION HELPER FUNCTION (Non-blocking & High Reliability)
const handleSendOtp = async (req, res) => {
  const { email } = req.body;
  console.log(`📥 OTP requested for admin: ${email}`);

  const targetAdminEmail = process.env.ADMIN_EMAIL || 'hiteshkashyap2211@gmail.com';

  if (!email || email.trim().toLowerCase() !== targetAdminEmail.toLowerCase()) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access Denied: Unregistered Administrative Email Address.' 
    });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const hashed_otp = bcrypt.hashSync(otp, 10);

  // Always store in In-Memory Map as Primary/Fallback
  memoryOtpStore.set(targetAdminEmail.toLowerCase(), {
    hashed_otp,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  // Save OTP to MongoDB if DB is connected
  try {
    if (mongoose.connection.readyState === 1) {
      await AdminAuth.findOneAndUpdate(
        { email: targetAdminEmail },
        { hashed_otp },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      console.log(`💾 Secure OTP generated & saved in DB for ${targetAdminEmail}`);
    }
  } catch (dbErr) {
    console.error('⚠️ Could not save OTP to DB (using memory store):', dbErr.message);
  }

  // 🔑 ALWAYS LOG TO RENDER TERMINAL FOR EMERGENCY LOGIN ACCESS
  console.log(`\n========================================`);
  console.log(`🔑 ADMIN LOGIN OTP CODE: [ ${otp} ]`);
  console.log(`========================================\n`);

  // Prepare Mail Options
  const mailOptions = {
    from: `"Veloqix Security Portal" <${process.env.EMAIL_USER || 'hiteshkashyap2211@gmail.com'}>`,
    to: targetAdminEmail,
    subject: `🔑 Admin Authentication Passcode: ${otp}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 550px; margin: auto; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; background-color: #0f172a; color: #f8fafc;">
        <h2 style="color: #38bdf8; text-align: center; margin-bottom: 8px;">VELOQIX LOGISTICS</h2>
        <p style="text-align: center; color: #94a3b8; font-size: 13px; margin-top: 0;">Enterprise Security Authentication</p>
        <hr style="border-color: #334155; margin: 20px 0;">
        <p>Your 6-digit one-time passcode for Admin Login access is:</p>
        <div style="background-color: #1e293b; border: 1px solid #0284c7; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #38bdf8; font-family: monospace;">${otp}</span>
        </div>
        <p style="color: #94a3b8; font-size: 12px;">This passcode will expire automatically in 5 minutes. Do not share this code with anyone.</p>
      </div>
    `
  };

  // 🚀 Non-Blocking Email Execution (Never causes 500 error on frontend UI)
  transporter.sendMail(mailOptions)
    .then(() => console.log(`📧 OTP Email successfully delivered to ${targetAdminEmail}`))
    .catch((err) => console.warn(`⚠️ Background Mail Error (Check App Password/Logs): ${err.message}`));

  // Immediate 200 Success Response
  return res.status(200).json({
    success: true,
    message: 'OTP processed and dispatched to admin email!'
  });
};

// 1️⃣ Generate & Send OTP Endpoints
app.post('/api/v1/admin/generate-otp', handleSendOtp);
app.post('/api/v1/admin/send-otp', handleSendOtp);

// 2️⃣ Verify OTP & Login
app.post('/api/v1/admin/login-otp', async (req, res) => {
  const { email, otp } = req.body;
  console.log(`📥 Verifying OTP for: ${email}`);

  const targetAdminEmail = process.env.ADMIN_EMAIL || 'hiteshkashyap2211@gmail.com';

  if (!email || email.trim().toLowerCase() !== targetAdminEmail.toLowerCase()) {
    return res.status(401).json({ success: false, message: 'Invalid Administrative Email.' });
  }

  if (!otp) {
    return res.status(400).json({ success: false, message: 'Please enter 6-digit OTP.' });
  }

  try {
    let isValid = false;

    // Check DB first if connected
    if (mongoose.connection.readyState === 1) {
      const record = await AdminAuth.findOne({ email: targetAdminEmail });
      if (record) {
        isValid = bcrypt.compareSync(otp, record.hashed_otp);
        if (isValid) {
          await AdminAuth.deleteOne({ email: targetAdminEmail });
        }
      }
    }

    // Fallback to In-Memory Store if DB wasn't checked or didn't match
    if (!isValid && memoryOtpStore.has(targetAdminEmail.toLowerCase())) {
      const memRecord = memoryOtpStore.get(targetAdminEmail.toLowerCase());
      if (Date.now() <= memRecord.expiresAt) {
        isValid = bcrypt.compareSync(otp, memRecord.hashed_otp);
        if (isValid) {
          memoryOtpStore.delete(targetAdminEmail.toLowerCase());
        }
      } else {
        memoryOtpStore.delete(targetAdminEmail.toLowerCase());
      }
    }

    if (isValid) {
      const token = jwt.sign({ email: targetAdminEmail, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });

      return res.status(200).json({
        success: true,
        message: 'Authentication successful!',
        token: token
      });
    } else {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP entered. Please try again.' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error during verification.' });
  }
});

// 📧 Contact & Enterprise Sales Form Endpoint
app.post('/api/v1/contact', async (req, res) => {
  console.log("📥 Incoming Contact Payload:", req.body);

  const { name, email, phone, company, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({
      success: false,
      message: 'Please provide Name, Email, and Message.'
    });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const newInquiry = new Contact({ name, email, phone, company, message });
      await newInquiry.save();
      console.log(`💾 Inquiry saved to MongoDB for ${name}`);
    }
  } catch (dbErr) {
    console.error('⚠️ Could not save inquiry to DB:', dbErr.message);
  }

  try {
    const mailOptions = {
      from: email,
      to: process.env.EMAIL_USER || 'hiteshkashyap2211@gmail.com',
      subject: `New Enterprise Inquiry from ${name} (${company || 'Individual'})`,
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'Not Provided'}\nCompany/Area: ${company || 'N/A'}\n\nMessage:\n${message}`
    };
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent successfully for ${name}`);
  } catch (error) {
    console.error('📧 Email delivery failed (logging only):', error.message);
  }

  return res.status(200).json({
    success: true,
    message: 'Inquiry submitted successfully! Our team will contact you soon.'
  });
});

// 📥 Get all contact inquiries
app.get('/api/v1/admin/inquiries', verifyAdminKey, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }
    const inquiries = await Contact.find().sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: inquiries.length,
      data: inquiries
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 🗑️ Delete inquiry by ID
app.delete('/api/v1/admin/inquiries/:id', verifyAdminKey, async (req, res) => {
  const { id } = req.params;
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid Inquiry ID format' });
    }

    const deletedInquiry = await Contact.findByIdAndDelete(id);

    if (!deletedInquiry) {
      return res.status(404).json({ success: false, message: 'Inquiry record not found' });
    }

    console.log(`🗑️ Inquiry [${id}] deleted successfully`);
    return res.status(200).json({
      success: true,
      message: 'Inquiry deleted successfully!'
    });
  } catch (err) {
    console.error('⚠️ Delete Inquiry Error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error while deleting inquiry' });
  }
});

// 🚀 Tracking API Endpoint
app.post('/api/v1/track/', async (req, res) => {
  const { tracking_id } = req.body;

  if (!tracking_id || tracking_id.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid Consignment ID or Phone Number'
    });
  }

  const input = tracking_id.trim();
  const isPhone = /^\d{10}$/.test(input);
  const searchId = isPhone ? `MOB-${input}` : input.toUpperCase();

  try {
    if (mongoose.connection.readyState === 1) {
      let dbShipment = await Shipment.findOne({ tracking_id: searchId }).maxTimeMS(1500);
      if (dbShipment) {
        return res.status(200).json({ success: true, data: dbShipment });
      }
    }
  } catch (err) {
    console.warn('⚠️ DB query skipped, serving fallback response');
  }

  return res.status(200).json({
    success: true,
    data: {
      tracking_id: searchId,
      search_type: isPhone ? 'Phone Number Search' : 'Consignment Search',
      status: 'In Transit',
      eta: 'Today, 06:30 PM',
      origin: 'Delhi NCR Freight Hub',
      destination: 'Mumbai Port Gateway',
      progress_percent: 75,
      logs: [
        {
          title: 'Passed RFID Toll Gate #4 (Jaipur Corridor)',
          time: '10 mins ago',
          temp: '4.2°C'
        },
        {
          title: 'Dispatched from NCR Logistics Hub',
          time: '08:00 AM',
          driver: '#9021'
        }
      ]
    }
  });
});

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ACTIVE', service: 'Veloqix Backend API' });
});

// Specific Route Fallback for driver.html
app.get('/driver.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver.html'));
});

// Catch-all route to serve admin-login.html for frontend requests
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

// Socket.io Real-time Connection Listener
io.on('connection', (socket) => {
  console.log(`🔌 New Telemetry Monitor Connected: ${socket.id}`);

  socket.on('telemetry', (data) => {
    console.log(`📡 Telemetry Received from Driver (${socket.id}):`, data);
    io.emit('telemetry_update', data);
    io.emit('telemetry', data);
    if (data.tenant_id) {
      io.emit(`telemetry_update_${data.tenant_id}`, data);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Monitor Disconnected: ${socket.id}`);
  });
});

// Server Listen Command (Single Execution)
server.listen(PORT, () => {
  console.log(`🚀 Veloqix Gateway & WebSockets running on port ${PORT}`);
});