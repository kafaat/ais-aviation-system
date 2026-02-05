#!/bin/bash
# =============================================================================
# AIS Aviation System - Rollback Script
# Manual rollback script for emergency situations
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
NAMESPACE="${NAMESPACE:-ais-production}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-ais-api}"
ROLLBACK_TIMEOUT="${ROLLBACK_TIMEOUT:-300}"

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

confirm_action() {
    local message="$1"
    echo -e "${YELLOW}$message${NC}"
    read -p "Type 'yes' to confirm: " confirm
    if [ "$confirm" != "yes" ]; then
        log_error "Operation cancelled by user"
        exit 1
    fi
}

# =============================================================================
# Rollback Functions
# =============================================================================

show_rollback_history() {
    log_step "Fetching deployment rollout history..."
    echo ""
    kubectl rollout history deployment/$DEPLOYMENT_NAME -n $NAMESPACE
    echo ""
}

show_current_status() {
    log_step "Current deployment status:"
    echo ""
    kubectl get deployment $DEPLOYMENT_NAME -n $NAMESPACE -o wide
    echo ""

    log_step "Current pods:"
    kubectl get pods -n $NAMESPACE -l app=$DEPLOYMENT_NAME -o wide
    echo ""

    log_step "Current image:"
    kubectl get deployment $DEPLOYMENT_NAME -n $NAMESPACE \
        -o jsonpath='{.spec.template.spec.containers[0].image}'
    echo ""
    echo ""
}

rollback_to_previous() {
    log_step "Rolling back to previous revision..."

    kubectl rollout undo deployment/$DEPLOYMENT_NAME -n $NAMESPACE

    log_step "Waiting for rollback to complete..."
    kubectl rollout status deployment/$DEPLOYMENT_NAME \
        -n $NAMESPACE \
        --timeout=${ROLLBACK_TIMEOUT}s

    log_info "Rollback completed successfully!"
}

rollback_to_revision() {
    local revision="$1"

    if [ -z "$revision" ]; then
        log_error "Revision number required"
        exit 1
    fi

    log_step "Rolling back to revision $revision..."

    kubectl rollout undo deployment/$DEPLOYMENT_NAME \
        -n $NAMESPACE \
        --to-revision=$revision

    log_step "Waiting for rollback to complete..."
    kubectl rollout status deployment/$DEPLOYMENT_NAME \
        -n $NAMESPACE \
        --timeout=${ROLLBACK_TIMEOUT}s

    log_info "Rollback to revision $revision completed!"
}

rollback_to_image() {
    local image="$1"

    if [ -z "$image" ]; then
        log_error "Image tag required"
        exit 1
    fi

    log_step "Rolling back to image: $image"

    kubectl set image deployment/$DEPLOYMENT_NAME \
        $DEPLOYMENT_NAME=$image \
        -n $NAMESPACE

    log_step "Waiting for rollback to complete..."
    kubectl rollout status deployment/$DEPLOYMENT_NAME \
        -n $NAMESPACE \
        --timeout=${ROLLBACK_TIMEOUT}s

    # Annotate the deployment with rollback reason
    kubectl annotate deployment/$DEPLOYMENT_NAME \
        -n $NAMESPACE \
        --overwrite \
        kubernetes.io/change-cause="Manual rollback to $image at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

    log_info "Rollback to image $image completed!"
}

verify_rollback() {
    log_step "Verifying rollback..."

    # Wait a bit for services to stabilize
    sleep 10

    # Check pod status
    local ready_pods=$(kubectl get deployment $DEPLOYMENT_NAME -n $NAMESPACE \
        -o jsonpath='{.status.readyReplicas}')
    local desired_pods=$(kubectl get deployment $DEPLOYMENT_NAME -n $NAMESPACE \
        -o jsonpath='{.spec.replicas}')

    if [ "$ready_pods" = "$desired_pods" ]; then
        log_info "All $ready_pods/$desired_pods pods are ready"
    else
        log_warn "Only $ready_pods/$desired_pods pods are ready"
    fi

    # Check for any failing pods
    local failing_pods=$(kubectl get pods -n $NAMESPACE -l app=$DEPLOYMENT_NAME \
        --field-selector=status.phase!=Running,status.phase!=Succeeded \
        -o name 2>/dev/null | wc -l)

    if [ "$failing_pods" -gt 0 ]; then
        log_warn "There are $failing_pods pods not in Running state"
        kubectl get pods -n $NAMESPACE -l app=$DEPLOYMENT_NAME
    else
        log_info "All pods are in healthy state"
    fi
}

