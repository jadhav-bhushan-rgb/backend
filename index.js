const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const http = require('http');
const websocketService = require('./services/websocketService');
require('dotenv').config();

// Routes will be imported after mongoose connection

const app = express();
const PORT = process.env.PORT || 5000;

// Increase timeout for large file uploads
app.timeout = 300000; // 5 minutes
app.keepAliveTimeout = 300000; // 5 minutes
app.headersTimeout = 300000; // 5 minutes

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Ensure inquiries subdirectory exists
const inquiriesDir = path.join(uploadsDir, 'inquiries');
if (!fs.existsSync(inquiriesDir)) {
  fs.mkdirSync(inquiriesDir, { recursive: true });
}

// Ensure quotations subdirectory exists
const quotationsDir = path.join(uploadsDir, 'quotations');
if (!fs.existsSync(quotationsDir)) {
  fs.mkdirSync(quotationsDir, { recursive: true });
}

// Security middleware with CSP configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));


// CORS configuration for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000', // Development
      'http://localhost:3001', // Alternative development port
      'http://127.0.0.1:3000', // Alternative localhost
      'http://127.0.0.1:3001', // Alternative localhost port
      'https://komacut-frontend.onrender.com', // Production frontend
      'https://comcat-frontend.onrender.com', // Alternative frontend URL
      'https://comcat-frontends.onrender.com', // Your actual frontend URL
      process.env.CLIENT_URL, // From environment variable
    ].filter(Boolean); // Remove undefined values
    
    // Check if origin matches any allowed origin
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else if (origin.includes('.onrender.com') || origin.includes('.netlify.app') || origin.includes('.vercel.app')) {
      // Allow all Render, Netlify, and Vercel subdomains
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// Use more permissive CORS in development
if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }));
} else {
  app.use(cors(corsOptions));
}
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// IMPORTANT: Handle quotation PDFs BEFORE static middleware
// This ensures PDF regeneration works even if file doesn't exist
// We'll register the actual handlers after mongoose connection, but we need to intercept here
let quotationPDFHandler = null;

// Middleware to intercept quotation PDF requests before static middleware
const quotationPDFInterceptor = (req, res, next) => {
  const path = req.path;
  // Check if this is a quotation PDF request
  if (path.startsWith('/quotations/') || path.match(/^\/quotations\/[^\/]+\.pdf$/)) {
    const filename = path.replace('/quotations/', '');
    if (quotationPDFHandler) {
      req.params = req.params || {};
      req.params.filename = filename;
      return quotationPDFHandler(req, res);
    }
    // If handler not ready yet (mongoose not connected), wait a bit
    const checkHandler = setInterval(() => {
      if (quotationPDFHandler) {
        clearInterval(checkHandler);
        req.params = req.params || {};
        req.params.filename = filename;
        quotationPDFHandler(req, res);
      }
    }, 100);
    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkHandler);
      if (!res.headersSent) {
        res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
      }
    }, 5000);
    return; // Don't call next()
  }
  next(); // Not a quotation PDF, continue to next middleware
};

app.use('/uploads', quotationPDFInterceptor);
app.use('/api/uploads', quotationPDFInterceptor);

// File upload middleware - Serve static files from uploads directory
// Handle both /uploads and /api/uploads paths for compatibility
// But exclude /uploads/quotations/ which is handled above
app.use('/uploads', (req, res, next) => {
  // Skip quotations path - it's handled by explicit routes above
  if (req.path.startsWith('/quotations/')) {
    return next();
  }
  express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    // Set proper CORS headers for file access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Set Content-Type based on file extension
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (filePath.endsWith('.zip')) {
      res.setHeader('Content-Type', 'application/zip');
    }
  }
})(req, res, next);
});

// Also serve via /api/uploads for API consistency
// But exclude /api/uploads/quotations/ which is handled above
app.use('/api/uploads', (req, res, next) => {
  // Skip quotations path - it's handled by explicit routes above
  if (req.path.startsWith('/quotations/')) {
    return next();
  }
  express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    // Set proper CORS headers for file access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Set Content-Type based on file extension
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (filePath.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (filePath.endsWith('.zip')) {
      res.setHeader('Content-Type', 'application/zip');
    }
  }
})(req, res, next);
});

