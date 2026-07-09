#!/bin/bash
# Push-button deployment of paa.pub to OpenShift.
# Usage: ./deploy/openshift/deploy.sh [PASSWORD]

set -euo pipefail

NAMESPACE=$(oc project -q)
PASSWORD="${1:-changeme}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==> Deploying paa.pub to namespace: $NAMESPACE"

# Patch deployment image to use correct namespace
sed "s|NAMESPACE|${NAMESPACE}|g" "$SCRIPT_DIR/deployment.yaml" | oc apply -f -

# Apply remaining resources
oc apply -f "$SCRIPT_DIR/configmap.yaml"
oc apply -f "$SCRIPT_DIR/minio.yaml"
oc apply -f "$SCRIPT_DIR/route.yaml"
oc apply -f "$SCRIPT_DIR/networkpolicy.yaml"

# Create/update secret with provided password
oc create secret generic paa-pub-secrets \
  --from-literal=PAA_PASSWORD="$PASSWORD" \
  --from-literal=MINIO_ACCESS_KEY=minioadmin \
  --from-literal=MINIO_SECRET_KEY=minioadmin \
  --dry-run=client -o yaml | oc apply -f -

# Create ImageStream and BuildConfig if they don't exist
oc get is paa-pub 2>/dev/null || oc create imagestream paa-pub
oc get bc paa-pub 2>/dev/null || \
  oc new-build --name=paa-pub --binary --strategy=docker --to=paa-pub:latest \
    --build-arg="DOCKERFILE=deploy/openshift/Dockerfile" 2>/dev/null || true

# Patch BuildConfig for correct Dockerfile path
oc patch bc paa-pub -p '{"spec":{"strategy":{"dockerStrategy":{"dockerfilePath":"deploy/openshift/Dockerfile"}}}}' 2>/dev/null || true

# Build from project root
echo "==> Starting build..."
cd "$PROJECT_DIR"
oc start-build paa-pub --from-dir=. --follow

# Set route URL in config
ROUTE_URL=$(oc get route paa-pub -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
if [ -n "$ROUTE_URL" ]; then
  oc set env deployment/paa-pub PAA_DOMAIN="$ROUTE_URL"
  echo ""
  echo "==> Live at: https://$ROUTE_URL"
fi
