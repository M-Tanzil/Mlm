// Sends email/SMS. job.data = { notificationId }. attempt() records SENT/FAILED on the notifications row.
// A thrown error makes BullMQ retry (3 attempts, exponential backoff, see queues.js); a permanent one (missing configuration) is not retried.
import { UnrecoverableError } from 'bullmq';
import { attempt } from '../modules/notification/notification.service.js';

export async function processNotification(job) {
  try {
    await attempt(Number(job.data.notificationId));
  } catch (e) {
    if (e.permanent) throw new UnrecoverableError(e.message);
    throw e;
  }
}
