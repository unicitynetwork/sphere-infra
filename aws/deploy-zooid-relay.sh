#!/bin/bash

# Deploy Zooid NIP-29 relay for Unicity Sphere
# This creates the AWS infrastructure and provides DNS validation instructions

set -e

STACK_NAME="${1:-sphere-zooid-relay}"
REGION="${2:-me-central-1}"
RELAY_SECRET_KEY="${3:-}"
ADMIN_PUBKEYS_FILE="admin-pubkeys.txt"

echo "=============================================="
echo "  Zooid NIP-29 Relay Deployment for Sphere"
echo "=============================================="
echo ""
echo "Stack: $STACK_NAME"
echo "Region: $REGION"
echo "Domain: sphere-relay.unicity.network"
echo ""

# Validate required parameters
if [ -z "$RELAY_SECRET_KEY" ]; then
    echo "ERROR: Relay secret key is required"
    echo ""
    echo "Usage: $0 <stack-name> <region> <relay-secret-key>"
    echo ""
    echo "Generate a new key pair:"
    echo "  # Using openssl:"
    echo "  openssl rand -hex 32"
    echo ""
    echo "Admin pubkeys are read from $ADMIN_PUBKEYS_FILE (one per line)"
    exit 1
fi

# Validate relay secret key format
if ! [[ "$RELAY_SECRET_KEY" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: Relay secret key must be a 64-character hex string"
    exit 1
fi

# Read and validate admin pubkeys from file
if [ ! -f "$ADMIN_PUBKEYS_FILE" ]; then
    echo "ERROR: Admin pubkeys file not found: $ADMIN_PUBKEYS_FILE"
    echo "Create the file with one pubkey per line (64-char hex)"
    exit 1
fi

ADMIN_PUBKEYS_FORMATTED=""
FIRST_ADMIN_PUBKEY=""
while IFS= read -r pubkey || [ -n "$pubkey" ]; do
    # Skip empty lines and comments
    [[ -z "$pubkey" || "$pubkey" =~ ^# ]] && continue

    # Validate pubkey format
    if ! [[ "$pubkey" =~ ^[0-9a-f]{64}$ ]]; then
        echo "ERROR: Invalid pubkey format: $pubkey"
        echo "Each pubkey must be a 64-character hex string"
        exit 1
    fi

    # Store first pubkey for RELAY_PUBKEY
    if [ -z "$FIRST_ADMIN_PUBKEY" ]; then
        FIRST_ADMIN_PUBKEY="$pubkey"
    fi

    # Build formatted string: "key1","key2",...
    if [ -z "$ADMIN_PUBKEYS_FORMATTED" ]; then
        ADMIN_PUBKEYS_FORMATTED="\"$pubkey\""
    else
        ADMIN_PUBKEYS_FORMATTED="$ADMIN_PUBKEYS_FORMATTED,\"$pubkey\""
    fi
done < "$ADMIN_PUBKEYS_FILE"

if [ -z "$FIRST_ADMIN_PUBKEY" ]; then
    echo "ERROR: No valid pubkeys found in $ADMIN_PUBKEYS_FILE"
    exit 1
fi

echo "Admin pubkeys loaded from $ADMIN_PUBKEYS_FILE"
echo "Primary admin: $FIRST_ADMIN_PUBKEY"
echo ""

# Check if stack exists
if aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION &>/dev/null; then
    echo "Updating existing stack..."
    OPERATION="update-stack"
    WAIT_CONDITION="stack-update-complete"
else
    echo "Creating new stack..."
    OPERATION="create-stack"
    WAIT_CONDITION="stack-create-complete"
fi

# Validate template
echo ""
echo "Validating CloudFormation template..."
aws cloudformation validate-template \
    --template-body file://zooid-relay-cloudformation.yaml \
    --region $REGION > /dev/null
echo "Template valid"

# Deploy stack
echo ""
echo "Deploying stack (this will take 10-15 minutes)..."

# Create parameters JSON file to avoid shell quoting issues
PARAMS_FILE=$(mktemp)
# Escape double quotes for JSON
ADMIN_PUBKEYS_JSON_ESCAPED=$(echo "$ADMIN_PUBKEYS_FORMATTED" | sed 's/"/\\"/g')
cat > "$PARAMS_FILE" << EOF
[
  {"ParameterKey": "RelaySecretKey", "ParameterValue": "$RELAY_SECRET_KEY"},
  {"ParameterKey": "AdminPubkey", "ParameterValue": "$FIRST_ADMIN_PUBKEY"},
  {"ParameterKey": "AdminPubkeys", "ParameterValue": "$ADMIN_PUBKEYS_JSON_ESCAPED"}
]
EOF

aws cloudformation $OPERATION \
    --stack-name $STACK_NAME \
    --template-body file://zooid-relay-cloudformation.yaml \
    --parameters file://"$PARAMS_FILE" \
    --capabilities CAPABILITY_IAM \
    --region $REGION

rm -f "$PARAMS_FILE"

echo ""
echo "=============================================="
echo "  IMPORTANT: DNS Validation Required"
echo "=============================================="
echo ""
echo "The ACM certificate requires DNS validation."
echo "After the stack starts creating, you need to:"
echo ""
echo "1. Go to AWS Certificate Manager in the console"
echo "2. Find the certificate for sphere-relay.unicity.network"
echo "3. Copy the CNAME name and value for DNS validation"
echo "4. Add the CNAME record in Gandi DNS"
echo ""
echo "Waiting for stack creation to start..."
sleep 10

# Try to get certificate validation details
echo ""
echo "Attempting to retrieve certificate validation details..."
CERT_ARN=$(aws cloudformation describe-stack-resources \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query "StackResources[?ResourceType=='AWS::CertificateManager::Certificate'].PhysicalResourceId" \
    --output text 2>/dev/null || echo "")

if [ -n "$CERT_ARN" ] && [ "$CERT_ARN" != "None" ]; then
    echo ""
    echo "Certificate ARN: $CERT_ARN"
    echo ""
    echo "DNS Validation Records (add these in Gandi):"
    aws acm describe-certificate \
        --certificate-arn "$CERT_ARN" \
        --region $REGION \
        --query "Certificate.DomainValidationOptions[].ResourceRecord" \
        --output table 2>/dev/null || echo "Certificate not yet available, check AWS Console"
fi

echo ""
echo "Waiting for stack operation to complete..."
echo "(Certificate validation may cause this to take longer)"
aws cloudformation wait $WAIT_CONDITION \
    --stack-name $STACK_NAME \
    --region $REGION

# Get outputs
echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo "=============================================="
echo ""

ALB_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs[?OutputKey==`ALBEndpoint`].OutputValue' \
    --output text)

echo "Stack outputs:"
aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --region $REGION \
    --query 'Stacks[0].Outputs' \
    --output table

echo ""
echo "=============================================="
echo "  Final DNS Setup"
echo "=============================================="
echo ""
echo "Add this CNAME record in Gandi DNS:"
echo ""
echo "  Name:   sphere-relay"
echo "  Type:   CNAME"
echo "  Value:  $ALB_ENDPOINT"
echo ""
echo "Once DNS propagates, your relay will be available at:"
echo "  wss://sphere-relay.unicity.network"
echo ""
