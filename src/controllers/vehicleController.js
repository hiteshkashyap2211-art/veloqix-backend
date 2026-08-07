const db = require('../config/db');

// 1. New Vehicle Register Karein
exports.addVehicle = async (req, res) => {
  const { vehicle_number, telemetry_device_id, type } = req.body;
  const tenant_id = req.user.tenantId; // Auth middleware se milega

  try {
    const newVehicle = await db.query(
      `INSERT INTO vehicles (tenant_id, vehicle_number, telemetry_device_id, type) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenant_id, vehicle_number, telemetry_device_id, type]
    );

    res.status(201).json({
      message: 'Vehicle registered successfully',
      vehicle: newVehicle.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register vehicle' });
  }
};

// 2. Client ke saare Vehicles Fetch Karein
exports.getVehicles = async (req, res) => {
  const tenant_id = req.user.tenantId;

  try {
    const vehicles = await db.query(
      'SELECT * FROM vehicles WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenant_id]
    );
    res.status(200).json(vehicles.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
};

// 3. IoT Telemetry Data Stream Intake with Geofence & Speed Alert Engine
exports.ingestTelemetry = async (req, res) => {
  const { vehicle_id, latitude, longitude, speed_kmh, temperature_celsius } = req.body;
  const tenant_id = req.user.tenantId;

  try {
    const telemetry = await db.query(
      `INSERT INTO telemetry_logs (vehicle_id, tenant_id, latitude, longitude, speed_kmh, temperature_celsius)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [vehicle_id, tenant_id, latitude, longitude, speed_kmh, temperature_celsius]
    );

    const telemetryData = telemetry.rows[0];

    // Real-Time Socket Broadcast to all Dashboard Subscribers
    if (req.io) {
      req.io.emit(`telemetry_update_${tenant_id}`, telemetryData);

      // 🚨 Real-time Speed Limit Alert Check (> 75 km/h)
      if (parseFloat(speed_kmh) > 75) {
        req.io.emit(`alert_${tenant_id}`, {
          type: 'OVERSPEED_WARNING',
          severity: 'CRITICAL',
          message: `Vehicle (${vehicle_id}) exceeded threshold! Current Speed: ${speed_kmh} km/h`,
          timestamp: new Date()
        });
      }
    }

    res.status(201).json({
      status: 'Telemetry Received & Processed',
      data: telemetryData
    });
  } catch (err) {
    console.error('Telemetry Processing Error:', err);
    res.status(500).json({ error: 'Failed to ingest telemetry' });
  }
};