# REST API Documentation

Base URL: `http://localhost:5001/api`. All bodies are JSON.

## Conventions

**Headers**

| Header | Used by | Meaning |
|---|---|---|
| `Authorization: Bearer <jwt>` | every endpoint except register, login, health | Identity |
| `x-tenant-id: <tenant uuid>` | boards, columns, tasks, activity, members | The branch the user is working in. The server verifies the user's membership. It never grants access by itself. |
| `Content-Type: application/json` | requests with a body | |

**Status codes**

| Code | Meaning |
|---|---|
| 200 / 201 | Success / created |
| 400 | Invalid input (response has `error` and `details`) |
| 401 | Missing or invalid token |
| 403 | Authenticated, but no access to this tenant or the role is too low |
| 404 | Not found, **or** belongs to another tenant (existence is not revealed) |
| 409 | Version conflict, or a delete blocked by existing children |
| 500 | Server error |

**Tenant scoping.** For endpoints marked *tenant-scoped*, every query is filtered by the verified tenant. A record from another tenant behaves as if it does not exist (404).

**Roles:** `OA` = Org Admin, `TA` = Tenant Admin, `M` = Member. "Any" means any member of the tenant.

---

## Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health` | none | `200 {"status":"ok","message":"The server is running"}` |

## Authentication

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/auth/register` | `{name, email, password (min 6)}` | `201 {token, user}` | 400, 409 email already registered |
| POST | `/auth/login` | `{email, password}` | `200 {token, user}` | 400, 401 invalid email or password |
| GET | `/auth/me` | none | `200 {user, organizations}` | 401 |

`GET /auth/me` returns everything the user may access. The frontend builds the organization selector and branch switcher from it:

```json
{
  "user": { "id": "…", "name": "Rahul", "email": "rahul@abc.com" },
  "organizations": [
    { "id": "…", "name": "ABC Technologies", "role": "ORG_ADMIN",
      "tenants": [ { "id": "…", "name": "Hyderabad", "role": "ORG_ADMIN" } ] }
  ]
}
```

## Organizations

Not tenant-scoped. Access is decided by the user's memberships in the organization.

| Method | Path | Body | Who | Success | Errors |
|---|---|---|---|---|---|
| POST | `/organizations` | `{name}` | any signed-in user (becomes OA) | `201 org` | 400 |
| GET | `/organizations` | none | any | `200 [org + role]`, only the user's own | |
| GET | `/organizations/:id` | none | members of it | `200 org` | 404 |
| PUT | `/organizations/:id` | `{name}` | OA | `200 org` | 400, 403, 404 |
| DELETE | `/organizations/:id` | none | OA | `200 {success:true}` | 403, 404, 409 still has branches |

## Tenants (branches)

Not tenant-scoped. They use organization-level checks.

| Method | Path | Body | Who | Success | Errors |
|---|---|---|---|---|---|
| POST | `/tenants` | `{organizationId, name}` | OA of that organization | `201 tenant` | 400, 403 `Only Org Admins can do this`, 404 |
| GET | `/tenants?organizationId=` | none | any | `200 [tenant + role]`, only accessible ones | |
| GET | `/tenants/:id` | none | members | `200 tenant + role` | 404 |
| PUT | `/tenants/:id` | `{name}` | OA | `200 tenant` | 400, 403, 404 |
| DELETE | `/tenants/:id` | none | OA | `200 {success:true}` | 403, 404, 409 still has boards |
| GET | `/tenants/:id/members` | none | members | `200 [{id,name,email,role,scope}]` | 404 |
| POST | `/tenants/:id/members` | `{email, role: "TENANT_ADMIN"\|"MEMBER"}` | OA or TA (TA may only add `MEMBER`) | `201 {id,name,email,role}` | 400, 403, 404 unknown email |
| DELETE | `/tenants/:id/members/:userId` | none | OA or TA (TA cannot remove a TA) | `200 {success:true}` | 403, 404 |

## Boards (tenant-scoped, needs `x-tenant-id`)

| Method | Path | Body | Who | Success | Errors |
|---|---|---|---|---|---|
| GET | `/boards` | none | Any | `200 [board + _count.tasks]` | 403 |
| POST | `/boards` | `{name, description?}` | OA, TA | `201 board` (4 default columns are created) | 400, 403 |
| GET | `/boards/:id` | none | Any | `200 board with columns[] and tasks[]` in display order | 404 |
| GET | `/boards/:id/columns` | none | Any | `200 [column]` | 404 |
| PUT | `/boards/:id` | `{name, description?}` | OA, TA | `200 board` | 400, 403, 404 |
| DELETE | `/boards/:id` | none | OA, TA | `200 {success:true}` (columns and tasks are deleted too) | 403, 404 |

`GET /boards/:id` is the authoritative full state. The client uses it for the first load and to resynchronise after a reconnect or a conflict.

## Columns (tenant-scoped, OA or TA only)

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/columns` | `{boardId, name}` | `201 column` (appended at the end) | 400, 403, 404 board |
| PUT | `/columns/:id` | `{name}` | `200 column` | 400, 403, 404 |
| DELETE | `/columns/:id` | none | `200 {success:true}` | 403, 404, 409 column still has tasks |

