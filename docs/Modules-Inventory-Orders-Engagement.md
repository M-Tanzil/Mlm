# Inventory, Depo, Orders, Schemes, Notifications, Support, Announcements

Reference for the seven modules built on the `akash` branch. All lists answer `{ rows, total, page, limit }`; all errors answer `{ error, details? }` (`details` holds per-field messages for validation errors). All routes need a bearer token; the role needed is listed per section. Ids in URLs that are not positive integers return 400.

## Core rules that hold everywhere

- **Stock is a ledger.** `stock_ledger(location_id, product_id, qty_change, txn_type, ref_type, ref_id)`. A balance is the sum of `qty_change`; nothing stores a balance. Every stock movement is written inside a database transaction.
- **No negative stock, no double spend.** Every operation that removes stock first takes an advisory lock on the location (`pg_advisory_xact_lock`) and re-checks the balance inside the transaction. Rows being changed (orders, transfers, requests, returns) are locked with `SELECT … FOR UPDATE`, so two people acting at once get one winner and one clear error.
- **The server decides prices and quantities.** Prices, GST and BV come from the product master at the moment of ordering; anything the browser sends for them is ignored.
- **Document numbers** (`PO…`, `GRN…`, `SRT…`, `TRF…`, `ORD…`) come from the `sequences` table and are never reused.
- **Pagination everywhere:** `page` (default 1) and `limit` (default 20, max 100).

## Inventory — `/api/inventory` (SUPER_ADMIN, ADMIN) — UI `/admin/inventory/*`

| Area | Endpoints | Rules |
|---|---|---|
| Masters | `categories`, `products`, `suppliers`, `couriers` — `GET /`, `POST /`, `PUT /:id` | Deactivate instead of delete. Product image: `PUT/DELETE /products/:id/image` (PNG/JPG/WebP, ≤ 2 MB). Courier `tracking_url_template` may contain `{tracking_no}`. |
| Purchase orders | `purchase-orders` — list, `GET /:id`, `POST /`, `PUT /:id/cancel` | A PO is open until fully received. |
| Stock inward (goods received) | `POST /stock-inward`, `GET /stock-inward` | Optional PO link. Per line: accepted `qty` enters stock; `rejected_qty` does not and keeps the PO open. A supplier invoice number can only be received once per supplier. |
| Stock returns to supplier | `POST /stock-returns`, `GET /stock-returns` | Blocked if it would make stock negative. |
| Transfers | `stock-transfers` — `POST /`, `GET /`, `GET /:id`, `PUT /:id/accept`, `PUT /:id/reject` | Stock leaves the source on send. The destination accepts (any quantity from 0 to what was sent; the rest returns to the source) or rejects (all returns). |
| Reports | `GET /stock-report`, `GET /stock-movements`, `GET /locations` | Low-stock threshold is global (10). |

## Depo & franchise — `/api/inventory/depos`, `/api/inventory/pcr` (admin) and `/api/depo/*` (DEPO, FRANCHISE)

- Admin manages depo/franchise locations and their login (`/api/inventory/depos`). A location belongs to one login (`owner_user_id`); everything under `/api/depo` is scoped to that location, so a depo can never see another depo's stock, transfers or orders.
- **Depo panel (`/depo`):** `GET /me`, `/products`, `/stock`; incoming transfers `GET /transfers`, `PUT /transfers/:id/accept|reject`; stock requests to head office `GET|POST /pcr`; orders `GET /orders`, `GET /orders/:id`, `PUT /orders/:id/pay|dispatch|deliver`; `GET /couriers`. A depo cannot cancel orders.
- **Stock requests (PCR):** the depo asks for products; admin `PUT /api/inventory/pcr/:id/approve` creates the transfer to the depo in one transaction (it can only succeed when head office has the stock), or `…/reject`.

## Orders & dispatch — `/api/orders` (admin) and `/api/orders/my` (DISTRIBUTOR) — UI `/admin/orders`, `/depo/orders`

Lifecycle: `PLACED` → pay → `CONFIRMED` (payment `PAID`, **stock leaves now**) → dispatch → `DISPATCHED` → deliver → `DELIVERED`. `PLACED` or `CONFIRMED` can be cancelled by an admin: a paid cancel puts the stock back and marks payment `REFUND_DUE`; a dispatched or delivered order cannot be cancelled.

