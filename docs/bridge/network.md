# Network

Permission: `network`

Use `networkFetch` for HTTP(S) requests through the shell.

Import from the generated app bridge:

```ts
import { networkFetch } from '../../src/bridge/platformBridge'
```

Example:

```ts
const response = await networkFetch({
  url: 'https://example.com/api/items',
  method: 'GET',
})

if (!response.ok) {
  throw new Error(`Request failed with ${response.status}`)
}
```

Request fields:

- `url`: HTTP or HTTPS URL.
- `method`: optional, defaults to `GET`.
- `headers`: optional string map.
- `body`: optional string.

Response fields:

- `status`: HTTP status code.
- `ok`: `true` for 2xx responses.
- `headers`: response headers as a string map.
- `body`: response body as text.
