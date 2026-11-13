# Security Specification — Event Cinemas Lalbandi-7 Canteen KDS

## 1. Operational Context & Data Invariants
- **Zero-Login KDS & Customer Sender**: By explicit operational requirement, canteen staff scan a counter QR code with zero login barrier, and customers place orders from their seats without accounts.
- **Invariant 1 (Strict Schema & No Shadow Fields)**: Every document in `/orders/{orderId}` must contain only the declared fields (`orderCode`, `seat`, `hall`, `items`, `paymentType`, `totalAmount`, `status`, `createdAt`, `updatedAt`, optional `source`).
- **Invariant 2 (Valid Status Transitions & Terminal State Locking)**:
  - On `create`, `status` MUST be `'new'` (cannot pre-mark an order as `'delivered'`).
  - On `update`, ONLY `status` and `updatedAt` may change.
  - Once an order reaches `'delivered'` (terminal state), no further updates are permitted.
  - Transitions: `'new' -> 'preparing'`, `'new' -> 'delivered'`, `'preparing' -> 'delivered'`.
- **Invariant 3 (Temporal Integrity)**: `createdAt` and `updatedAt` MUST equal `request.time` on create; `createdAt` is immutable on update and `updatedAt == request.time`.
- **Invariant 4 (Bounded Sizes / Anti-DoS)**:
  - `orderId` matches `^[a-zA-Z0-9_-]{1,128}$`.
  - All strings have explicit `.size()` bounds (`seat` 1..16, `hall` 1..48, `orderCode` 4..24).
  - `items` list is bounded (`1 <= items.size() <= 20`), with first-item map shape validated (`name` string <= 100, `qty` number > 0, `price` number >= 0).
  - `totalAmount` is a number >= 0 and <= 100000.
- **Invariant 5 (No Arbitrary Deletes)**: Client deletes on `/orders/{orderId}` are denied (`allow delete: if false`) so order history/audit is preserved.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Shadow Field Injection on Create**: Adding `isAdmin: true` or `discount: 9999` to `/orders/{orderId}`.
2. **Oversized Document ID**: Using a 500-char `orderId` or invalid characters (`../hack`).
3. **Oversized Seat String**: `seat` with 500 characters (`"A".repeat(500)`).
4. **Empty / Unbounded Items Array**: `items: []` or `items` with 25 items (> 20 limit).
5. **Invalid Payment Type**: `paymentType: "crypto"` instead of `"digital"` or `"cash"`.
6. **Pre-Delivered Order on Create**: Creating an order with `status: "delivered"`.
7. **Spoofed Client Timestamp**: Setting `createdAt` to a past date instead of `request.time`.
8. **Mutating Total Amount on Update**: Updating `totalAmount` from `750` to `0` during KDS status update.
9. **Shadow Field Injection on Update**: Adding `hacked: true` while updating `status`.
10. **Updating Terminal State**: Changing `status` back from `'delivered'` to `'new'`.
11. **Deleting an Order**: Issuing `deleteDoc` on `/orders/{orderId}`.
12. **Writing to Unknown Collection**: Writing to `/admins/hacker` or `/users/123`.
