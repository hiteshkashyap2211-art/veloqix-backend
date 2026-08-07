const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const authMiddleware = require('../middlewares/authMiddleware');

// Protected Routes (Token Required)
router.post('/add', authMiddleware, vehicleController.addVehicle);
router.get('/list', authMiddleware, vehicleController.getVehicles);
router.post('/telemetry', authMiddleware, vehicleController.ingestTelemetry);

module.exports = router;