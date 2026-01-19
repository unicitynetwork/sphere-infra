# Sphere Group Chat CLI

Admin CLI tools for managing NIP-29 groups on Sphere's Zooid relay.

## Overview

This CLI provides commands to create, list, and delete groups on the NIP-29 relay used by [Unicity Sphere](https://github.com/unicitynetwork/sphere) for group chat functionality.

## Prerequisites

- Node.js 18+
- Admin access to the relay (your Sphere wallet must be configured as relay admin)

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Your 12-word recovery phrase from Sphere
# Get it from: Settings > Backup Wallet > Show Recovery Phrase
NOSTR_MNEMONIC="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"

# Relay WebSocket URL
RELAY_URL=wss://sphere-relay.unicity.network

# Sphere base URL (for generating invite links)
SPHERE_URL=https://sphere.unicity.network
```

## Commands

### List Groups

List all groups on the relay:

```bash
node list-groups.js
```

Example output:

```
Fetching groups from wss://sphere-relay.unicity.network...

Found 2 group(s):

1. General 🌐
   ID: general
   General discussion
   Created: 2025-01-19T12:00:00.000Z

2. Team Chat 🔒
   ID: teamchat
   Private team discussions
   Created: 2025-01-19T13:00:00.000Z
```

### Create Group

Create a new public group:

```bash
node create-group.js "Group Name" "Description"
```

Create a private group (generates invite link):

```bash
node create-group.js "Team Chat" "Private team discussions" --private
```

Example output:

```
Creating group "General" on wss://sphere-relay.unicity.network
Group ID: general
Admin pubkey: 84de98f...
Visibility: public

Connected to relay
Authenticating...
Checking if group already exists...
Sending create group event...
✅ Group created!
Group ID: general
```

For private groups, an invite URL is generated:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Invite URL: https://sphere.unicity.network/#/agents/chat?join=teamchat%2Fabc123xyz
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Share this URL with users to join.
```

### Delete Group

Delete a group by ID:

```bash
node delete-group.js <group-id>
```

Example:

```bash
node delete-group.js general
```

## NIP-29 Event Kinds

| Kind | Description |
|------|-------------|
| 9007 | Create group |
| 9008 | Delete group |
| 9009 | Create invite |
| 39000 | Group metadata |

## Key Derivation

The CLI derives Nostr keys from your Sphere mnemonic using BIP-44:

```
Path: m/44'/0'/0'/0/0
```

This matches Sphere's key derivation, ensuring the same identity is used.

## Production Relay

| Property | Value |
|----------|-------|
| URL | `wss://sphere-relay.unicity.network` |
| Region | AWS me-central-1 |
| Protocol | NIP-29 (relay-based groups) |

## Troubleshooting

**"Authentication failed"**
- Verify your mnemonic is correct
- Ensure your pubkey is in the relay's admin list

**"Group already exists"**
- Use `list-groups.js` to see existing groups
- Delete the existing group first, or use a different name

**"Failed to create group: unauthorized"**
- Your pubkey is not configured as relay admin
- Check the relay's `ADMIN_PUBKEYS` configuration

**Connection timeout**
- Verify `RELAY_URL` is correct
- Check if the relay is running

## Security

- Never commit your `.env` file (it's in `.gitignore`)
- Your mnemonic gives full access to your Sphere wallet
- Only share invite URLs with intended group members

## Related

- [Sphere](https://github.com/unicitynetwork/sphere) - Web3 platform with group chat
- [NIP-29 Spec](https://github.com/nostr-protocol/nips/blob/master/29.md) - Relay-based groups
- [Zooid Relay](https://github.com/unicitynetwork/unicity-relay) - NIP-29 relay implementation
