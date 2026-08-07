// Mock DB Config for Testing & Development
module.exports = {
  query: async (text, params) => {
    console.log('⚡ Mock DB Query Executed:', text);
    
    // Fake User Response for Login
    if (text.includes('SELECT * FROM users')) {
      return {
        rows: [
          {
            id: 1,
            tenant_id: 1,
            full_name: 'Admin User',
            email: params[0] || 'admin@veloqix.com',
            // Default password hash for bcrypt ("123456" ya koi bhi password chalega)
            password_hash: '$2a$10$wT/X8.U0kP4lW2nK3H.z8e.Nf2u2z0A.1XmE0I8l7y1L1u4pL1G2u', 
            role: 'TENANT_ADMIN'
          }
        ]
      };
    }

    // Fake Response for Insert queries
    if (text.includes('INSERT INTO')) {
      return { rows: [{ id: 1 }] };
    }

    return { rows: [] };
  }
};