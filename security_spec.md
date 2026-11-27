# Security Specification - Domestiq Hub System

## 1. Data Invariants
1. **Verified Internal Identity**: Every write requires `request.auth != null && request.auth.token.email_verified == true` and an active user document at `/users/{request.auth.uid}` (or bootstrapped Direktur email `fakhrariefal@domestiqhub.com`).
2. **No Self-Role Escalation**: A newly registered user creating their own `/users/{uid}` document can only initialize with `role == 'Viewer'` unless they match the bootstrapped Direktur email (`fakhrariefal@domestiqhub.com` with `email_verified == true`). Only `Direktur` can modify `role` or `active` fields.
3. **Strict Role Separation**:
   - `Purchasing` / `Manager` / `Direktur` manage suppliers and POs; only `Manager` or `Direktur` can approve a PO (`Submitted -> Approved by Manager`).
   - `Warehouse` / `Manager` / `Direktur` record stock movements (Goods Receipt, Goods Issue, Transfer, Stock Opname) and adjust `warehouseStocks`.
   - `Sales` / `Manager` / `Direktur` manage customers and Sales Orders.
   - `Finance` / `Manager` / `Direktur` manage AP/AR invoices and payments.
   - `Viewer` has strictly read-only access to operational documents and cannot read private user PII of other staff.
   - `Angel Investor` has strictly read-only access limited to the Executive Dashboard UI and cannot mutate any business record or read private user PII of other staff.
4. **Immutable Ledgers & Temporal Integrity**: `stockMovements`, `auditLogs`, `purchaseOrders/{poId}/logs`, and `invoices/{invoiceId}/payments` are append-only (no client `update` or `delete`). `createdAt` and `createdBy` fields are immutable on update.
5. **Terminal State Protection**: `PurchaseOrder` in `Closed` or `Cancelled` status and `SalesOrder` in `Closed` status cannot be mutated by non-Direktur roles.
6. **Size & Type Bounds**: Every document ID matches `^[a-zA-Z0-9_-]+$` (`<= 128` chars), every string enforces `.size()`, and arrays (`items`, `attachmentUrls`, `targetRoles`, `readBy`) are strictly bounded.

## 2. The "Dirty Dozen" Malicious Payloads (Must Return PERMISSION_DENIED)
1. **Self-Role Escalation on Registration**: Viewer creates `/users/{uid}` with `role: "Direktur"`.
2. **Unverified Email Spoof**: Request with `email: "fakhrariefal@domestiqhub.com"` and `email_verified: false` tries to write `/settings/company`.
3. **Shadow Ghost Field Injection**: Purchasing creates `/suppliers/sup_99` including an undeclared field `isVerified: true`.
4. **Viewer Write Attempt**: User with `role: "Viewer"` attempts to create or update `/products/prod_1`.
5. **Purchasing Approving Own PO**: User with `role: "Purchasing"` attempts to update PO status from `Submitted` directly to `Approved by Manager`.
6. **Terminal State Bypass**: Purchasing updates a `Closed` PO's `totalAmount`.
7. **Immutable Audit Log Tampering**: Non-admin user attempts `update` or `delete` on `/auditLogs/log_1`.
8. **Immutable Stock Movement Deletion**: Warehouse user attempts `delete` on `/stockMovements/mov_1`.
9. **Identity Spoofing on Create**: User creates `/purchaseOrders/po_99` with `createdBy: "another_user_uid"`.
10. **ID Poisoning**: Attacker writes `/products/../../../etc/passwd` or 500-char ID.
11. **PII Blanket Read**: Viewer attempts `get` on `/users/other_uid` containing another employee's email.
12. **Oversized Payload / Unbounded Array**: Attacker submits `/purchaseOrders/po_1` with `notes` > 600 chars or > 50 items.
