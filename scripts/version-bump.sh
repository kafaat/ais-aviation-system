#!/bin/bash
# =============================================================================
# AIS Aviation System - Version Bump Script
# Bumps version and generates changelog entry
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

show_usage() {
    echo ""
    echo "AIS Aviation System - Version Bump Script"
    echo ""
    echo "Usage: $0 <version_type> [options]"
    echo ""
    echo "Version Types:"
    echo "  patch         Bump patch version (1.0.0 -> 1.0.1)"
    echo "  minor         Bump minor version (1.0.0 -> 1.1.0)"
    echo "  major         Bump major version (1.0.0 -> 2.0.0)"
    echo "  <version>     Set specific version (e.g., 2.0.0-beta.1)"
    echo ""
    echo "Options:"
    echo "  --dry-run     Show what would be changed without making changes"
    echo "  --no-commit   Don't create a git commit"
    echo "  --no-tag      Don't create a git tag"
    echo "  --changelog   Generate changelog only"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 patch"
    echo "  $0 minor --dry-run"
    echo "  $0 2.0.0-beta.1"
    echo "  $0 patch --no-tag"
    echo ""
}

get_current_version() {
    cd "$PROJECT_ROOT"
    jq -r '.version' package.json
}

calculate_new_version() {
    local current="$1"
    local bump_type="$2"

    local major=$(echo "$current" | cut -d. -f1)
    local minor=$(echo "$current" | cut -d. -f2)
    local patch=$(echo "$current" | cut -d. -f3 | cut -d- -f1)

    case $bump_type in
        major)
            echo "$((major + 1)).0.0"
            ;;
        minor)
            echo "${major}.$((minor + 1)).0"
            ;;
        patch)
            echo "${major}.${minor}.$((patch + 1))"
            ;;
        *)
            # Assume it's a specific version
            echo "$bump_type"
            ;;
    esac
}

generate_changelog() {
    local new_version="$1"
    local output_file="$2"

    cd "$PROJECT_ROOT"

    # Get last tag
    local last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

    # Get commits
    if [ -z "$last_tag" ]; then
        local commits=$(git log --pretty=format:"%s|%h|%an" --reverse)
    else
        local commits=$(git log ${last_tag}..HEAD --pretty=format:"%s|%h|%an" --reverse)
    fi

    # Start changelog entry
    local changelog="## [${new_version}] - $(date +%Y-%m-%d)\n"

    # Categorize commits
    local features=""
    local fixes=""
    local security=""
    local perf=""
    local docs=""
    local refactor=""
    local other=""

    while IFS='|' read -r message hash author; do
        [ -z "$message" ] && continue

        # Skip merge commits and changelog formatting fixes
        echo "$message" | grep -qiE "^Merge (pull request|remote-tracking|branch)" && continue
        echo "$message" | grep -qiE "CHANGELOG.md.*(format|prettier|merge)" && continue
        echo "$message" | grep -qiE "^(style|chore\(release\))" && continue

        # Strip conventional commit prefix for cleaner output
        local clean_msg=$(echo "$message" | sed -E 's/^(feat|fix|perf|docs|refactor|security|ci|chore|style|build|test)(\([^)]*\))?:\s*//')
        local entry="- ${clean_msg} (${hash})"

        if echo "$message" | grep -qE "^(feat|feature)"; then
            features+="${entry}\n"
        elif echo "$message" | grep -qE "^fix.*([Ss]ecurity|CVE|vuln)" || echo "$message" | grep -qE "^security"; then
            security+="${entry}\n"
        elif echo "$message" | grep -qE "^(fix|bugfix)"; then
            fixes+="${entry}\n"
        elif echo "$message" | grep -qE "^perf"; then
            perf+="${entry}\n"
        elif echo "$message" | grep -qE "^docs"; then
            docs+="${entry}\n"
        elif echo "$message" | grep -qE "^refactor"; then
            refactor+="${entry}\n"
        elif echo "$message" | grep -qE "^(ci|chore|build|test|style)"; then
            # Skip CI/chore/build noise from changelog
            continue
        else
            other+="${entry}\n"
        fi
    done <<< "$commits"

    # Build changelog sections (blank line after each header for Prettier)
    if [ -n "$features" ]; then
        changelog+="\n### Added\n\n${features}"
    fi

    if [ -n "$fixes" ]; then
        changelog+="\n### Fixed\n\n${fixes}"
    fi

    if [ -n "$security" ]; then
        changelog+="\n### Security\n\n${security}"
    fi

    if [ -n "$perf" ]; then
        changelog+="\n### Performance\n\n${perf}"
    fi

    if [ -n "$docs" ]; then
        changelog+="\n### Documentation\n\n${docs}"
    fi

    if [ -n "$refactor" ]; then
        changelog+="\n### Refactored\n\n${refactor}"
    fi

    # Add Full Changelog link
    if [ -n "$last_tag" ]; then
        local repo_url="https://github.com/kafaat/ais-aviation-system"
        changelog+="\n**Full Changelog**: [${last_tag}...v${new_version}](${repo_url}/compare/${last_tag}...v${new_version})\n"
    fi

    if [ -n "$output_file" ]; then
        echo -e "$changelog" > "$output_file"
    else
        echo -e "$changelog"
    fi
}

