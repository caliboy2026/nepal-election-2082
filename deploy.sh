#!/bin/bash
# ═══════════════════════════════════════════════════
# Nepal Election 2082 — One-Click Deploy
# Run this after Claude makes changes, or anytime
# Usage: ./deploy.sh  or  ./deploy.sh "custom commit message"
# ═══════════════════════════════════════════════════

cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "🗳️  Nepal Election 2082 — Deploy"
echo "════════════════════════════════"

# Check for changes
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo -e "${YELLOW}No changes to deploy.${NC}"
    exit 0
fi

# Show what changed
echo ""
echo "📝 Changes detected:"
git status --short
echo ""

# Commit message
MSG="${1:-Auto-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"

# Stage, commit, push
echo -e "${GREEN}Staging...${NC}"
git add -A

echo -e "${GREEN}Committing:${NC} $MSG"
git commit -m "$MSG"

echo -e "${GREEN}Pushing to GitHub...${NC}"
git push --set-upstream origin main 2>/dev/null || git push

# Deploy to Netlify
echo -e "${GREEN}Deploying to Netlify...${NC}"
netlify deploy --prod --dir=.

echo ""
echo -e "${GREEN}✅ Done! Site is live at https://nepal-election-2082-live.netlify.app${NC}"
echo ""
