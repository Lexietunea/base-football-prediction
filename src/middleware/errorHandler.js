// ============================================================
// MIDDLEWARE (src/middleware/errorHandler.js)
// ============================================================

// Global error handler — catches anything that calls next(err)
function errorHandler(err, req, res, next) {
  console.error(`❌  [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.error(`    ${err.message}`);

  // Postgres duplicate key error
  if (err.code === '23505') {
    return res.status(409).json({ success: false, error: 'Duplicate entry — this record already exists' });
  }

  // Postgres foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ success: false, error: 'Referenced record does not exist' });
  }

  // Default
  res.status(500).json({
    success: false,
    error:   process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
}

module.exports = { errorHandler };
