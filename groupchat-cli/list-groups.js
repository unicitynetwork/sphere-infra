#!/usr/bin/env node
/**
 * List all groups on the relay
 *
 * Usage:
 *   node list-groups.js
 *
 * Environment (via .env file or shell):
 *   NOSTR_MNEMONIC - Admin's 12-word recovery phrase (for authenticated access)
 *   RELAY_URL      - Relay WebSocket URL (default: ws://localhost:3334)
 */

import 'dotenv/config';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { finalizeEvent } from 'nostr-tools/pure';
import WebSocket from 'ws';

const NIP29_GROUP_METADATA = 39000;
const relayUrl = process.env.RELAY_URL || 'ws://localhost:3334';
const mnemonic = process.env.NOSTR_MNEMONIC;

// Derive private key if mnemonic is provided
let privateKeyBytes = null;
if (mnemonic && validateMnemonic(mnemonic, wordlist)) {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdkey = HDKey.fromMasterSeed(seed);
  const derived = hdkey.derive("m/44'/0'/0'/0/0");
  privateKeyBytes = derived.privateKey;
}

console.log(`Fetching groups from ${relayUrl}...`);
if (!privateKeyBytes) {
  console.log('(No NOSTR_MNEMONIC - listing public groups only)');
}
console.log('');

const ws = new WebSocket(relayUrl);
const groups = [];
let authenticated = false;

function sendGroupsRequest() {
  const filter = {
    kinds: [NIP29_GROUP_METADATA],
  };
  ws.send(JSON.stringify(['REQ', 'groups', filter]));
}

ws.on('open', () => {
  // If no auth needed, send request immediately
  // Otherwise wait for AUTH challenge
  if (!privateKeyBytes) {
    sendGroupsRequest();
  }
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());

  if (response[0] === 'AUTH' && privateKeyBytes && !authenticated) {
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

    // Send groups request after auth
    setTimeout(() => sendGroupsRequest(), 300);
  } else if (response[0] === 'EVENT' && response[1] === 'groups') {
    const event = response[2];
    try {
      // NIP-29 metadata can be in content (JSON) or tags
      let name = 'Unnamed';
      let description = '';
      let isPrivate = false;

      // Try parsing content as JSON first
      if (event.content) {
        try {
          const metadata = JSON.parse(event.content);
          name = metadata.name || name;
          description = metadata.about || description;
          isPrivate = metadata.private || isPrivate;
        } catch {}
      }

      // Also check tags for metadata
      for (const tag of event.tags) {
        if (tag[0] === 'name') name = tag[1];
        if (tag[0] === 'about') description = tag[1];
        if (tag[0] === 'public') isPrivate = tag[1] === 'false';
        if (tag[0] === 'private') isPrivate = tag[1] === 'true';
      }

      const groupId = event.tags.find(t => t[0] === 'd')?.[1] || 'unknown';
      groups.push({
        id: groupId,
        name,
        description,
        private: isPrivate,
        created: new Date(event.created_at * 1000).toISOString(),
      });
    } catch (e) {
      // Skip malformed events
    }
  } else if (response[0] === 'EOSE') {
    // End of stored events
    if (groups.length === 0) {
      console.log('No groups found on this relay.');
    } else {
      console.log(`Found ${groups.length} group(s):\n`);
      groups.forEach((g, i) => {
        console.log(`${i + 1}. ${g.name} ${g.private ? '🔒' : '🌐'}`);
        console.log(`   ID: ${g.id}`);
        if (g.description) console.log(`   ${g.description}`);
        console.log(`   Created: ${g.created}`);
        console.log('');
      });
    }
    ws.close();
  } else if (response[0] === 'OK' && response[1] && !response[2]) {
    // Auth failed
    console.error('Authentication failed:', response[3]);
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
  if (groups.length === 0) {
    console.log('No groups found (or timeout reached).');
  }
  ws.close();
}, 5000);
