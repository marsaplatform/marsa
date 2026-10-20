# Examples

Small, self-contained sample sites for the [use cases](../docs/use-cases.md). All names, numbers
and places in them are **fictional**.

| Folder | Use case |
| --- | --- |
| [`agent-report/`](agent-report) | An AI agent shares an HTML report |
| [`client-prototype/`](client-prototype) | A clickable prototype for a client |
| [`event-page/`](event-page) | A temporary event page |
| [`class-assignment/`](class-assignment) | A student's class assignment |
| [`ci-preview/`](ci-preview) | A GitHub Actions workflow that posts a preview link for each PR, plus a sample built site |
| [`agent/`](agent) | A prompt plus deploy scripts (shell, Node.js, Python) for agents |

Publish any of them (replace the URL with your instance, e.g. `http://localhost:8080`):

```bash
MARSA_URL=http://localhost:8080 ./examples/agent/deploy.sh examples/event-page 168
```

The test suite uploads every sample site, so they stay valid.
