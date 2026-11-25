// Tiny in-process event bus. Emitters: orders (ORDER_PAID), members (MEMBER_JOINED).
// Subscribers (e.g. the bonus engine) do: events.on('ORDER_PAID', ({ orderId }) => { ... })
import { EventEmitter } from 'node:events';

export const events = new EventEmitter();
events.on('error', (e) => console.error('[events]', e));