## Tasks (tenant-scoped)

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/tasks?boardId=` | Any | List tasks of the tenant (optionally one board) |
| GET | `/tasks/:id` | Any | One task |
| POST | `/tasks` | Any | Create (appended to the end of the column) |
| PUT | `/tasks/:id` | Any | Update fields, needs `version` |
| PATCH | `/tasks/:id/move` | Any | Move or reorder, needs `version` |
| DELETE | `/tasks/:id` | OA, TA | Delete |

### POST /tasks

```json
{ "boardId": "uuid", "columnId": "uuid", "title": "Write docs",
  "description": "optional", "priority": "LOW|MEDIUM|HIGH",
  "dueDate": "2026-11-05", "assignedTo": "user uuid" }
```

Only `boardId`, `columnId` and `title` are required. The column must belong to that board **and** to the caller's tenant (otherwise 404). The assignee must have access to the tenant (otherwise 400).
Success: `201` with the task. Also emits `task:created`.

### PUT /tasks/:id (update with optimistic locking)

```json
{ "version": 3, "title": "New title", "description": null,
  "priority": "HIGH", "dueDate": "2026-11-05", "assignedTo": null }
```

`version` is required. Other fields are optional.
Success `200`: the updated task with `version` increased by 1, and `task:updated` is emitted.

Conflict `409` when someone changed the task after the client loaded it:

```json
{ "error": "Task was changed by someone else",
  "current": { "id": "…", "title": "…", "version": 4 } }
```

`404` if the task does not exist in this tenant (including having been deleted).

### PATCH /tasks/:id/move

```json
{ "version": 3, "columnId": "destination column uuid",
  "prevTaskId": "task just above the drop spot or null",
  "nextTaskId": "task just below the drop spot or null" }
```

The client sends the *neighbours*, and the **server** calculates the new `position` (midpoint between them, or after the last card if both are null). The destination column must be on the same board and tenant.
Success `200`: the updated task, and `task:moved` is emitted. Conflicts return `409` exactly as above.

### DELETE /tasks/:id

`200 {"success": true}` and `task:deleted` is emitted. `403` for Members.

## Members of the current tenant

| Method | Path | Success |
|---|---|---|
| GET | `/members` (tenant-scoped) | `200 [{id, name, email, role}]`, used for the assignee dropdown |

## Activity log (tenant-scoped)

| Method | Path | Query | Success |
|---|---|---|---|
| GET | `/activity` | `limit` (default 50, max 200), `entityId` (optional, history of one task) | `200 [{id, tenantId, userId, userName, entityType, entityId, action, details, createdAt}]`, newest first |

`action` is one of `CREATED`, `UPDATED`, `MOVED`, `DELETED`. `entityType` is `TASK`, `BOARD`, `COLUMN` or `MEMBERSHIP`.

## Example: conflict in practice

```bash
# First move succeeds, version becomes 2
curl -X PATCH $API/tasks/$ID/move -H "Authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" \
  -H "Content-Type: application/json" -d '{"version":1,"columnId":"…"}'

# Same request again (stale version 1) is rejected
# → 409 {"error":"Task was changed by someone else","current":{…,"version":2}}
```
