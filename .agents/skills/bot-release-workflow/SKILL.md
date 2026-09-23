---
name: bot-release-workflow
description: Workflow and conventions for coding, testing, branching, releasing, and auto-deploying Bot-EVV to production.
---

# Bot-EVV Release and Development Workflow

This skill defines the mandatory workflow for introducing code changes, committing, testing, branching, and deploying updates for the Bot-EVV WhatsApp bot.

## 1. Branching Strategy
- **`develop`**: Development and staging branch where features and fixes are integrated.
- **`main`**: Production branch. Any push to `main` triggers the GitHub Actions CI/CD pipeline (`.github/workflows/deploy.yml`) on the Windows Server VPS to build and restart the bot under PM2.

## 2. Step-by-Step Release Procedure

Whenever introducing changes or fixes:

### Step 1: Versioning & Changelog
1. Bump the version in `package.json` following Semantic Versioning (e.g. `1.2.0`).
2. Update `src/config/changelog.ts`:
   - Set `CURRENT_VERSION` to the new version with release date, title, `highlights` (new features), and `fixes` (resolved bugs).
   - Move previous release to `CHANGELOG_HISTORY`.
3. Update `CHANGELOG.md` at repository root with human-readable markdown notes.

### Step 2: Verification (Pre-Flight)
Before committing, ALWAYS run:
1. `npm test` - Ensure all unit tests pass (100% green).
2. `npm run build` - Ensure TypeScript compiles into `dist/` without errors.

### Step 3: Git Commits & Branch Sync
Follow Conventional Commits:
- `feat(...)`: New features
- `fix(...)`: Bug fixes
- `refactor(...)`: Code restructuring
- `chore(...)`: Maintenance, dependency updates

Workflow commands:
```bash
# 1. Stage and commit on develop
git checkout develop
git merge main # Keep develop in sync with main if main has direct hotfixes
git add .
git commit -m "feat(module): description of changes and bump to vX.Y.Z"

# 2. Push develop
git push origin develop

# 3. Merge to main for production deployment
git checkout main
git merge develop
git push origin main
```

### Step 4: Production Deployment & Auto-Notification
- Pushing to `main` automatically runs GitHub Actions on the VPS runner.
- The workflow pulls changes, builds TypeScript, and executes `pm2 restart bot-evv`.
- When the bot connects to WhatsApp (`connection === 'open'`), `src/index.ts` compares the previous version stored in `system_config` table (`last_broadcast_version`) with `CURRENT_VERSION.version`.
- If the version is new, it broadcasts the formatted WhatsApp update template to **all authorized groups** exactly once.
