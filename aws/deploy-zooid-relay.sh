#!/bin/bash

# Deploy Zooid NIP-29 relay for Unicity Sphere
# This creates the AWS infrastructure and provides DNS validation instructions

set -e

STACK_NAME="${1:-sphere-zooid-relay}"
REGION="${2:-me-central-1}"
RELAY_SECRET_KEY="${3:-}"
ADMIN_PUBKEY="${4:-}"

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
    echo "Usage: $0 <stack-name> <region> <relay-secret-key> <admin-pubkey>"
    echo ""
    echo "Generate a new key pair:"
    echo "  # Using openssl:"
    echo "  openssl rand -hex 32"
    echo ""
    exit 1
fi

if [ -z "$ADMIN_PUBKEY" ]; then
    echo "ERROR: Admin public key is required"
    echo ""
    echo "Usage: $0 <stack-name> <region> <relay-secret-key> <admin-pubkey>"
    exit 1
fi

# Validate key formats
if ! [[ "$RELAY_SECRET_KEY" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: Relay secret key must be a 64-character hex string"
    exit 1
fi

if ! [[ "$ADMIN_PUBKEY" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: Admin public key must be a 64-character hex string"
    exit 1
fi

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
aws cloudformation $OPERATION \
    --stack-name $STACK_NAME \
    --template-body file://zooid-relay-cloudformation.yaml \
    --parameters \
        ParameterKey=RelaySecretKey,ParameterValue="$RELAY_SECRET_KEY" \
        ParameterKey=AdminPubkey,ParameterValue="$ADMIN_PUBKEY" \
    --capabilities CAPABILITY_IAM \
    --region $REGION

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
