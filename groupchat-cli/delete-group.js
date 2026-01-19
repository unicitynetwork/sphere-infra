#!/usr/bin/env node
/**
 * Delete a NIP-29 group on the relay
 *
 * Usage:
 *   node delete-group.js <group-id>
 *
 * Environment (via .env file or shell):
 *   NOSTR_MNEMONIC - Admin's 12-word recovery phrase (from Sphere backup)
 *   RELAY_URL      - Relay WebSocket URL (default: ws://localhost:3334)
 *
 * Example:
 *   node delete-group.js general
 */

import 'dotenv/config';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';

const NIP29_DELETE_GROUP = 9008;

// Parse arguments
const groupId = process.argv[2];

if (!groupId) {
  console.error('Usage: node delete-group.js <group-id>');
  console.error('');
  console.error('Example:');
  console.error('  node delete-group.js general');
  console.error('');
  console.error('To see available groups:');
  console.error('  node list-groups.js');
  process.exit(1);
}

const mnemonic = process.env.NOSTR_MNEMONIC;
if (!mnemonic) {
  console.error('Error: NOSTR_MNEMONIC environment variable required');
  console.error('Set it in .env file or export it');
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
const pubkey = getPublicKey(privateKeyBytes);

console.log(`Deleting group "${groupId}" on ${relayUrl}`);
console.log(`Admin pubkey: ${pubkey}`);
console.log('');

// Create the delete group event
const eventTemplate = {
  kind: NIP29_DELETE_GROUP,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['h', groupId],
  ],
  content: '',
};

const signedEvent = finalizeEvent(eventTemplate, privateKeyBytes);

// Send to relay
const ws = new WebSocket(relayUrl);

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

    // Send the delete group event after auth
    setTimeout(() => {
      console.log('Sending delete group event...');
      ws.send(JSON.stringify(['EVENT', signedEvent]));
    }, 500);
  } else if (response[0] === 'OK') {
    const eventId = response[1];
    const success = response[2];
    const message = response[3];

    if (eventId === signedEvent.id) {
      if (success) {
        console.log('✅ Group deleted!');
      } else {
        console.error('❌ Failed to delete group:', message);
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
