// Sends email/SMS. job.data = { notificationId } -> read row from notifications, send, set SENT/FAILED.
export async function processNotification(job) {
  console.log('notification job', job.data);
  // TODO: SMTP (SES/SendGrid) + SMS gateway
}
