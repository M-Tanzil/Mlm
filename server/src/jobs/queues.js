import { Queue } from 'bullmq';
import { redis } from '../core/redis.js';

const opts = { connection: redis, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } } };

export const bonusQueue = new Queue('bonus', opts);
export const notificationQueue = new Queue('notification', opts);
export const payoutQueue = new Queue('payout', opts);
