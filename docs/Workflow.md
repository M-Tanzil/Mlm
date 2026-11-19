# Complete Workflow: Direct-Selling Management System

Management system only (Distributor, Admin, Depo/Franchise panels). Stack: React, Node/Express, PostgreSQL, Redis/BullMQ.

---

## 1. End-to-End Business Flow (overview)

```
Admin setup ─▶ Stock setup ─▶ E-Pin / Joining ─▶ KYC ─▶ Package delivery
      ─▶ Network growth ─▶ Orders & repurchase ─▶ Bonus calculation
      ─▶ Payout (TDS) ─▶ Bank transfer ─▶ Reports, schemes, support
```

---

## 2. Phase-by-Phase Workflow

### Phase 1: System Setup (Super Admin)
1. Login as Super Admin.
2. Fill **Company Info**, **Location Master** (state/city), **Role Master**, **User Master**.
3. Create **Packages** (price, BV, included products) in Package Master.
4. Configure **Bonus Plans** (12 bonuses: rates, caps, cutoffs).
5. Create sub-admins and assign role permissions.
6. Configure email templates, SMS templates and gateway.

### Phase 2: Inventory Setup (Admin)
1. Add **Product Category**, then **Products** (SKU, price, BV, GST).
2. Add **Suppliers** and **Courier and Transport** partners.
3. Create **Purchase Order** to supplier.
4. **Stock Inward** (PO-wise or supplier-wise) -> warehouse stock increases.
5. **Stock Return** to supplier if damaged or wrong.
6. **Stock Report** to monitor levels.
7. **Stock Transfer** warehouse -> Depo/Franchise.
8. Depo/Franchise does **Stock Acceptance** -> their stock increases.

### Phase 3: E-Pin Management
1. Admin **creates E-Pin voucher** (linked to a package).
2. **Generate** E-Pins in bulk.
3. **Issue** E-Pins to a distributor or franchise (against request).
4. Distributor raises **E-Pin Request** -> admin approves -> **Received E-Pins** appear.
5. Admin can **Block** an E-Pin; **E-Pin Report/Stock** tracks status:
   `GENERATED -> ISSUED -> USED | BLOCKED`.

### Phase 4: Joining (Member Onboarding)
1. Prospect gets sponsor ID and an E-Pin (or pays for a package).
2. **Sign Up**: details, sponsor, placement (Left/Right), package.
3. System validates sponsor, placement slot and E-Pin.
4. Member created; E-Pin marked USED; node placed in binary tree and generation tree.
5. Joining **Order** created; **Welcome Letter** and **Receipt** generated.
6. **Email + SMS** sent to the new member and sponsor.
7. Events fired: `MEMBER_JOINED` -> First Order, Retail, First Track bonuses evaluated.

### Phase 5: KYC
1. Member uploads PAN, Aadhaar, bank proof (My Details).
2. Admin reviews in **Edit Member** -> confirms or rejects (with reason).
3. Member notified by email/SMS.
4. Rule: **payout is released only after KYC approval.**

### Phase 6: Joining Package Delivery (and Return)
1. Admin/Depo sees pending joining packages.
2. Package dispatched from the nearest depo -> stock deducted -> courier/tracking.
3. Admin marks **Package Delivery** done.
4. If returned: **Package Return Confirmation** -> stock reversed -> BV and bonuses reversed through compensating ledger entries (no deletions).

### Phase 7: Network Growth
1. Members sponsor new members; tree grows left/right.
2. Distributor views **Binary Tree**, **Generation Tree**, directs, downline details and counts.
3. Admin views state/city-wise counts, line of sponsor, joining reports.
4. Left/right business volume (BV) and carry-forward update on every joining or order.

### Phase 8: Product Ordering and Repurchase
1. Distributor opens **Product Ordering** -> places order (repurchase), selects depo/franchise.
2. Payment via wallet / E-Pin / online (to be confirmed).
3. Stock reserved at the depo/franchise; order status: `PLACED -> CONFIRMED -> DISPATCHED -> DELIVERED`.
4. **Order Dispatch** with courier and tracking number.
5. On `ORDER_PAID`: BV added up the tree -> Retail, Performance, Depo/Franchise commissions queued.
6. Email + SMS at each status change. Repurchase details visible in My Details.
7. **Make Resale** lets stock be sold again at depo level.

