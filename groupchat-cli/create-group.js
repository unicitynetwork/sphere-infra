#!/usr/bin/env node
/**
 * Create a NIP-29 group on the relay
 *
 * Usage:
 *   node create-group.js <name> [description] [--private]
 *
 * Environment (via .env file or shell):
 *   NOSTR_MNEMONIC - Admin's 12-word recovery phrase (from Sphere backup)
 *   RELAY_URL      - Relay WebSocket URL (default: ws://localhost:3334)
 *   SPHERE_URL     - Sphere base URL for invite links (default: http://localhost:5173)
 *
 * Example:
 *   cp .env.example .env
 *   # Edit .env with your mnemonic
 *   node create-group.js "general" "General discussion"
 */

import 'dotenv/config';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import WebSocket from 'ws';

const NIP29_CREATE_GROUP = 9007;
const NIP29_CREATE_INVITE = 9009;

// Parse arguments
const args = process.argv.slice(2);
const isPrivate = args.includes('--private');
const filteredArgs = args.filter(a => !a.startsWith('--'));
const [name, description] = filteredArgs;

if (!name) {
  console.error('Usage: node create-group.js <name> [description] [--private]');
  console.error('');
  console.error('Examples:');
  console.error('  node create-group.js "general" "General discussion"');
  console.error('  node create-group.js "team" "Team only" --private');
  console.error('');
  console.error('Environment:');
  console.error('  NOSTR_MNEMONIC - Your 12-word recovery phrase from Sphere');
  console.error('  RELAY_URL      - Relay URL (default: ws://localhost:3334)');
  console.error('  SPHERE_URL     - Sphere URL for invite links (default: http://localhost:5173)');
  process.exit(1);
}

const mnemonic = process.env.NOSTR_MNEMONIC;
if (!mnemonic) {
  console.error('Error: NOSTR_MNEMONIC environment variable required');
  console.error('');
  console.error('Get your recovery phrase from Sphere:');
  console.error('  Settings > Backup Wallet > Show Recovery Phrase');
  console.error('');
  console.error('Then export it:');
  console.error('  export NOSTR_MNEMONIC="word1 word2 word3 ... word12"');
  process.exit(1);
}

if (!validateMnemonic(mnemonic, wordlist)) {
  console.error('Error: Invalid mnemonic phrase');
  process.exit(1);
}

// Derive private key from mnemonic (BIP44 path matching Sphere: m/44'/0'/0'/0/0)
const seed = mnemonicToSeedSync(mnemonic);
const hdkey = HDKey.fromMasterSeed(seed);
const derived = hdkey.derive("m/44'/0'/0'/0/0");
const privateKeyBytes = derived.privateKey;

if (!privateKeyBytes) {
  console.error('Error: Failed to derive private key');
  process.exit(1);
}

const relayUrl = process.env.RELAY_URL || 'ws://localhost:3334';
const sphereUrl = process.env.SPHERE_URL || 'http://localhost:5173';
const pubkey = getPublicKey(privateKeyBytes);

// Generate a group ID from the name (lowercase, alphanumeric, max 24 chars)
function generateGroupId(groupName) {
  return groupName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24) || 'group' + Date.now().toString(36);
}

const groupId = generateGroupId(name);

console.log(`Creating group "${name}" on ${relayUrl}`);
console.log(`Group ID: ${groupId}`);
console.log(`Admin pubkey: ${pubkey}`);
console.log(`Visibility: ${isPrivate ? 'private' : 'public'}`);
console.log('');

// Create the group event (NIP-29 format with h tag)
const eventTemplate = {
  kind: NIP29_CREATE_GROUP,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['h', groupId],
    ['name', name],
    ['about', description || ''],
    ['public', isPrivate ? 'false' : 'true'],
  ],
  content: '',
};

const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

console.log('Event ID:', signedEvent.id);
console.log('');

// Generate invite code for private groups
function generateInviteCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Send to relay
const ws = new WebSocket(relayUrl);
let inviteCode = isPrivate ? generateInviteCode() : null;
let authenticated = false;
let groupExists = false;

ws.on('open', () => {
  console.log('Connected to relay');
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());

  if (response[0] === 'AUTH') {
    console.log('Authenticating...');
    const authEvent = finalizeEvent({
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['relay', relayUrl],
        ['challenge', response[1]],
      ],
      content: '',
    }, privateKeyBytes);
    ws.send(JSON.stringify(['AUTH', authEvent]));
    authenticated = true;

    // Check if group exists first
    setTimeout(() => {
      console.log('Checking if group already exists...');
      ws.send(JSON.stringify(['REQ', 'check', { kinds: [39000], '#d': [groupId] }]));
    }, 300);
  } else if (response[0] === 'EVENT' && response[1] === 'check') {
    // Found existing group
    groupExists = true;
  } else if (response[0] === 'EOSE' && response[1] === 'check') {
    // Done checking for existing group
    ws.send(JSON.stringify(['CLOSE', 'check']));
    if (groupExists) {
      console.error(`❌ Group "${groupId}" already exists. Use a different name or delete the existing group first.`);
      ws.close();
    } else {
      console.log('Sending create group event...');
      ws.send(JSON.stringify(['EVENT', signedEvent]));
    }
  } else if (response[0] === 'OK') {
    const eventId = response[1];
    const success = response[2];
    const message = response[3];

    // Check if this is response to group creation
    if (eventId === signedEvent.id) {
      if (success) {
        console.log('✅ Group created!');
        console.log(`Group ID: ${groupId}`);

        if (isPrivate && inviteCode) {
          // Create invite for private group
          console.log('Creating invite code...');
          const inviteEvent = finalizeEvent({
            kind: NIP29_CREATE_INVITE,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['h', groupId],
              ['code', inviteCode],
            ],
            content: '',
          }, privateKeyBytes);
          ws.send(JSON.stringify(['EVENT', inviteEvent]));
        } else {
          ws.close();
        }
      } else {
        console.error('❌ Failed to create group:', message);
        ws.close();
      }
    } else if (isPrivate) {
      // Response to invite creation
      if (success) {
        console.log('✅ Invite created!');
        console.log('');
        const inviteParam = `${groupId}/${inviteCode}`;
        const fullUrl = `${sphereUrl}/#/agents/chat?join=${encodeURIComponent(inviteParam)}`;
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Invite URL: ${fullUrl}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('Share this URL with users to join.');
      } else {
        console.error('⚠️  Group created but invite failed:', message);
        console.log(`Group ID: ${groupId}`);
      }
      ws.close();
    }
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  process.exit(0);
});

setTimeout(() => {
  console.error('Timeout');
  ws.close();
  process.exit(1);
}, 15000);
