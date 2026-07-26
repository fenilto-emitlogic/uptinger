import './env.js';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import apiRoutes from './routes/api/index.js';
import screenRoutes from './routes/screen/index.js';
import { checkSetupMiddleware } from './middlewares/setup.middleware.js';
import { uptinger } from './config/uptinger.js';
import { hasPermission } from './config/permissions.js';
import { jsonScript } from './utils/res.utils.js';

const app = express();
const PORT = process.env.PORT || 4000;

// Setup EJS View Engine
app.set('view engine', 'ejs');
app.set('views', path.resolve('src/views'));

// app.locals are available as bare identifiers in every EJS render — this is how
// views share the same hasPermission() used by requirePermission() server-side,
// instead of each partial redefining its own (which broke include() scoping).
app.locals.hasPermission = hasPermission;
app.locals.jsonScript = jsonScript;

// Core Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.resolve('public')));

// Global Setup Verification Middleware
app.use(checkSetupMiddleware);
// Connect all separate routes mounted via single routes index
app.use('/api', apiRoutes);
app.use('/', screenRoutes);

app.listen(PORT, () => {
    console.log(`⚡ Server running at http://localhost:${PORT}`);
    uptinger.start();
});

export default app;
