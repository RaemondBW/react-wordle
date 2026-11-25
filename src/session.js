import { useCallback, useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

// Shared "play with friends" sessions, with no server of our own.
//
// Every player's browser keeps a full copy of the session (each player's name
// and submitted guesses) in localStorage. Whoever has the page open claims a
// fixed PeerJS id derived from the room, and becomes the hub everyone else
// connects to directly over WebRTC. When that hub leaves, the id frees up and
// the next browser to retry claims it and carries on from its own copy, so the
// room survives as long as anyone comes back to it.
//
// PeerJS's free public broker is only used to set up connections; guesses go
// browser to browser.

const PEER_PREFIX = 'raemond-wordle-';
const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const MAX_NAME_LENGTH = 20;

const HEARTBEAT_MS = 4000;
const STALE_MS = 13000;
const CONNECT_TIMEOUT_MS = 10000;

export const EMPTY_SESSION = { players: {} };

const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      // Private mode or storage disabled: the session still works, it just
      // won't survive a reload on this device.
    }
  },
};

const randomId = (length) => {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

export const newRoomId = () => randomId(10);

export const isValidRoomId = (room) => typeof room === 'string' && /^[a-z0-9]{6,20}$/.test(room);

export const getPlayerId = () => {
  let id = storage.get('wordle-player-id');
  if (!id || !/^[a-z0-9]{8,20}$/.test(id)) {
    id = randomId(12);
    storage.set('wordle-player-id', id);
  }
  return id;
};

export const getSavedName = () => storage.get('wordle-player-name') || '';
export const saveName = (name) => storage.set('wordle-player-name', name);

export const cleanName = (name) => (typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '');

// Anything arriving from another browser is untrusted: keep only well-formed players.
const cleanPlayer = (player) => {
  if (!player || typeof player !== 'object' || !Array.isArray(player.guesses)) {
    return null;
  }
  const guesses = player.guesses
    .filter((g) => typeof g === 'string' && new RegExp(`^[a-z]{${WORD_LENGTH}}$`).test(g))
    .slice(0, MAX_GUESSES);
  const updated = Number.isFinite(player.updated) ? player.updated : 0;
  return { name: cleanName(player.name), guesses, updated };
};

export const cleanSession = (session) => {
  const players = {};
  if (session && typeof session === 'object' && session.players && typeof session.players === 'object') {
    Object.entries(session.players).slice(0, 50).forEach(([id, player]) => {
      const clean = cleanPlayer(player);
      if (clean && /^[a-z0-9]{8,20}$/.test(id)) {
        players[id] = clean;
      }
    });
  }
  return { players };
};

// Guesses only ever grow, so for each player the copy with more guesses wins;
// on a tie the more recently updated one does (that's how name changes spread).
// Returns `current` itself when nothing changed, so React can skip re-rendering.
export const mergeSessions = (current, incoming) => {
  let players = null;
  Object.entries(incoming.players).forEach(([id, theirs]) => {
    const ours = current.players[id];
    const theirsIsNewer = !ours
      || theirs.guesses.length > ours.guesses.length
      || (theirs.guesses.length === ours.guesses.length && theirs.updated > ours.updated);
    if (theirsIsNewer) {
      players = players || { ...current.players };
      players[id] = theirs;
    }
  });
  return players ? { players } : current;
};

const loadSession = (room) => {
  try {
    return cleanSession(JSON.parse(storage.get(`wordle-room-${room}`)));
  } catch (e) {
    return EMPTY_SESSION;
  }
};

// Result links carry one player's entry so it can reach people who were never
// online at the same time as them.
export const encodeResult = (playerId, player) => JSON.stringify({ id: playerId, n: player.name, g: player.guesses });

export const decodeResult = (text) => {
  try {
    const data = JSON.parse(text);
    if (!/^[a-z0-9]{8,20}$/.test(data.id)) {
      return null;
    }
    const player = cleanPlayer({ name: data.n, guesses: data.g, updated: 0 });
    return player ? { players: { [data.id]: player } } : null;
  } catch (e) {
    return null;
  }
};

class RoomConnection {
  constructor(room, playerId, callbacks) {
    this.room = room;
    this.playerId = playerId;
    this.callbacks = callbacks; // { getSession, onSession, onStatus, onOnline }
    this.generation = 0;
    this.peer = null;
    this.hostConn = null;
    this.clients = new Map(); // conn.peer -> { conn, playerId, lastSeen }
    this.hostLastSeen = 0;
    this.retryTimer = null;
    this.connectTimer = null;
    this.attempts = 0;
    this.status = 'connecting';
    this.heartbeat = setInterval(() => this.tick(), HEARTBEAT_MS);
  }

  setStatus(status) {
    this.status = status;
    this.callbacks.onStatus(status);
  }

  start() {
    this.teardown();
    const generation = this.generation;
    const current = () => generation === this.generation && !this.stopped;
    this.setStatus('connecting');

    // Try to be the hub first; if someone already is, join them instead.
    const peer = new Peer(PEER_PREFIX + this.room, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      if (!current()) return;
      this.role = 'host';
      this.attempts = 0;
      this.setStatus('connected');
      this.publishOnline();
    });
    peer.on('connection', (conn) => {
      if (current()) this.acceptClient(conn);
    });
    peer.on('error', (err) => {
      if (!current()) return;
      if (err.type === 'unavailable-id') {
        this.generation++;
        peer.destroy();
        this.joinHost(this.generation);
      } else {
        this.retry();
      }
    });
    peer.on('disconnected', () => {
      // Lost the broker: nobody new can find us, so start over.
      if (current()) this.retry();
    });
  }

  joinHost(generation) {
    const current = () => generation === this.generation && !this.stopped;
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    this.role = 'client';
    peer.on('open', () => {
      if (!current()) return;
      const conn = peer.connect(PEER_PREFIX + this.room, { reliable: true });
      this.hostConn = conn;
      this.connectTimer = setTimeout(() => {
        if (current() && this.status !== 'connected') this.retry();
      }, CONNECT_TIMEOUT_MS);
      conn.on('open', () => {
        if (!current()) return;
        clearTimeout(this.connectTimer);
        this.attempts = 0;
        this.hostLastSeen = Date.now();
        this.setStatus('connected');
        conn.send({ t: 'hello', playerId: this.playerId });
        conn.send({ t: 'state', session: this.callbacks.getSession() });
      });
      conn.on('data', (msg) => {
        if (!current()) return;
        this.hostLastSeen = Date.now();
        this.receive(msg);
      });
      conn.on('close', () => {
        if (current()) this.retry(true);
      });
      conn.on('error', () => {
        if (current()) this.retry(true);
      });
    });
    peer.on('error', () => {
      // Usually "peer-unavailable": the hub left between our two attempts.
      if (current()) this.retry(true);
    });
    peer.on('disconnected', () => {
      if (current() && this.status !== 'connected') this.retry();
    });
  }

  acceptClient(conn) {
    conn.on('open', () => {
      this.clients.set(conn.peer, { conn, playerId: null, lastSeen: Date.now() });
      conn.send({ t: 'state', session: this.callbacks.getSession() });
      this.publishOnline();
    });
    conn.on('data', (msg) => {
      const client = this.clients.get(conn.peer);
      if (!client) return;
      client.lastSeen = Date.now();
      if (msg && msg.t === 'hello' && typeof msg.playerId === 'string') {
        client.playerId = msg.playerId;
        this.publishOnline();
      }
      this.receive(msg);
    });
    const drop = () => {
      if (this.clients.get(conn.peer)?.conn === conn) {
        this.clients.delete(conn.peer);
        this.publishOnline();
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'state') {
      this.callbacks.onSession(cleanSession(msg.session));
    } else if (msg.t === 'online' && Array.isArray(msg.ids)) {
      this.callbacks.onOnline(msg.ids.filter((id) => typeof id === 'string'));
    }
  }

  publishOnline() {
    if (this.role !== 'host') return;
    const ids = [this.playerId];
    this.clients.forEach((client) => {
      if (client.playerId && !ids.includes(client.playerId)) ids.push(client.playerId);
    });
    this.callbacks.onOnline(ids);
    this.clients.forEach(({ conn }) => conn.open && conn.send({ t: 'online', ids }));
  }

  // Called whenever our copy of the session changes. The hub passes it on to
  // everyone; a client sends it to the hub, which merges and passes it on.
  sendSession(session) {
    const msg = { t: 'state', session };
    if (this.role === 'host') {
      this.clients.forEach(({ conn }) => conn.open && conn.send(msg));
    } else if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(msg);
    }
  }

  tick() {
    if (this.stopped || this.status !== 'connected') return;
    const now = Date.now();
    if (this.role === 'host') {
      this.clients.forEach((client, key) => {
        if (now - client.lastSeen > STALE_MS) {
          client.conn.close();
          this.clients.delete(key);
          this.publishOnline();
        } else if (client.conn.open) {
          client.conn.send({ t: 'ping' });
        }
      });
    } else if (this.hostConn) {
      if (now - this.hostLastSeen > STALE_MS) {
        this.retry(true);
      } else if (this.hostConn.open) {
        this.hostConn.send({ t: 'ping' });
      }
    }
  }

  // `quick` is for "the hub went away": try to take over almost immediately,
  // with a little randomness so everyone left doesn't race for it at once.
  retry(quick = false) {
    this.teardown();
    this.setStatus('reconnecting');
    const base = quick && this.attempts === 0 ? 300 : Math.min(1000 * 2 ** this.attempts, 5000);
    this.attempts++;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.start(), base + Math.random() * 1500);
  }

  // Coming back to the tab: phones often drop connections in the background.
  wake() {
    if (this.stopped) return;
    if (this.status === 'reconnecting') {
      clearTimeout(this.retryTimer);
      this.attempts = 0;
      this.start();
    } else {
      this.tick();
    }
  }

  // Bumping the generation first means events fired by the peers we're about
  // to destroy are ignored instead of triggering another retry.
  teardown() {
    this.generation++;
    clearTimeout(this.connectTimer);
    this.clients.forEach(({ conn }) => conn.close());
    this.clients.clear();
    if (this.hostConn) this.hostConn.close();
    this.hostConn = null;
    if (this.peer) this.peer.destroy();
    this.peer = null;
    this.role = null;
    this.callbacks.onOnline([]);
  }

  // Page hidden for good (or put in the back/forward cache): let go of the
  // room id so someone else can take over. wake() picks it back up.
  suspend() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.teardown();
    this.setStatus('reconnecting');
  }

  stop() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.teardown();
  }
}