run_post_rollback_smoke_test() {
    log_step "Running post-rollback smoke test..."

    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    if [ -f "$script_dir/smoke-tests.sh" ]; then
        # Get the service URL
        local service_url=$(kubectl get ingress ais-api-ingress -n $NAMESPACE \
            -o jsonpath='{.spec.rules[0].host}' 2>/dev/null || echo "")

        if [ -n "$service_url" ]; then
            bash "$script_dir/smoke-tests.sh" "https://$service_url" || {
                log_warn "Smoke tests failed after rollback"
                return 1
            }
        else
            log_warn "Could not determine service URL, skipping smoke tests"
        fi
    else
        log_warn "Smoke tests script not found, skipping"
    fi
}

# =============================================================================
# Main Menu
# =============================================================================

show_usage() {
    echo ""
    echo "AIS Aviation System - Rollback Script"
    echo ""
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  status              Show current deployment status"
    echo "  history             Show rollout history"
    echo "  previous            Rollback to previous revision"
    echo "  revision <num>      Rollback to specific revision"
    echo "  image <tag>         Rollback to specific image tag"
    echo "  verify              Verify current deployment health"
    echo ""
    echo "Options:"
    echo "  -n, --namespace     Kubernetes namespace (default: ais-production)"
    echo "  -d, --deployment    Deployment name (default: ais-api)"
    echo "  -y, --yes           Skip confirmation prompts"
    echo ""
    echo "Examples:"
    echo "  $0 status"
    echo "  $0 previous"
    echo "  $0 revision 5"
    echo "  $0 image ghcr.io/org/app:sha-abc123"
    echo "  $0 -n ais-staging previous"
    echo ""
}

# =============================================================================
# Argument Parsing
# =============================================================================

SKIP_CONFIRM=false
COMMAND=""
COMMAND_ARG=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        -d|--deployment)
            DEPLOYMENT_NAME="$2"
            shift 2
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        status|history|previous|revision|image|verify)
            COMMAND="$1"
            if [ "$1" = "revision" ] || [ "$1" = "image" ]; then
                COMMAND_ARG="$2"
                shift
            fi
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# =============================================================================
# Main
# =============================================================================

echo ""
echo "=============================================="
echo "  AIS Aviation System - Rollback"
echo "  Namespace: $NAMESPACE"
echo "  Deployment: $DEPLOYMENT_NAME"
echo "=============================================="
echo ""

# Check kubectl is available
if ! command -v kubectl &> /dev/null; then
    log_error "kubectl is not installed or not in PATH"
    exit 1
fi

# Check we can access the cluster
if ! kubectl get namespace $NAMESPACE &> /dev/null; then
    log_error "Cannot access namespace $NAMESPACE. Check your kubeconfig."
    exit 1
fi

# Execute command
case $COMMAND in
    status)
        show_current_status
        ;;
    history)
        show_rollback_history
        ;;
    previous)
        show_current_status
        show_rollback_history
        if [ "$SKIP_CONFIRM" != "true" ]; then
            confirm_action "Are you sure you want to rollback to the previous revision?"
        fi
        rollback_to_previous
        verify_rollback
        run_post_rollback_smoke_test
        ;;
    revision)
        show_rollback_history
        if [ "$SKIP_CONFIRM" != "true" ]; then
            confirm_action "Are you sure you want to rollback to revision $COMMAND_ARG?"
        fi
        rollback_to_revision "$COMMAND_ARG"
        verify_rollback
        run_post_rollback_smoke_test
        ;;
    image)
        show_current_status
        if [ "$SKIP_CONFIRM" != "true" ]; then
            confirm_action "Are you sure you want to rollback to image $COMMAND_ARG?"
        fi
        rollback_to_image "$COMMAND_ARG"
        verify_rollback
        run_post_rollback_smoke_test
        ;;
    verify)
        verify_rollback
        ;;
    *)
        show_usage
        exit 1
        ;;
esac

echo ""
log_info "Operation completed!"
