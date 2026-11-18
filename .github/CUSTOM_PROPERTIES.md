# GitHub Repository Metadata & Custom Properties

This document defines the standardized **GitHub Repository Settings**, **Topics**, and **Custom Properties** metadata for [`ardianryan/OpenVolley`](https://github.com/ardianryan/OpenVolley), backed by machine-readable definitions in [`.github/custom-properties.json`](custom-properties.json).

---

## 1. Repository About & Social Preview

| Field | Value |
| :--- | :--- |
| **Description** | `Self-hosted real-time volleyball live score, symmetric tournament bracket, PIN-gated Arena TV display, and client-side broadcast Media Studio built on Bun, Hono, React 19, and SQLite.` |
| **Social Preview Image** | [`docs/assets/openvolley-banner.png`](../docs/assets/openvolley-banner.png) (`1280×640`) |
| **License** | `Apache-2.0 + Commons Clause v1.0` ([`LICENSE`](../LICENSE)) |
| **Topics** | `volleyball`, `live-score`, `scoreboard`, `tournament-bracket`, `broadcast-graphics`, `server-sent-events`, `bun`, `hono`, `sqlite`, `pwa`, `docker` |

### Apply Repository Description & Topics via GitHub CLI

```bash
gh repo edit ardianryan/OpenVolley \
  --description "Self-hosted real-time volleyball live score, symmetric tournament bracket, PIN-gated Arena TV display, and client-side broadcast Media Studio built on Bun, Hono, React 19, and SQLite." \
  --add-topic volleyball,live-score,scoreboard,tournament-bracket,broadcast-graphics,server-sent-events,bun,hono,sqlite,pwa,docker
```

---

## 2. Custom Properties Matrix

> **Note:** GitHub Custom Properties are supported natively on GitHub Organizations (`PATCH /orgs/{org}/properties/schema` and `PATCH /repos/{owner}/{repo}/properties/values`). For personal user-owned repositories, [`.github/custom-properties.json`](custom-properties.json) serves as the canonical repository governance manifest and can be applied immediately if the repository is transferred or mirrored into an organization.

| Property Name | Type | Value | Purpose |
| :--- | :--- | :--- | :--- |
| `project_tier` | `single_select` | `flagship` | Identifies production-grade maintenance & release governance. |
| `domain_category` | `single_select` | `sports-tech` | Classifies the repository under sports tournament & broadcast engineering. |
| `primary_runtime` | `single_select` | `bun` | Primary server runtime (`Bun 1.x` + `bun:sqlite`). |
| `deployment_target` | `multi_select` | `docker`, `ghcr`, `bare-metal-bun`, `nginx-cloudflare` | Verified production deployment targets. |
| `license_model` | `string` | `Apache-2.0 WITH Commons-Clause` | Source-available commercial-event-friendly license prohibiting SaaS resale. |
| `ui_locale` | `string` | `id-ID` | Default shipped court/spectator interface locale. |
| `security_scanning` | `true_false` | `true` | Confirms CodeQL + Dependabot enforcement. |

### Apply Custom Properties on a GitHub Organization

```bash
# 1. Provision custom property definitions at the organization level
jq -c '.schema[]' .github/custom-properties.json | while read -r prop; do
  name=$(echo "$prop" | jq -r '.property_name')
  gh api --method PUT "/orgs/<YOUR_ORG>/properties/schema/${name}" --input - <<< "$prop"
done

# 2. Assign property values to the OpenVolley repository
gh api --method PATCH "/repos/<YOUR_ORG>/OpenVolley/properties/values" \
  --input - <<< '{
    "properties": [
      { "property_name": "project_tier", "value": "flagship" },
      { "property_name": "domain_category", "value": "sports-tech" },
      { "property_name": "primary_runtime", "value": "bun" },
      { "property_name": "deployment_target", "value": ["docker", "ghcr", "bare-metal-bun", "nginx-cloudflare"] },
      { "property_name": "license_model", "value": "Apache-2.0 WITH Commons-Clause" },
      { "property_name": "ui_locale", "value": "id-ID" },
      { "property_name": "security_scanning", "value": "true" }
    ]
  }'
```
