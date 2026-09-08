#!/bin/bash
# =============================================================================
# AIS Aviation System - Smoke Tests
# Verifies basic functionality after deployment
# =============================================================================

set -e

# Configuration
BASE_URL="${1:-http://localhost:3000}"
MAX_RETRIES=10
RETRY_DELAY=5
TIMEOUT=10

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

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

log_test() {
    echo -e "${NC}[TEST]${NC} $1"
}

# Wait for service to be available
wait_for_service() {
    local url="$1"
    local retries=0

    log_info "Waiting for service at $url to be available..."

    while [ $retries -lt $MAX_RETRIES ]; do
        if curl -sf -o /dev/null --max-time $TIMEOUT "$url"; then
            log_info "Service is available!"
            return 0
        fi

        retries=$((retries + 1))
        log_warn "Service not ready, attempt $retries/$MAX_RETRIES. Retrying in ${RETRY_DELAY}s..."
        sleep $RETRY_DELAY
    done

    log_error "Service failed to become available after $MAX_RETRIES attempts"
    return 1
}

# Test HTTP endpoint
test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"
    local method="${4:-GET}"
    local data="${5:-}"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    log_test "Testing: $name"

    local curl_args="-s -o /tmp/response.txt -w %{http_code} --max-time $TIMEOUT"

    if [ "$method" = "POST" ] && [ -n "$data" ]; then
        curl_args="$curl_args -X POST -H 'Content-Type: application/json' -d '$data'"
    fi

    local status=$(curl $curl_args "$url" 2>/dev/null || echo "000")

    if [ "$status" = "$expected_status" ]; then
        log_info "  PASSED - Status: $status (expected: $expected_status)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "  FAILED - Status: $status (expected: $expected_status)"
        if [ -f /tmp/response.txt ]; then
            log_error "  Response: $(head -c 200 /tmp/response.txt)"
        fi
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Test response contains expected content
test_response_contains() {
    local name="$1"
    local url="$2"
    local expected_content="$3"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    log_test "Testing: $name"

    local response=$(curl -sf --max-time $TIMEOUT "$url" 2>/dev/null || echo "")

    if echo "$response" | grep -q "$expected_content"; then
        log_info "  PASSED - Response contains expected content"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "  FAILED - Response does not contain: $expected_content"
        log_error "  Response: $(echo "$response" | head -c 200)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# Test response time
test_response_time() {
    local name="$1"
    local url="$2"
    local max_time_ms="${3:-2000}"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    log_test "Testing: $name (max ${max_time_ms}ms)"

    local time_ms=$(curl -sf -o /dev/null -w "%{time_total}" --max-time $TIMEOUT "$url" 2>/dev/null || echo "999")
    time_ms=$(echo "$time_ms * 1000" | bc | cut -d'.' -f1)

    if [ "$time_ms" -lt "$max_time_ms" ]; then
        log_info "  PASSED - Response time: ${time_ms}ms (max: ${max_time_ms}ms)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        log_error "  FAILED - Response time: ${time_ms}ms exceeds max: ${max_time_ms}ms"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# =============================================================================
# Smoke Tests
# =============================================================================

run_smoke_tests() {
    echo ""
    echo "=============================================="
    echo "  AIS Aviation System - Smoke Tests"
    echo "  Target: $BASE_URL"
    echo "  Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "=============================================="
    echo ""

    # Wait for the process to be alive through the public liveness contract.
    if ! wait_for_service "$BASE_URL/api/trpc/health.live"; then
        log_error "Service not available. Aborting smoke tests."
        exit 1
    fi

    echo ""
    echo "--- Health & Infrastructure Tests ---"
    echo ""

    # Public liveness endpoint
    test_endpoint "Liveness Check" \
        "$BASE_URL/api/trpc/health.live" \
        "200"

    test_response_contains "Liveness Response" \
        "$BASE_URL/api/trpc/health.live" \
        "result"

    test_response_time "Liveness Response Time" \
        "$BASE_URL/api/trpc/health.live" \
        "1000"

    # Public readiness endpoint validates dependencies without admin credentials.
    test_endpoint "Readiness Check" \
        "$BASE_URL/api/trpc/health.ready" \
        "200"

    echo ""
    echo "--- API Endpoint Tests ---"
    echo ""

    test_endpoint "Frontend Root" \
        "$BASE_URL/" \
        "200"

    test_endpoint "tRPC API Root" \
        "$BASE_URL/api/trpc" \
        "200"

    test_endpoint "Flights API Available" \
        "$BASE_URL/api/trpc/flights.search?input=%7B%22json%22%3A%7B%7D%7D" \
        "200"

    echo ""
    echo "--- Security Tests ---"
    echo ""

    test_endpoint "Auth Protection (Bookings)" \
        "$BASE_URL/api/trpc/bookings.list" \
        "401"

    test_endpoint "Admin Protection" \
        "$BASE_URL/api/trpc/admin.users" \
        "401"

    echo ""
    echo "--- Performance Tests ---"
    echo ""

    test_response_time "Frontend Load Time" \
        "$BASE_URL/" \
        "3000"

    test_response_time "API Response Time" \
        "$BASE_URL/api/trpc/health.live" \
        "500"

    echo ""
    echo "--- Static Assets Tests ---"
    echo ""

    test_endpoint "Static Assets Available" \
        "$BASE_URL/assets/" \
        "200"

    echo ""
    echo "=============================================="
    echo "  Smoke Tests Summary"
    echo "=============================================="
    echo ""
    echo "  Total Tests:  $TOTAL_TESTS"
    echo "  Passed:       $PASSED_TESTS"
    echo "  Failed:       $FAILED_TESTS"
    echo ""

    if [ $FAILED_TESTS -gt 0 ]; then
        log_error "Smoke tests FAILED!"
        echo ""
        exit 1
    else
        log_info "All smoke tests PASSED!"
        echo ""
        exit 0
    fi
}

# =============================================================================
# Main
# =============================================================================

if [ -z "$BASE_URL" ]; then
    log_error "Usage: $0 <base_url>"
    log_error "Example: $0 https://staging.ais-aviation.example.com"
    exit 1
fi

BASE_URL="${BASE_URL%/}"
run_smoke_tests
