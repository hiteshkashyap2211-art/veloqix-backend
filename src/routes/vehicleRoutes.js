const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');

// Routes
router.post('/add', vehicleController.addVehicle);
router.get('/', vehicleController.getVehicles);

// ✅ FIX: Telemetry ingest endpoint ko public/open kar diya taaki live tracking bina token ke chal sake
router.post('/telemetry', vehicleController.ingestTelemetry);

module.exports = router;