app.use('/test-files', express.static(path.join(__dirname, 'test-files')));

// Routes will be loaded after mongoose connection

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Cutbend Server is running' });
});

// Test endpoint for debugging
app.get('/api/test', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Test endpoint working',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Serve test HTML file
app.get('/test-inquiry', (req, res) => {
  res.sendFile(path.join(__dirname, 'test-inquiry.html'));
});

// Serve role change tool
app.get('/change-role', (req, res) => {
  res.sendFile(path.join(__dirname, 'change-role.html'));
});

// Serve role change JavaScript file
app.get('/change-role.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'change-role.js'));
});

// Serve test files download page
app.get('/download-test-files', (req, res) => {
  res.sendFile(path.join(__dirname, 'download-test-files.html'));
});

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://damsole:Damsole@cluster0.mwqeffk.mongodb.net/komacut?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI, {
  // Modern MongoDB driver options
  serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
})
.then(() => {
  
  // Import models first
  require('./models/User');
  require('./models/Inquiry');
  require('./models/Quotation');
  require('./models/Order');
  require('./models/Notification');
  
  // Import routes after mongoose connection
  const authRoutes = require('./routes/auth');
  const inquiryRoutes = require('./routes/inquiry');
  const quotationRoutes = require('./routes/quotation');
  const orderRoutes = require('./routes/order');
  const paymentRoutes = require('./routes/payment');
  const dispatchRoutes = require('./routes/dispatch');
  const notificationRoutes = require('./routes/notifications');
  const contactRoutes = require('./routes/contact');
  const adminRoutes = require('./routes/admin');
  const pdfExtractRoutes = require('./routes/pdfExtract');
  const zipExtractRoutes = require('./routes/zipExtract');
  const dashboardRoutes = require('./routes/dashboard');
  const analyticsRoutes = require('./routes/analytics');
  
  // Use routes
  app.use('/api/auth', authRoutes);
  app.use('/api/inquiry', inquiryRoutes);
  app.use('/api/quotation', quotationRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/payment', paymentRoutes);
  app.use('/api/dispatch', dispatchRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/contact', contactRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/inquiry', pdfExtractRoutes);
  app.use('/api/inquiry', zipExtractRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/analytics', analyticsRoutes);
  
  // Helper function for PDF regeneration (shared by both routes)
  const handleQuotationPDF = async (filename, res, req) => {
    const filePath = path.join(__dirname, 'uploads', 'quotations', filename);
    
    // Check if download is requested via query parameter
    const shouldDownload = req.query.download === 'true' || req.query.download === '1';
    const disposition = shouldDownload ? 'attachment' : 'inline';
    
    console.log('PDF request:', {
      filename: filename,
      filePath: filePath,
      exists: fs.existsSync(filePath),
      shouldDownload: shouldDownload,
      disposition: disposition
    });
    
    // Check if file exists
    if (fs.existsSync(filePath)) {
      // File exists, serve it directly
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
      
      console.log('Sending existing PDF file:', filename);
      return res.sendFile(filePath, (err) => {
        if (err) {
          console.error('Error sending PDF file:', err);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              message: 'Error sending PDF file',
              error: err.message
            });
          }
        } else {
          console.log('PDF file sent successfully:', filename);
        }
      });
    }
    
    // File doesn't exist - try to regenerate from database
    console.log('PDF file not found, attempting to regenerate from database...');
    
    try {
      // Import models using mongoose.model to get registered models
      const Quotation = mongoose.model('Quotation');
      const Inquiry = mongoose.model('Inquiry');
      const pdfService = require('./services/pdfService');
      
      // Find quotation by PDF filename (try exact match first)
      let quotation = await Quotation.findOne({ quotationPdf: filename });
      
      // If exact match fails, try partial match (in case filename format slightly differs)
      if (!quotation) {
        console.log('Exact match failed, trying partial match for:', filename);
        // Try to find quotations where quotationPdf contains the filename or vice versa
        quotation = await Quotation.findOne({ 
          quotationPdf: { $regex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } 
        });
      }
      
      // If still not found, try finding by inquiry number from filename (format: quotation_INQXXX_TIMESTAMP.pdf)
      if (!quotation) {
        console.log('Partial match failed, trying inquiry number-based search');
        // Extract inquiry number from filename (format: quotation_INQUIRYNUMBER_TIMESTAMP.pdf)
        const inquiryMatch = filename.match(/quotation_(INQ\d+)_(\d+)\.pdf/);
        if (inquiryMatch) {
          const inquiryNumber = inquiryMatch[1]; // e.g., INQ251031789
          console.log('Extracted inquiry number from filename:', inquiryNumber);
          // Find inquiry by inquiryNumber
          const foundInquiry = await Inquiry.findOne({ inquiryNumber: inquiryNumber });
          if (foundInquiry) {
            console.log('Found inquiry by number:', foundInquiry._id);
            // Find quotation by inquiryId
            quotation = await Quotation.findOne({ inquiryId: foundInquiry._id.toString() });
            if (quotation) {
              console.log('Found quotation by inquiry ID:', quotation._id, 'PDF filename in DB:', quotation.quotationPdf);
            } else {
              // Try with inquiryNumber as string
              quotation = await Quotation.findOne({ inquiryId: inquiryNumber });
              if (quotation) {
                console.log('Found quotation by inquiry number string:', quotation._id);
              }
            }
          }
        }
      }
      
      // If still not found, try finding by extracting timestamp from filename (format: quotation-TIMESTAMP-RANDOM.pdf)
      if (!quotation) {
        console.log('Inquiry number search failed, trying timestamp-based search');
        // Extract timestamp from filename (format: quotation-TIMESTAMP-RANDOM.pdf)
        const timestampMatch = filename.match(/quotation-(\d+)-/);
        if (timestampMatch) {
          const timestamp = parseInt(timestampMatch[1]);
          // Find quotations created around that time (within 5 seconds)
          const timeRange = {
            $gte: new Date(timestamp - 5000),
            $lte: new Date(timestamp + 5000)
          };
          quotation = await Quotation.findOne({ createdAt: timeRange }).sort({ createdAt: -1 });
          if (quotation) {
            console.log('Found quotation by timestamp:', quotation._id, 'PDF filename in DB:', quotation.quotationPdf);
          }
        }
      }
      
      // If still not found, try extracting timestamp from generated format (quotation_INQXXX_TIMESTAMP.pdf)
      if (!quotation) {
        console.log('Timestamp search failed, trying generated format timestamp');
        const generatedTimestampMatch = filename.match(/quotation_[^_]+_(\d+)\.pdf/);
        if (generatedTimestampMatch) {
          const timestamp = parseInt(generatedTimestampMatch[1]);
          console.log('Extracted timestamp from generated format:', timestamp);
          const timeRange = {
            $gte: new Date(timestamp - 10000), // 10 seconds window
            $lte: new Date(timestamp + 10000)
          };
          quotation = await Quotation.findOne({ createdAt: timeRange }).sort({ createdAt: -1 });
          if (quotation) {
            console.log('Found quotation by generated format timestamp:', quotation._id, 'PDF filename in DB:', quotation.quotationPdf);
          }
        }
      }
      
      if (!quotation) {
        console.error('Quotation not found for PDF:', filename);
        console.error('Attempted: exact match, partial match, timestamp-based search');
        return res.status(404).json({
          success: false,
          message: 'Quotation PDF not found and cannot be regenerated',
          filename: filename
        });
      }
      
      console.log('Found quotation:', quotation._id, 'inquiryId:', quotation.inquiryId);
      
      // Get inquiry data - inquiryId is stored as String, so use findById which handles both
      let inquiry;
      if (mongoose.Types.ObjectId.isValid(quotation.inquiryId)) {
        inquiry = await Inquiry.findById(quotation.inquiryId).populate('customer', 'firstName lastName companyName email phoneNumber');
      } else {
        // If not valid ObjectId, try to find by inquiryNumber
        inquiry = await Inquiry.findOne({ inquiryNumber: quotation.inquiryId }).populate('customer', 'firstName lastName companyName email phoneNumber');
      }
      
      if (!inquiry) {
        console.error('Inquiry not found for quotation:', quotation._id, 'inquiryId:', quotation.inquiryId);
        return res.status(404).json({
          success: false,
          message: 'Inquiry not found for quotation',
          quotationId: quotation._id,
          inquiryId: quotation.inquiryId
        });
      }
      
      console.log('Found inquiry:', inquiry._id, inquiry.inquiryNumber);
      
      // Prepare quotation data for PDF generation
      const pdfQuotationData = {
        parts: quotation.items && quotation.items.length > 0 
          ? quotation.items.map(item => ({
              partRef: item.partRef || '',
              material: item.material || 'Zintec',
              thickness: item.thickness || '1.5',
              quantity: item.quantity || 1,
              price: item.unitPrice || 0,
              remarks: item.remark || ''
            }))
          : (inquiry.parts || []).map(part => ({
              partRef: part.partRef || '',
              material: part.material || 'Zintec',
              thickness: part.thickness || '1.5',
              quantity: part.quantity || 1,
              price: 0,
              remarks: part.remarks || ''
            })),
        totalAmount: quotation.totalAmount,
        currency: 'USD',
        validUntil: quotation.validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        terms: quotation.terms || 'Standard manufacturing terms apply. Payment required before production begins.'
      };
      
      console.log('Prepared PDF data, parts count:', pdfQuotationData.parts.length);
      
      // Generate PDF
      console.log('Regenerating PDF from quotation data...');
      const pdfResult = await pdfService.generateQuotationPDF(inquiry, pdfQuotationData);
      console.log('PDF regenerated successfully:', pdfResult.fileName, 'Path:', pdfResult.filePath);
      
      // Verify file was created
      if (!fs.existsSync(pdfResult.filePath)) {
        console.error('Generated PDF file not found at:', pdfResult.filePath);
        return res.status(500).json({
          success: false,
          message: 'PDF generation failed - file not created',
          path: pdfResult.filePath
        });
      }
      
      // Update quotation with new filename if different
      if (pdfResult.fileName !== filename) {
        quotation.quotationPdf = pdfResult.fileName;
        await quotation.save();
      }
      
      // Set headers and send the regenerated file
      // Check if download is requested via query parameter
      const shouldDownload = req.query.download === 'true' || req.query.download === '1';
      const disposition = shouldDownload ? 'attachment' : 'inline';
      
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="${pdfResult.fileName}"`);
      
      console.log('Sending regenerated PDF file:', pdfResult.fileName);
      res.sendFile(pdfResult.filePath, (err) => {
        if (err) {
          console.error('Error sending regenerated PDF file:', err);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              message: 'Error sending regenerated PDF file',
              error: err.message
            });
          }
        } else {
          console.log('Regenerated PDF file sent successfully:', pdfResult.fileName);
        }
      });
      
    } catch (regenerateError) {
      console.error('Error regenerating PDF:', regenerateError);
      console.error('Stack:', regenerateError.stack);
      return res.status(500).json({
        success: false,
        message: 'Error regenerating PDF',
        error: regenerateError.message,
        stack: process.env.NODE_ENV === 'development' ? regenerateError.stack : undefined
      });
    }
  };

  // Register the quotation PDF handler (called by middleware registered above)
  quotationPDFHandler = async (req, res) => {
    try {
      const filename = req.params.filename;
      await handleQuotationPDF(filename, res, req);
    } catch (error) {
      console.error('PDF route error:', error);
      console.error('Stack:', error.stack);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Server error',
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    }
  };
  
  // Error handling middleware (must be last)
  const errorHandler = require('./middleware/errorHandler');
  app.use(errorHandler);
  
  // Create HTTP server
  const server = http.createServer(app);
  
  // Initialize WebSocket service
  websocketService.initialize(server);
  
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server running on /ws`);
    console.log(`Uploads directory: ${uploadsDir}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`MongoDB URI: ${MONGODB_URI}`);
  });
})
.catch((error) => {
  console.error('MongoDB connection error:', error);
 
  // Exit process if MongoDB connection fails
  process.exit(1);
});
