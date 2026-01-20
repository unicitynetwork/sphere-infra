# Sphere Infrastructure - AWS

CloudFormation templates and deployment scripts for Unicity Sphere backend services.

## Production Endpoints

| Service | Endpoint |
|---------|----------|
| NIP-29 Group Chat Relay | `wss://sphere-relay.unicity.network` |

## Zooid NIP-29 Relay

Deploys the Zooid relay for NIP-29 group chat functionality in Sphere.

- **Production URL:** `wss://sphere-relay.unicity.network`
- **AWS Region:** me-central-1
- **Stack Name:** sphere-zooid-relay
- **GitHub Repo:** https://github.com/unicitynetwork/unicity-relay

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Domain `unicity.network` accessible in Gandi DNS
3. Generate relay secret key (64-char hex string)
4. Admin pubkeys listed in `admin-pubkeys.txt` (one per line)

### Generate Relay Keys

```bash
# Generate a random secret key
RELAY_SECRET=$(openssl rand -hex 32)
echo "Secret Key: $RELAY_SECRET"
```

### Admin Pubkeys

Admin pubkeys are stored in `admin-pubkeys.txt` (one per line, 64-char hex):

```bash
# Example admin-pubkeys.txt
84de98f7dc200bf644ee3952b76ba201519e02773d9308af798975546064149d
a8dc385a04cd078244d0f82c191fbdd8c9f5fd5347e55b7fe45ad9c260792f8a
```

### Deploy

```bash
cd /Users/pavelg/work/unicity/sphere-infra/aws

./deploy-zooid-relay.sh \
    sphere-zooid-relay \
    me-central-1 \
    <relay-secret-key-hex>
```

### DNS Configuration

After deployment:

1. **ACM Certificate Validation** (during deployment):
   - Go to AWS Certificate Manager console
   - Find the pending certificate for `sphere-relay.unicity.network`
   - Copy the CNAME validation record
   - Add in Gandi DNS

2. **Main CNAME Record** (after deployment):
   - In Gandi DNS, add:
     ```
     Name:  sphere-relay
     Type:  CNAME
     Value: <ALB-endpoint-from-deployment-output>
     ```

### Architecture

```
                    ┌─────────────────┐
                    │  Gandi DNS      │
                    │  CNAME record   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ALB (HTTPS)    │
                    │  Port 443 only  │
                    │  TLS termination│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  ECS Fargate    │
                    │  Zooid Relay    │
                    │  Port 3334      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  EFS            │
                    │  SQLite data    │
                    │  Config files   │
                    └─────────────────┘
```

### Resources Created

- **VPC** with public subnets in 2 AZs
- **ALB** with HTTPS listener only (port 443)
- **ACM Certificate** for SSL/TLS
- **ECS Cluster** (Fargate)
- **ECS Task Definition** with Zooid container
- **EFS File System** for persistent SQLite storage
- **CloudWatch Logs** (14 day retention)
- **CloudWatch Alarms** for CPU/memory

### Environment Variables

The container accepts these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `RELAY_HOST` | Domain name for config | `localhost` |
| `RELAY_SECRET` | Nostr private key (hex) | Required |
| `RELAY_NAME` | Relay display name | `Sphere Relay` |
| `RELAY_DESCRIPTION` | Relay description | NIP-29 Group Chat... |
| `RELAY_PUBKEY` | Relay public key | Auto-derived |
| `ADMIN_PUBKEYS` | Admin pubkeys (quoted, comma-separated) | None |

### Updating the Relay

1. Push changes to the relay repo (triggers GHA build)
2. New image is pushed to `ghcr.io/unicitynetwork/unicity-relay:latest`
3. Force new deployment via AWS CLI:
   ```bash
   aws ecs update-service \
       --cluster sphere-zooid-relay-cluster \
       --service sphere-zooid-relay-zooid-relay \
       --force-new-deployment \
       --region me-central-1
   ```

### Costs (Estimated)

| Service | Monthly Cost |
|---------|-------------|
| ECS Fargate (0.5 vCPU, 1GB) | ~$15 |
| ALB | ~$20 |
| EFS (1GB) | ~$0.30 |
| CloudWatch Logs | ~$1 |
| **Total** | **~$36/month** |

### Troubleshooting

**Certificate stuck in pending validation:**
- Check AWS ACM console for the CNAME record details
- Verify the record is correctly added in Gandi
- DNS propagation can take up to 48 hours

**Service not healthy:**
```bash
# Check ECS service events
aws ecs describe-services \
    --cluster sphere-zooid-relay-cluster \
    --services sphere-zooid-relay-zooid-relay \
    --region me-central-1

# Check container logs
aws logs tail /ecs/sphere-zooid-relay-zooid-relay --follow --region me-central-1
```

**WebSocket connection refused:**
- Verify DNS is pointing to ALB
- Check security group allows inbound 443
- Verify certificate is issued (not pending)
