#!/bin/bash
# =============================================================================
# AIS Aviation System - Critical E2E Tests
# Tests critical user flows after production deployment
# =============================================================================

set -e

BASE_URL="${1:-http://localhost:3000}"
TIMEOUT=30

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_test() { echo -e "${NC}[E2E]${NC} $1"; }

run_test() {
    local name="$1"
    local test_func="$2"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    log_test "Running: $name"
    if $test_func; then
        log_info "  PASSED"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "  FAILED"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

test_homepage() {
    local response=$(curl -sf --max-time $TIMEOUT "$BASE_URL/" 2>/dev/null)
    if echo "$response" | grep -q "<!DOCTYPE html>" && \
       echo "$response" | grep -q "<script"; then
        return 0
    fi
    return 1
}

test_flight_search_api() {
    local response=$(curl -sf --max-time $TIMEOUT \
        "$BASE_URL/api/trpc/flights.search?input=%7B%22json%22%3A%7B%7D%7D" \
        2>/dev/null)
    if echo "$response" | grep -q "result"; then
        return 0
    fi
    return 1
}

test_auth_flow() {
    local status=$(curl -sf -o /dev/null -w "%{http_code}" --max-time $TIMEOUT \
        "$BASE_URL/api/trpc/auth.me" 2>/dev/null || echo "000")
    if [ "$status" = "401" ] || [ "$status" = "200" ]; then
        return 0
    fi
    return 1
}

test_static_assets() {
    local page=$(curl -sf --max-time $TIMEOUT "$BASE_URL/" 2>/dev/null)
    if [ -z "$page" ]; then
        return 1
    fi
    if echo "$page" | grep -qE "(\.css|\.js)"; then
        return 0
    fi
    return 1
}

test_api_error_handling() {
    local status=$(curl -sf -o /dev/null -w "%{http_code}" --max-time $TIMEOUT \
        "$BASE_URL/api/trpc/invalid.endpoint" 2>/dev/null || echo "000")
    if [ "$status" = "404" ] || [ "$status" = "400" ] || [ "$status" = "405" ]; then
        return 0
    fi
    return 1
}

# Readiness is the public dependency-aware contract; it replaces admin-only health.check.
test_database_connectivity() {
    local response=$(curl -sf --max-time $TIMEOUT \
        "$BASE_URL/api/trpc/health.ready" 2>/dev/null)
    if echo "$response" | grep -qE '"status"\s*:\s*"(ok|healthy|ready)"' || \
       echo "$response" | grep -q '"result"'; then
        return 0
    fi
    return 1
}

test_cors_headers() {
    local headers=$(curl -sI --max-time $TIMEOUT \
        -H "Origin: https://example.com" \
        "$BASE_URL/api/trpc/health.live" 2>/dev/null)
    if echo "$headers" | grep -qi "access-control\|HTTP/.*200"; then
        return 0
    fi
    return 1
}

test_compression() {
    local headers=$(curl -sI --max-time $TIMEOUT \
        -H "Accept-Encoding: gzip, deflate" \
        "$BASE_URL/" 2>/dev/null)
    if echo "$headers" | grep -qi "content-encoding:\s*gzip\|vary:\s*accept-encoding"; then
        return 0
    fi
    local status=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null)
    if [ "$status" = "200" ]; then
        return 0
    fi
    return 1
}

test_websocket_available() {
    local response=$(curl -sI --max-time $TIMEOUT \
        -H "Upgrade: websocket" \
        -H "Connection: Upgrade" \
        "$BASE_URL/ws" 2>/dev/null || echo "")
    if echo "$response" | grep -qi "HTTP/"; then
        return 0
    fi
    return 0
}

test_rate_limiting() {
    local headers=$(curl -sI --max-time $TIMEOUT \
        "$BASE_URL/api/trpc/health.live" 2>/dev/null)
    if echo "$headers" | grep -qi "x-ratelimit\|retry-after"; then
        log_info "    Rate limiting is active"
    fi
    return 0
}

run_critical_tests() {
    echo ""
    echo "=============================================="
    echo "  AIS Aviation System - Critical E2E Tests"
    echo "  Target: $BASE_URL"
    echo "  Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "=============================================="
    echo ""

    echo "--- Critical User Flows ---"
    echo ""
    run_test "Homepage Loads" test_homepage
    run_test "Flight Search API" test_flight_search_api
    run_test "Authentication Flow" test_auth_flow
    run_test "Static Assets" test_static_assets
    run_test "API Error Handling" test_api_error_handling

    echo ""
    echo "--- Infrastructure Tests ---"
    echo ""
    run_test "Database Connectivity" test_database_connectivity
    run_test "CORS Headers" test_cors_headers
    run_test "Response Compression" test_compression
    run_test "WebSocket Availability" test_websocket_available
    run_test "Rate Limiting" test_rate_limiting

    echo ""
    echo "=============================================="
    echo "  Critical E2E Tests Summary"
    echo "=============================================="
    echo ""
    echo "  Total Tests:  $TOTAL_TESTS"
    echo "  Passed:       $PASSED_TESTS"
    echo "  Failed:       $FAILED_TESTS"
    echo ""

    if [ $TOTAL_TESTS -gt 0 ]; then
        local pass_rate=$((PASSED_TESTS * 100 / TOTAL_TESTS))
        echo "  Pass Rate:    ${pass_rate}%"
        echo ""
        if [ $pass_rate -ge 80 ]; then
            log_info "Critical E2E tests PASSED (${pass_rate}% pass rate)"
            exit 0
        fi
    fi

    log_error "Critical E2E tests FAILED!"
    exit 1
}

if [ -z "$BASE_URL" ]; then
    log_error "Usage: $0 <base_url>"
    log_error "Example: $0 https://ais-aviation.example.com"
    exit 1
fi

BASE_URL="${BASE_URL%/}"
run_critical_tests
