# PredictIQ — GitHub Workflow
## Status: LOCKED

### Branches
- `main`: stable integrated state
- short-lived feature branches as useful

### Commit format
`type(scope): concise description`

Examples:
```text
chore(repo): initialize PredictIQ
docs(scope): define locked product scope
feat(api): add telemetry ingestion
feat(db): add sensor readings schema
feat(wokwi): add motor telemetry simulation
feat(web): display live telemetry
feat(alerts): add health alerts
feat(maintenance): add service records
feat(feedback): capture technician ground truth
fix(api): reject invalid telemetry
test(api): cover telemetry validation
```

### Rules
- One logical change per commit.
- No `final`, `update`, `changes`, etc.
- Never commit secrets.
- Keep `.env.example`.
- Document architectural changes.
- Build → test → commit.
