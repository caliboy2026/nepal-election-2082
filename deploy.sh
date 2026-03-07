#!/bin/bash
# ═══════════════════════════════════════════════════
# Nepal Election 2082 — One-Click Deploy
# Deploys both Cloudflare Worker (API) and Netlify (frontend)
# Usage: ./deploy.sh              — deploy everything
#        ./deploy.sh "message"    — deploy with custom commit message
#        ./deploy.sh --worker     — deploy only Cloudflare Worker
#        ./deploy.sh --netlify    — deploy only Netlify frontend
# ═══════════════════════════════════════════════════

cd "$(dirname "$0")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

DEPLOY_WORKER=true
DEPLOY_NETLIFY=true
MSG=""

# Parse args
for arg in "$@"; do
    case "$arg" in
        --worker)  DEPLOY_NETLIFY=false ;;
        --netlify) DEPLOY_WORKER=false ;;
        *)         MSG="$arg" ;;
    esac
done

echo ""
echo "🗳️  Nepal Election 2082 — Deploy"
echo "════════════════════════════════"

# Git: stage, commit, push (skip if nothing changed)
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo -e "${YELLOW}No git changes to commit.${NC}"
else
    echo ""
    echo "📝 Changes detected:"
    git status --short
    echo ""

    MSG="${MSG:-Auto-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"

    echo -e "${GREEN}Staging...${NC}"
    git add -A

    echo -e "${GREEN}Committing:${NC} $MSG"
    git commit -m "$MSG"

    echo -e "${GREEN}Pushing to GitHub...${NC}"
    git push --set-upstream origin main 2>/dev/null || git push
fi

# Deploy Cloudflare Worker (API)
if [ "$DEPLOY_WORKER" = true ]; then
    echo ""
    echo -e "${CYAN}☁️  Deploying Cloudflare Worker...${NC}"
    cd cloudflare-worker
    npx wrangler deploy ./worker.js --name nepal-election-2082-api --no-bundle
    cd ..
    echo -e "${GREEN}✅ Worker deployed${NC}"
fi

# Deploy Netlify (frontend)
if [ "$DEPLOY_NETLIFY" = true ]; then
    echo ""
    echo -e "${CYAN}🌐 Deploying to Netlify...${NC}"
    npx netlify deploy --prod --dir=.
    echo -e "${GREEN}✅ Netlify deployed${NC}"
fi

echo ""
echo -e "${GREEN}════════════════════════════════${NC}"
echo -e "${GREEN}✅ All done!${NC}"
echo -e "   API:  https://nepal-election-2082-api.evanjay.workers.dev"
echo -e "   Site: https://nepal-election-2082-live.netlify.app"
echo ""
