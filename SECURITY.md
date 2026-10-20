# Security Policy

Marsa accepts uploads from anonymous users, so security reports are very welcome.

## Reporting

Please report vulnerabilities **privately**, either through GitHub's
"Report a vulnerability" (private security advisory) on this repository or by
contacting the maintainers. Don't open a public issue. We aim to reply within a few days.

## Scope highlights

- Escaping the upload sandbox (path traversal, zip-slip, serving files outside a site).
- Uploaded content reaching the app origin (CSP / sandbox bypass).
- Bypassing size caps, rate limits, blocked file types or expiry.
- Token leakage, or editing/deleting a site without its edit token.

## Operator checklist

- Serve over HTTPS; set `PUBLIC_URL` accordingly.
- Set `TRUST_PROXY=true` only behind a proxy you control.
- Use a long random `ADMIN_TOKEN`, or leave it empty to disable admin.
- Consider a dedicated domain for Marsa on public instances.