update_changelog_file() {
    local new_version="$1"

    cd "$PROJECT_ROOT"

    local new_entry=$(generate_changelog "$new_version")

    if [ -f CHANGELOG.md ]; then
        # Create backup
        cp CHANGELOG.md CHANGELOG.md.bak

        # Find first version heading (## [) and insert before it
        local insert_line=$(grep -n "^## \[" CHANGELOG.md | head -1 | cut -d: -f1)

        if [ -n "$insert_line" ]; then
            # Insert new entry before the first version section
            {
                head -n $((insert_line - 1)) CHANGELOG.md
                echo -e "${new_entry}\n\n---\n"
                tail -n +${insert_line} CHANGELOG.md
            } > CHANGELOG.md.tmp
            mv CHANGELOG.md.tmp CHANGELOG.md
        else
            # No existing version sections, append after header
            local header_end=$(grep -n "^---$" CHANGELOG.md | head -1 | cut -d: -f1)
            if [ -n "$header_end" ]; then
                {
                    head -n ${header_end} CHANGELOG.md
                    echo ""
                    echo -e "${new_entry}"
                } > CHANGELOG.md.tmp
                mv CHANGELOG.md.tmp CHANGELOG.md
            else
                echo -e "$(cat CHANGELOG.md)\n\n${new_entry}" > CHANGELOG.md
            fi
        fi
    else
        # Create new changelog
        cat > CHANGELOG.md << 'HEADER'
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

HEADER
        echo -e "${new_entry}" >> CHANGELOG.md
    fi

    # Run prettier to ensure consistent formatting
    if command -v pnpm &> /dev/null; then
        pnpm exec prettier --write CHANGELOG.md 2>/dev/null || true
    fi
}

update_version_files() {
    local new_version="$1"

    cd "$PROJECT_ROOT"

    # Update package.json
    log_step "Updating package.json..."
    local tmp_file=$(mktemp)
    jq ".version = \"$new_version\"" package.json > "$tmp_file"
    mv "$tmp_file" package.json

    # Update any other version files if they exist
    if [ -f "version.txt" ]; then
        log_step "Updating version.txt..."
        echo "$new_version" > version.txt
    fi
}

create_commit() {
    local new_version="$1"

    cd "$PROJECT_ROOT"

    log_step "Creating commit..."
    git add package.json CHANGELOG.md
    [ -f version.txt ] && git add version.txt
    git commit -m "chore(release): v${new_version}"
}

create_tag() {
    local new_version="$1"

    cd "$PROJECT_ROOT"

    log_step "Creating tag..."
    git tag -a "v${new_version}" -m "Release v${new_version}"
}

# =============================================================================
# Main
# =============================================================================

# Parse arguments
DRY_RUN=false
NO_COMMIT=false
NO_TAG=false
CHANGELOG_ONLY=false
BUMP_TYPE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --no-commit)
            NO_COMMIT=true
            shift
            ;;
        --no-tag)
            NO_TAG=true
            shift
            ;;
        --changelog)
            CHANGELOG_ONLY=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            if [ -z "$BUMP_TYPE" ]; then
                BUMP_TYPE="$1"
            else
                log_error "Unknown argument: $1"
                show_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate bump type
if [ -z "$BUMP_TYPE" ] && [ "$CHANGELOG_ONLY" = "false" ]; then
    log_error "Version type required"
    show_usage
    exit 1
fi

# Check we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not in a git repository"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    log_warn "You have uncommitted changes. Commit or stash them first."
    if [ "$DRY_RUN" = "false" ]; then
        exit 1
    fi
fi

# Get versions
CURRENT_VERSION=$(get_current_version)

if [ "$CHANGELOG_ONLY" = "true" ]; then
    log_info "Generating changelog for current version: $CURRENT_VERSION"
    generate_changelog "$CURRENT_VERSION"
    exit 0
fi

NEW_VERSION=$(calculate_new_version "$CURRENT_VERSION" "$BUMP_TYPE")

echo ""
echo "=============================================="
echo "  AIS Aviation System - Version Bump"
echo "=============================================="
echo ""
echo "  Current Version: $CURRENT_VERSION"
echo "  New Version:     $NEW_VERSION"
echo "  Dry Run:         $DRY_RUN"
echo "  Create Commit:   $([ "$NO_COMMIT" = "true" ] && echo "No" || echo "Yes")"
echo "  Create Tag:      $([ "$NO_TAG" = "true" ] && echo "No" || echo "Yes")"
echo ""

if [ "$DRY_RUN" = "true" ]; then
    log_warn "DRY RUN - No changes will be made"
    echo ""
    log_step "Would update package.json to version $NEW_VERSION"
    log_step "Would generate changelog:"
    echo ""
    generate_changelog "$NEW_VERSION"
    exit 0
fi

# Perform version bump
log_step "Updating version to $NEW_VERSION..."
update_version_files "$NEW_VERSION"

log_step "Updating CHANGELOG.md..."
update_changelog_file "$NEW_VERSION"

if [ "$NO_COMMIT" = "false" ]; then
    create_commit "$NEW_VERSION"
fi

if [ "$NO_TAG" = "false" ] && [ "$NO_COMMIT" = "false" ]; then
    create_tag "$NEW_VERSION"
fi

echo ""
log_info "Version bumped to $NEW_VERSION!"
echo ""

if [ "$NO_COMMIT" = "false" ]; then
    echo "To push the changes:"
    echo "  git push && git push --tags"
fi