- Placing an order checks stock but does **not** reserve it. Two orders for the last unit can both be placed; only the first can be paid, and the second stays `PLACED` with a clear message.
- `GET /api/orders` filters: `q`, `status`, `payment_status` (PENDING / PAID / REFUND_DUE), `location_id`. Each row also shows courier, tracking number, dispatched and delivered times (the dispatch history).
- Dispatch accepts an optional active courier and a tracking number (≤ 100 chars). The detail response includes a `tracking_url` built from the courier's template, only for `http(s)` templates.
- Distributor shop: `GET /my/locations`, `/my/products?location_id=` (with availability), `POST /my/orders`, `GET /my/orders`, `GET /my/orders/:id`, `PUT /my/orders/:id/cancel` (unpaid only).

## Joining packages — `/api/orders/joining-deliveries`, `/api/orders/package-returns` (admin) — UI `/admin/joining-packages`

- **Integration point with the member module:** call `createJoiningDelivery({ member_id, package_id })` from `order/joining.routes.js`, or emit `MEMBER_JOINED { memberId, packageId }`. It is idempotent: one delivery per member and package.
- Dispatch deducts the package's products from the chosen location in one transaction (fails cleanly if stock is short). Deliver is blocked while a return is open or confirmed.
- Returns: one live return per delivery (a second would put the stock back twice). Confirming a return restores the stock at the dispatch location; rejecting does not move stock.

## Schemes, offers & achievements — `/api/schemes` — UI `/admin/schemes`, `/distributor/achievements`

- A scheme is the offer **and** the achievement definition: eligibility = `target_type` (`BV`, `REPURCHASE`, `DIRECTS`, `NEW_JOINING`) + `target_value`, within `start_date`–`end_date`; `reward` is free text; `active` switches it on/off. Computed `phase`: RUNNING / UPCOMING / ENDED / INACTIVE.
- Progress is recomputed on create/edit, when an order is paid or cancelled, when a member joins, and on `POST /:id/recalculate`. Recalculation of one scheme is serialised, and a member is notified of a new qualification once. A qualified member stays qualified.
- Admin: `GET /`, `POST /`, `PUT /:id`, `GET /:id/qualifiers`, `POST /:id/recalculate`. Distributor: `GET /my` (running and upcoming schemes plus ended ones they won, with their progress).

## Notifications — `/api/notifications` — UI `/admin/notifications`

- `sendNotification(userId, template, data)` writes one row per channel (`INAPP`, `EMAIL`, `SMS`) and delivers it. Templates are defined in `notification.service.js` (`WELCOME`, `ORDER_DISPATCHED`, `ORDER_DELIVERED`, `SCHEME_QUALIFIED`, `TICKET_REPLY`, `TICKET_RESOLVED`).
- Status: `QUEUED` → `SENDING` → `SENT` or `FAILED` (with the reason in `error`). A row can only be claimed once, so duplicates never double-send. With `USE_QUEUE=true` failures are retried 3 times with backoff; configuration errors and gateway 4xx are not retried. Network calls time out (SMS 10 s).
- Admin: `GET /` (filters: `status`, `channel`, `template`, `q`), `GET /stats`, `GET /templates`, `PUT /:id/resend`. Any user: `GET /mine` (own in-app messages).

## Support tickets — `/api/support` — UI `/admin/support`, `/distributor/support`

- Statuses `OPEN` → `IN_PROGRESS` (first admin reply) → `RESOLVED` → `CLOSED`; priority `LOW|NORMAL|HIGH`; category from `CATEGORIES` in `support.routes.js`.
- Member (`/my/tickets`): create, list, read, reply. Replying to a `RESOLVED` ticket reopens it and clears the resolution; a `CLOSED` ticket accepts no replies.
- Admin: `GET /tickets` (filters: `status`, `priority`, `category`, `assigned=me|none|<user id>`, `q`), `GET /tickets/:id`, `POST /tickets/:id/reply`, `PUT /tickets/:id` (status, priority, category, `assigned_to`, `resolution`), `GET /staff`, `GET /stats`. A ticket can only be assigned to an active admin user.

## Announcements — `/api/announcements` — UI `/admin/announcements`, `/distributor/news`, `/depo/news`

- Fields: type (`NEWS|EVENT|ACHIEVER|GALLERY`), title, body, media link (`https://…` or `/uploads/…`), event date, audience (`ALL|DISTRIBUTOR|DEPO`), optional `starts_at` / `expires_at`, `published`.
- A reader sees an announcement only if it is published, inside its window and meant for their role. Computed `visibility`: LIVE / SCHEDULED / EXPIRED / DRAFT.
- Admin: `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`. Any user: `GET /published`.