// `me` is this player's own entry ({ name, guesses }), or null before they've
// picked a name. `extra` is a session to merge in once (from a result link).
export const useRoomSession = (room, playerId, me, extra) => {
  const [session, setSession] = useState(() => {
    let initial = room ? loadSession(room) : EMPTY_SESSION;
    if (extra) initial = mergeSessions(initial, extra);
    return initial;
  });
  const [status, setStatus] = useState('connecting');
  const [online, setOnline] = useState([]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const connectionRef = useRef(null);

  const merge = useCallback((incoming) => {
    setSession((current) => mergeSessions(current, incoming));
  }, []);

  // Fold our own latest guesses and name into the session.
  const myGuessCount = me ? me.guesses.length : -1;
  const myName = me ? me.name : null;
  useEffect(() => {
    if (!room || !me) return;
    setSession((current) => {
      const ours = current.players[playerId];
      if (ours && ours.name === me.name && ours.guesses.length >= me.guesses.length) {
        return current;
      }
      return {
        players: {
          ...current.players,
          [playerId]: {
            name: me.name,
            guesses: ours && ours.guesses.length > me.guesses.length ? ours.guesses : me.guesses,
            updated: Date.now(),
          },
        },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, playerId, myGuessCount, myName]);

  useEffect(() => {
    if (!room) return;
    storage.set(`wordle-room-${room}`, JSON.stringify(session));
    if (connectionRef.current) connectionRef.current.sendSession(session);
  }, [room, session]);

  useEffect(() => {
    if (!room) return undefined;
    const connection = new RoomConnection(room, playerId, {
      getSession: () => sessionRef.current,
      onSession: merge,
      onStatus: setStatus,
      onOnline: setOnline,
    });
    connectionRef.current = connection;
    connection.start();

    const onVisible = () => {
      if (document.visibilityState === 'visible') connection.wake();
    };
    // Release the room id straight away so someone else can take over.
    const onLeave = () => connection.suspend();
    const onShow = (e) => e.persisted && connection.wake();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('pageshow', onShow);
      connection.stop();
      connectionRef.current = null;
    };
  }, [room, playerId, merge]);

  return { session, status, online };
};
