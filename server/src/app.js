import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './core/config.js';
import { errorHandler } from './middleware/error.js';
import { prisma } from './core/prisma.js';

import auth from './modules/auth/auth.routes.js';
import member from './modules/member/member.routes.js';
import network from './modules/network/network.routes.js';
import pkg from './modules/package/package.routes.js';
import epin from './modules/epin/epin.routes.js';
import kyc from './modules/kyc/kyc.routes.js';
import inventory from './modules/inventory/inventory.routes.js';
import depo from './modules/depo/depo.routes.js';
import order from './modules/order/order.routes.js';
import commission from './modules/commission/commission.routes.js';
import payout from './modules/payout/payout.routes.js';
import scheme from './modules/scheme/scheme.routes.js';
import notification from './modules/notification/notification.routes.js';
import announcement from './modules/announcement/announcement.routes.js';
import support from './modules/support/support.routes.js';
import company, { uploadsDir } from './modules/company/company.routes.js';

export const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'up' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});


app.use('/uploads', express.static(uploadsDir));
app.use('/api/company', company);
app.use('/api/auth', auth);
app.use('/api/members', member);
app.use('/api/network', network);
app.use('/api/packages', pkg);
app.use('/api/epins', epin);
app.use('/api/kyc', kyc);
app.use('/api/inventory', inventory);
app.use('/api/depo', depo);
app.use('/api/orders', order);
app.use('/api/commissions', commission);
app.use('/api/payouts', payout);
app.use('/api/schemes', scheme);
app.use('/api/notifications', notification);
app.use('/api/announcements', announcement);
app.use('/api/support', support);

app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
app.use(errorHandler);
