#!/bin/bash
# E2E Test Runner Script
#
# This script runs E2E tests against the stream-manager service.
#
# Usage:
#   ./scripts/run-e2e-tests.sh          # Run with Docker (recommended)
#   ./scripts/run-e2e-tests.sh --local  # Run against local service (must be running)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup() {
    log_info "Cleaning up Docker resources..."
    docker-compose -f docker-compose.e2e.yml down -v 2>/dev/null || true
}

run_docker_tests() {
    log_info "Building and starting E2E test environment..."

    # Set up cleanup trap
    trap cleanup EXIT

    # Build and run tests
    docker-compose -f docker-compose.e2e.yml up --build --abort-on-container-exit

    # Get exit code from test container
    EXIT_CODE=$(docker inspect stream-manager-e2e-tests --format='{{.State.ExitCode}}' 2>/dev/null || echo "1")

    # Cleanup is handled by trap

    if [ "$EXIT_CODE" = "0" ]; then
        log_info "E2E tests passed!"
    else
        log_error "E2E tests failed with exit code $EXIT_CODE"
    fi

    exit "$EXIT_CODE"
}

run_local_tests() {
    log_info "Running E2E tests against local service..."

    # Check if service is running
    if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health | grep -q "200"; then
        log_error "Stream manager service not running at http://localhost:3001"
        log_info "Start the service with: npm run dev"
        exit 1
    fi

    log_info "Service is healthy, running tests..."

    API_BASE_URL=http://localhost:3001 npm run test:e2e
}

# Parse arguments
case "${1:-}" in
    --local|-l)
        run_local_tests
        ;;
    --help|-h)
        echo "E2E Test Runner"
        echo ""
        echo "Usage:"
        echo "  $0          Run tests with Docker (recommended)"
        echo "  $0 --local  Run tests against local service"
        echo "  $0 --help   Show this help message"
        ;;
    *)
        run_docker_tests
        ;;
esac
