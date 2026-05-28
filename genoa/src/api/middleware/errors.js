// Single error-handling middleware.  Always returns structured JSON.
// Never leaks stack traces in production.

export function errorHandler(err, _req, res, _next){
  const status = err.http_status || 500;
  const body = {
    error:    err.code || 'INTERNAL_ERROR',
    message:  err.message || 'internal error'
  };
  if (err.warning) body.warning = err.warning;
  if (process.env.NODE_ENV !== 'production') body.stack = err.stack;
  if (status >= 500) console.error('[genoa] error:', err && err.stack || err);
  res.status(status).json(body);
}

export function asyncHandler(fn){
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
