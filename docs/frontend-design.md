# Frontend design reference

Design canvas (4 artboards, sample data only): https://claude.ai/artifact/JYFAuEAAsvExZBzudXwtuZ ("MLM Management System: Design Mockups"). These are static mockups; buttons and the tree do not respond yet.

Stack: React + Vite + Tailwind CSS v4 + React Router + Redux Toolkit; trees via react-d3-tree/D3 or the nested CSS tree below.

## Visual style
- Light dashboard: dark sidebar, light gray page, white cards. One indigo accent. Green / amber / red for status only.
- Font: Inter (400, 500, 600, 700).
- Tables are the main element; invest in a reusable DataTable, form and modal first (the shared UI kit).

| Token | Value | Use |
|---|---|---|
| Page background | #f4f5f9 (Tailwind slate-50 is close) | main area |
| Card | #ffffff, border #e5e7eb, radius 14px | panels, tables |
| Sidebar | #111827 (gray-900), text #d1d5db / #e5e7eb, section labels #9ca3af | nav |
| Accent | #4f46e5 (indigo-600); light fill #eef2ff; dark text #312e81 | buttons, active nav, selected |
| Text | #111827; muted #5b6472 | body / secondary |
| Status pills | Approved: #dcfce7 bg, #166534 text. Pending: #fef3c7 bg, #92400e text. Rejected: #fee2e2 bg, #991b1b text | KYC, orders |
| Positive / warning figure | #15803d / #b45309 | deltas |
| Right-leg bar (secondary) | #0f766e (teal) | binary right leg |

Rules: touch targets at least 44px; text contrast 4.5:1 (use #5b6472 for muted, not lighter); real `<button>`, `<a>`, `<label>` + `<input>`; icon-only buttons need `aria-label`; no emoji.

## Screens in the mockup
1. **Admin dashboard (1440 wide, fluid page).** Sidebar 240px: company logo + name on top (Super Admin sees "Change logo"), then groups MEMBERS (View members, KYC confirmation, E-Pin), OPERATIONS (Inventory, Depo and franchise, Orders and dispatch), MONEY (Payout and TDS, Schemes and offers), SYSTEM (Masters, Support tickets). Main: title + search + user chip; 4 KPI cards (Total members, Business volume month, Pending KYC, Payout this cycle); "Recent joinings" table (Member, Sponsor, Package, KYC pill, Joined); right column: "Payout cycle" progress card (Calculated -> Approved -> Paid, "Review and approve" button) and "Needs attention" list (E-Pin requests, joining packages to dispatch, stock transfers awaiting acceptance, open tickets). At phone width the sidebar stacks and the table scrolls horizontally.
2. **Distributor home (phone 390x844).** Indigo header (welcome, member name, ID + package); 2x2 number cards (Downline, My payout, E-Pins received, Month business); Binary volume card with Left/Right bars; Recent joining list; bottom nav (Home, Network, Orders, Income, More).
3. **Joining form (phone).** 4-step stepper (Sponsor, Details, Package, Confirm) shown on step 3: radio cards for packages (Starter, Premium, Elite; price and BV are placeholders), E-Pin field with validity message, Left/Right placement buttons, Back / Continue footer.
4. **Binary tree (1440 wide page).** Header with member-ID search, "Levels: 3", zoom -/+. Tree card: root "Your account" (indigo border) with L/R BV, 3 levels, member cards (name, ID, package pill, L/R BV), dashed "+ Add member" for empty slots, CSS connector lines (nested ul/li). Right side panel for the selected member: ID, package, leg, sponsor, joined, KYC pill, L/R BV, "View downline".

## Shared layout (code)
- All panels use `client/src/layouts/PanelLayout.jsx` (dark sidebar + content). Admin, Distributor and Depo/Franchise differ only by `title` and `links`.
- Phone-first for the Distributor panel (bottom nav on phones), desktop-first for Admin and Depo.

## Still to design
Stock transfer, payout statement, E-Pin screens, KYC review, product/purchase order forms, login page, Master screens, support tickets. Ask Claude to add them to the canvas.
