const db = require('../config/db');

// 1. New Vehicle Register Karein
exports.addVehicle = async (req, res) => {
  const { vehicle_number, telemetry_device_id, type } = req.body;
  // Safety Fallback: Auth middleware req.user na dene par fallback handle karega
  const tenant_id = req.user?.tenantId || req.body.tenant_id || 'default_tenant';

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
    console.error('Error adding vehicle:', err);
    res.status(500).json({ error: 'Failed to register vehicle' });
  }
};

// 2. Client ke saare Vehicles Fetch Karein
exports.getVehicles = async (req, res) => {
  // Safety Fallback check
  const tenant_id = req.user?.tenantId || req.query.tenant_id || 'default_tenant';

  try {
    const vehicles = await db.query(
      'SELECT * FROM vehicles WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenant_id]
    );
    res.status(200).json(vehicles.rows);
  } catch (err) {
    console.error('Error fetching vehicles:', err);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
};

// 3. IoT Telemetry Data Stream Intake with Geofence & Speed Alert Engine
exports.ingestTelemetry = async (req, res) => {
  const { vehicle_id, latitude, longitude, speed_kmh, temperature_celsius } = req.body;
  
  // Safe extraction for tenant_id without throwing TypeError
  const tenant_id = req.user?.tenantId || req.body.tenant_id || 'default_tenant';

  try {
    const telemetry = await db.query(
      `INSERT INTO telemetry_logs (vehicle_id, tenant_id, latitude, longitude, speed_kmh, temperature_celsius)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [vehicle_id, tenant_id, latitude, longitude, speed_kmh, temperature_celsius]
    );

    const telemetryData = telemetry.rows[0];

    // Real-Time Socket Broadcast to all Dashboard Subscribers
    if (req.io) {
      // Broadcast to Tenant Channel
      req.io.emit(`telemetry_update_${tenant_id}`, telemetryData);
      // Generic Broadcast Fallback for single-tenant / global listeners
      req.io.emit('telemetry_update', telemetryData);

      // 🚨 Real-time Speed Limit Alert Check (> 75 km/h)
      if (parseFloat(speed_kmh) > 75) {
        const alertPayload = {
          type: 'OVERSPEED_WARNING',
          severity: 'CRITICAL',
          message: `Vehicle (${vehicle_id}) exceeded threshold! Current Speed: ${speed_kmh} km/h`,
          timestamp: new Date()
        };

        req.io.emit(`alert_${tenant_id}`, alertPayload);
        req.io.emit('alert', alertPayload);
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