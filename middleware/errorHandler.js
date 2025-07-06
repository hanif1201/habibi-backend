// middleware/errorHandler.js - NEW ENHANCED ERROR HANDLING

// Custom error class for application-specific errors
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Async error wrapper to catch async function errors
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Enhanced validation error handler
const handleValidationError = (err) => {
  const errors = Object.values(err.errors).map((val) => ({
    field: val.path,
    message: val.message,
    value: val.value,
  }));

  return new AppError("Validation failed", 400, "VALIDATION_ERROR");
};

// Enhanced duplicate key error handler
const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];

  let message = "Duplicate field value";

  if (field === "email") {
    message = "An account with this email already exists";
  }

  return new AppError(message, 400, "DUPLICATE_FIELD");
};

// Cast error handler (invalid ObjectId, etc.)
const handleCastError = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400, "INVALID_ID");
};

// JWT error handlers
const handleJWTError = () => {
  return new AppError(
    "Invalid token. Please log in again",
    401,
    "INVALID_TOKEN"
  );
};

const handleJWTExpiredError = () => {
  return new AppError(
    "Your token has expired. Please log in again",
    401,
    "TOKEN_EXPIRED"
  );
};

// Rate limit error handler
const handleRateLimitError = () => {
  return new AppError(
    "Too many requests. Please try again later",
    429,
    "RATE_LIMIT_EXCEEDED"
  );
};

// File upload error handler
const handleMulterError = (err) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return new AppError(
      "File too large. Maximum size is 5MB",
      400,
      "FILE_TOO_LARGE"
    );
  }
  if (err.code === "LIMIT_FILE_COUNT") {
    return new AppError(
      "Too many files. Maximum 6 photos allowed",
      400,
      "TOO_MANY_FILES"
    );
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return new AppError("Unexpected file field", 400, "INVALID_FILE_FIELD");
  }
  return new AppError("File upload error", 400, "UPLOAD_ERROR");
};

// Send error response in development
const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    code: err.code,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });
};

// Send error response in production
const sendErrorProd = (err, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
      timestamp: new Date().toISOString(),
    });
  } else {
    // Programming or other unknown error: don't leak error details
    console.error("ERROR 💥", err);

    res.status(500).json({
      success: false,
      message: "Something went wrong!",
      code: "INTERNAL_ERROR",
      timestamp: new Date().toISOString(),
    });
  }
};

// Main error handling middleware
const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // Log error for monitoring
  console.error("Error occurred:", {
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
    path: req.path,
    method: req.method,
    userId: req.user?._id,
    timestamp: new Date().toISOString(),
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(err, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    // Handle specific error types
    if (error.name === "CastError") error = handleCastError(error);
    if (error.code === 11000) error = handleDuplicateKeyError(error);
    if (error.name === "ValidationError") error = handleValidationError(error);
    if (error.name === "JsonWebTokenError") error = handleJWTError();
    if (error.name === "TokenExpiredError") error = handleJWTExpiredError();
    if (error.name === "MulterError") error = handleMulterError(error);
    if (error.statusCode === 429) error = handleRateLimitError();

    sendErrorProd(error, res);
  }
};

// 404 handler for unknown routes
const notFoundHandler = (req, res, next) => {
  const err = new AppError(
    `Can't find ${req.originalUrl} on this server!`,
    404,
    "ROUTE_NOT_FOUND"
  );
  next(err);
};

// Validation middleware for common patterns
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      const message = error.details[0].message;
      return next(new AppError(message, 400, "VALIDATION_ERROR"));
    }
    next();
  };
};

// Rate limiting with custom error handling
const createRateLimit = (windowMs, max, message, code = "RATE_LIMIT") => {
  const rateLimit = require("express-rate-limit");

  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      code,
      timestamp: new Date().toISOString(),
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message,
        code,
        timestamp: new Date().toISOString(),
      });
    },
  });
};

// Database connection error handler
const handleDBConnection = () => {
  process.on("unhandledRejection", (err) => {
    console.log("UNHANDLED REJECTION! 💥 Shutting down...");
    console.log(err.name, err.message);
    process.exit(1);
  });

  process.on("uncaughtException", (err) => {
    console.log("UNCAUGHT EXCEPTION! 💥 Shutting down...");
    console.log(err.name, err.message);
    process.exit(1);
  });
};

// Security error handlers
const handleSecurityErrors = (app) => {
  // Handle payload too large
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") {
      return next(new AppError("Payload too large", 413, "PAYLOAD_TOO_LARGE"));
    }
    next(err);
  });

  // Handle malformed JSON
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      return next(new AppError("Invalid JSON format", 400, "INVALID_JSON"));
    }
    next(err);
  });
};

// Request timeout handler
const requestTimeout = (timeout = 30000) => {
  return (req, res, next) => {
    req.setTimeout(timeout, () => {
      const err = new AppError("Request timeout", 408, "REQUEST_TIMEOUT");
      next(err);
    });
    next();
  };
};

// Health check endpoint with error monitoring
const healthCheck = (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: "OK",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    memory: process.memoryUsage(),
  };

  try {
    res.status(200).json(healthcheck);
  } catch (error) {
    healthcheck.message = error.message;
    res.status(503).json(healthcheck);
  }
};

module.exports = {
  AppError,
  asyncHandler,
  globalErrorHandler,
  notFoundHandler,
  validateRequest,
  createRateLimit,
  handleDBConnection,
  handleSecurityErrors,
  requestTimeout,
  healthCheck,
};
