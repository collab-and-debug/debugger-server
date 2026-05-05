## Event Schema

Every WebSocket message must follow this shape:

```json
{
  "type":      "breakpoint | variable-state | user-joined | user-left | session-snapshot | ping",
  "sessionId": "abc-123",
  "userId":    "aishwarya",
  "userName":  "Aishwarya",
  "userColor": "#a3f21b",
  "payload":   {},
  "timestamp": "2024-01-01T10:00:00.000Z"
}
```

### Event types

| type | direction | payload |
|------|-----------|---------|
| `ping` | client → server | `{}` |
| `breakpoint` | client → server → broadcast | `{ file, line, action: "add" or "remove" }` |
| `variable-state` | client → server → broadcast | `{ scopes: { local: {}, global: {} } }` |
| `user-joined` | server → clients | `{}` |
| `user-left` | server → clients | `{}` |
| `session-snapshot` | server → new joiner only | `{ breakpoints: [], variables: {} }` |