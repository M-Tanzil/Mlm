// Run as a separate process: npm run worker
import { Worker } from 'bullmq';
import { redis } from '../core/redis.js';
import { bonusQueue } from './queues.js';
import { processBonus } from './bonus.job.js';
import { processNotification } from './notification.job.js';
import { processPayout } from './payout.job.js';

new Worker('bonus', processBonus, { connection: redis });
new Worker('notification', processNotification, { connection: redis });
new Worker('payout', processPayout, { connection: redis });

// Scheduled periodic bonuses (weekly cutoff: Sunday 23:59). Adjust once the plan is final.
await bonusQueue.add('cutoff', { frequency: 'WEEKLY' }, { repeat: { pattern: '59 23 * * 0' }, jobId: 'weekly-cutoff' });

console.log('Workers running');
