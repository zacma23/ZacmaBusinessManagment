# Zacma SaaS Portal — Security Specification (Phase 0 TDD)

## 1. Core Data Invariants

1. **Multi-Tenant Isolation**: Every organization resource (`businessUnits`, `forms`, `leads`, `formSubmissions`, `activities`, `communications`, `staffAssignments`, `notifications`, `auditLogs`, `integrations`, `messageTemplates`) is strictly scoped under `/organizations/{organizationId}`. No user outside an organization's `authorizedUserIds` or membership document can read or write its records.
2. **Public Form Safety**: Unauthenticated visitors may ONLY `get` a single document in `/publicForms/{publicSlugKey}` when `isPublished == true && isActive == true`. Visitors can NEVER list `/publicForms`, NEVER read private `/leads` or `/formSubmissions`, and can ONLY create a `/formSubmissions/{subId}` + paired `/leads/{leadId}` atomically when referencing an active, published `publicForm` whose `organizationId`, `businessUnitId`, and `formId` match.
3. **RBAC Privilege Integrity**: Users cannot self-assign `super_admin` or `org_admin` roles on `/users/{userId}` or `/organizations/{orgId}/members/{userId}`. Only the verified bootstrapped Super Admin (`zekimuluken@gmail.com` with `email_verified == true`) or an existing verified `super_admin` / `org_admin` may update roles and business unit assignments.
4. **Tiered Lead Updates**: Staff members (`role == 'staff'`) can only update operational lead fields (`status`, `priority`, `followUpDate`, `lastContactAt`, `internalNotes`, `attachments`, `updatedAt`) on authorized leads, and cannot alter `organizationId`, `businessUnitId`, `leadRef`, `ownerId`, or `createdAt`.
5. **Immutable Audit & Activity Logs**: `/auditLogs` and `/activities` are append-only (`allow update, delete: if false;`), preserving complete forensic traceability.
6. **Temporal & Structural Integrity**: Every `create` requires `createdAt == request.time`, every `update` requires `updatedAt == request.time`, every string is size-bounded, every array is bounded (`<= 100`), and every ID path variable is validated with `isValidId()`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Role Self-Escalation**: Authenticated non-admin creates `/users/{uid}` with `role: "super_admin"`. -> MUST FAIL (`PERMISSION_DENIED`).
2. **Email Spoofing**: Unverified token (`email_verified: false`) claims `email: "zekimuluken@gmail.com"` to read `/organizations/org-1/leads/lead-1`. -> MUST FAIL.
3. **Shadow Field Injection**: Admin updates `/organizations/org-1/businessUnits/bu-1` adding undocumented field `isSecretAdmin: true`. -> MUST FAIL via `hasOnly()`.
4. **Cross-Tenant Lead List Scraping**: Authenticated user in `org-2` lists `/organizations/org-1/leads`. -> MUST FAIL via `resource.data.authorizedUserIds` check.
5. **Public Lead Exfiltration**: Unauthenticated visitor tries `get` or `list` on `/organizations/org-1/leads`. -> MUST FAIL.
6. **Unpublished Form Submission Abuse**: Unauthenticated visitor submits to `/organizations/org-1/formSubmissions/sub-1` referencing a deactivated or unpublished `publicForm`. -> MUST FAIL via `get(publicForms/...)` check.
7. **Orphaned Public Lead Injection**: Unauthenticated visitor creates `/organizations/org-1/leads/lead-fake` without atomically creating the paired `formSubmission` in the same batch. -> MUST FAIL via `existsAfter()`.
8. **Public Lead Privilege Poisoning**: Unauthenticated visitor creates a public lead with `status: "converted"` or `assignedStaffId: "attacker"`. -> MUST FAIL (`status == 'new'` and `assignedStaffId == ''` enforced).
9. **ID Poisoning / Denial of Wallet**: Attacker writes document with 1,500-character ID or 2MB `description` string. -> MUST FAIL via `isValidId()` and `.size()` limits.
10. **Audit Log Tampering**: Even a Super Admin or Org Admin attempts to `update` or `delete` an `/auditLogs/{logId}` entry. -> MUST FAIL (`allow update, delete: if false`).
11. **Immutable Field Mutation**: Staff member attempts to change `createdAt`, `organizationId`, or `ownerId` during a lead update. -> MUST FAIL via immutability checks and `affectedKeys().hasOnly()`.
12. **PII Blanket Read**: Authenticated non-owner staff tries to `get` another user's `/users/{otherUid}` profile. -> MUST FAIL (`isOwner || isBootstrapSuperAdmin`).
