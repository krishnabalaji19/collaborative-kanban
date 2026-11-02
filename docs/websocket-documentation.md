# WebSocket Documentation (Socket.IO)

Server URL: the same origin as the API (`http://localhost:5001`). Library: Socket.IO v4.

## Connecting and authentication

The JWT is sent in the handshake:

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:5001', { auth: { token } });
```

If the token is missing, invalid or expired, or the user no longer exists, the server rejects the connection and the client receives a `connect_error` event (`Unauthorized`).

Connecting alone does **not** subscribe the client to any data. The client must join a tenant room.

## Tenant rooms

Each tenant has one room named `tenant:<tenantId>`. Rooms are the only broadcast channel for business data, so an event for one tenant is never delivered to another tenant's room.

### Client to server

| Event | Payload | Acknowledgement |
|---|---|---|
| `tenant:join` | `{ tenantId }` | `{ ok: true, role, users: [{id, name}] }` on success, or `{ ok: false, error: "No access to this tenant" }` |
| `tenant:leave` | none | none |

```js
socket.emit('tenant:join', { tenantId }, (res) => {
  if (res.ok) showPresence(res.users);
});
```

On `tenant:join` the server:

1. Reads the user from the authenticated socket (never from the payload).
2. Checks the user's membership for that tenant (direct, or Org Admin of the tenant's organization).
3. Denies unknown, malformed and unauthorized tenant ids with the same error.
4. Leaves any previously joined tenant room (a socket is in one tenant room at a time), then joins the new one and updates presence.

## Server to client events

Every event is emitted to `tenant:<id>` **after** the database transaction has committed. `by` is the id of the user who caused the change. The sender also receives the event, so clients must treat events as idempotent (the web client ignores an event whose task `version` is not newer than its local copy).

| Event | Payload | Trigger |
|---|---|---|
| `task:created` | `{ task, by }` | `POST /tasks` |
| `task:updated` | `{ task, by }` | `PUT /tasks/:id` |
| `task:moved` | `{ task, fromColumnId, by }` | `PATCH /tasks/:id/move` |
| `task:deleted` | `{ taskId, columnId, by }` | `DELETE /tasks/:id` |
| `board:updated` | `{ boardId, by, deleted? }` | Board created, renamed or deleted; column created, renamed or deleted. Clients reload the board list and the open board. |
| `presence:update` | `{ users: [{ id, name }] }` | Someone joined, left or disconnected |

`task` is the full task row:

```json
{ "id": "…", "boardId": "…", "columnId": "…", "tenantId": "…", "title": "…",
  "description": "…", "priority": "HIGH", "dueDate": null, "assignedTo": "…",
  "position": 1500, "version": 3,
  "createdAt": "…", "updatedAt": "…" }
```

> The suggested names `presence:online` and `presence:offline` are folded into one event, `presence:update`, which always carries the complete list of online users. This avoids drift if a single event is missed.

## Presence

The server keeps `tenantId → userId → { name, count }`. `count` is the number of open connections (tabs) for that user. A user disappears from the list only when the last connection closes, so closing one of two tabs does not show them offline. Disconnects (including dropped networks, detected by Socket.IO's heartbeat) trigger a `presence:update`.

## Reconnection behaviour

1. The connection drops. The client shows a "Connection lost. Reconnecting..." banner.
2. Socket.IO reconnects automatically with backoff. The JWT from the original handshake is reused.
3. On the new `connect` event, the client **rejoins** its tenant room (rooms are not preserved across reconnects) and **reloads** the board and board list over REST.
4. The reload is required because events broadcast while the client was offline are not replayed. The REST response is always the authoritative state.

## Security summary

- Handshake authentication with the JWT.
- Membership re-checked on every `tenant:join`; the room id is never trusted from the client.
- Tenant id for broadcasts always comes from the server-verified request, not from client input.
- Verified by `backend/scripts/isolation-test.js`: a Hyderabad user is refused the Bangalore room, and a Hyderabad event is delivered to Hyderabad clients but not to Bangalore clients.