### Phase 9: Depo and Franchise Operations
1. **PCR** (purchase/credit request) raised to head office.
2. **Stock Inward** at depo from warehouse; **Stock Transfer** between depos.
3. **Stock Acceptance** confirms received quantity.
4. **Joining Package Delivery** to members from depo stock.
5. Franchise handles **repurchase + E-Pin** sales; depo/franchise commission calculated from their sales.

### Phase 10: Compensation Calculation
Real-time bonuses (on event):
- Retail Bonus, First Order Bonus, First Track Bonus, E-Voucher Points.

Periodic bonuses (scheduled cutoff: daily/weekly/monthly):
- Performance (binary matching with carry-forward), Leadership Development, Royalty, Travel, Vehicle and House Allowance (rank/target based), Depo and Franchise Commission.

Process:
1. Cutoff job runs bonus plugins -> writes **CommissionLedger** rows (immutable).
2. **Commission Calculation** results shown in admin for review.
3. Admin checks **Commission Details / Statement / Summary**.

### Phase 11: Payout
1. Admin approves the payout cycle.
2. **TDS** deducted (PAN-based rates) -> **TDS Details** generated.
3. KYC-approved members only; others held.
4. Generate **Bank Transfer Report** -> admin pays through bank.
5. Mark `PAID`; members see **My Commission**, TDS Details, Reconciliation Report.
6. Notification (email/SMS) on payout.

### Phase 12: Schemes, Offers and Achievements
1. Admin **creates Scheme and Offer** (target, period, reward) for periodic awards.
2. System tracks progress; **Offer Qualifier Details** list who qualified.
3. Distributor sees **Award Target** and **Award Achievement Details**.
4. Rank-based allowances (Travel, Vehicle, House) feed from achievements.

### Phase 13: Communication and Support
1. Distributor: **Compose Message**, **Refer Friend**, **Support Ticket**, **My Documents**.
2. Admin: **Help Desk**, tickets, message, SMS, email, notifications, document upload, FAQ.
3. In-app announcements: news, events, achievers, gallery shown on the dashboard.

---

## 3. Role-wise Daily Workflow

| Role | Typical day |
|---|---|
| Super Admin | Masters, plans, roles, payout approval, audit review |
| Admin | KYC review, joining/package delivery, E-Pin issue, inventory, tickets, reports |
| Depo / Franchise | Accept stock, dispatch orders, deliver packages, sell repurchase/E-Pin |
| Distributor | Check dashboard, sponsor, view tree, order products, track commission, raise tickets |

---

## 4. System Events and Automation

| Event | Triggers |
|---|---|
| `MEMBER_JOINED` | Tree placement, joining bonuses, welcome letter, email/SMS |
| `KYC_APPROVED/REJECTED` | Notification, payout eligibility |
| `ORDER_PAID` | BV update, bonus jobs, stock deduct, dispatch task |
| `STOCK_TRANSFERRED/ACCEPTED` | Stock ledger entries at both locations |
| `PACKAGE_RETURNED` | Stock, BV and bonus reversal |
| `CUTOFF_REACHED` | Periodic bonus run |
| `PAYOUT_PAID` | Statement, TDS record, notification |

All jobs run through BullMQ with retries and idempotency keys.

---

## 5. Development and Delivery Workflow

1. **Requirement and plan finalisation:** confirm bonus formulas, placement/spillover rules, payment flow.
2. **Design:** ER diagram, API list, wireframes for the three panels.
3. **Sprint 1, Foundation:** auth, RBAC, masters, packages, member + tree, E-Pin, joining.
4. **Sprint 2, Commerce:** inventory, depo/franchise, ordering, dispatch, repurchase.
5. **Sprint 3, Compensation:** bonus engine, ledger, payout, TDS, reconciliation, bank transfer report.
6. **Sprint 4, Engagement:** schemes/offers, achievements, email/SMS, tickets, announcements.
7. **Sprint 5, Hardening:** KYC, package return, audit log, security review, load test.
8. **UAT:** client tests on staging with sample plan data.
9. **Deployment:** production server, SSL, backups, monitoring.
10. **Handover, Support and AMC:** training, documentation, support SLA, annual maintenance.

---

## 6. Open Items to Confirm

- Exact formula, cap and cutoff for each of the 12 bonuses.
- Spillover/placement and binary matching rules.
- Payment modes for orders and joining.
- Payout frequency and TDS rate rules.
- Commercial terms, payment terms, support and AMC (listed in the table of contents, not seen in the photos).
