import React, { useState } from 'react';
import { scoreGuess } from './scoring';

const MAX_GUESSES = 6;

export const playerOutcome = (player, word) => {
  const solvedAt = player.guesses.indexOf(word);
  if (solvedAt !== -1) return { done: true, solved: true, score: solvedAt + 1 };
  if (player.guesses.length >= MAX_GUESSES) return { done: true, solved: false, score: MAX_GUESSES + 1 };
  return { done: false, solved: false, score: MAX_GUESSES + 2 };
};

const outcomeText = (player, outcome) => {
  if (outcome.solved) return `Solved in ${outcome.score}`;
  if (outcome.done) return 'Out of guesses';
  if (player.guesses.length === 0) return 'Not started';
  return `Playing · ${player.guesses.length}/${MAX_GUESSES}`;
};

const statusText = (status, onlineCount) => {
  if (status === 'connected') {
    return onlineCount > 1 ? `Connected · ${onlineCount} here now` : 'Connected · waiting for friends';
  }
  if (status === 'reconnecting') return 'Reconnecting…';
  return 'Connecting…';
};

const MiniGrid = ({ guesses, word, showLetters }) => (
  <div className="mini-grid">
    {guesses.map((guess, row) => {
      const colors = scoreGuess(guess, word);
      return (
        <div className="mini-row" key={row}>
          {colors.map((color, i) => (
            <div className={`mini-tile ${color}`} key={i}>{showLetters ? guess[i].toUpperCase() : ''}</div>
          ))}
        </div>
      );
    })}
  </div>
);

const SessionPanel = ({ session, status, online, playerId, word, iAmDone, onInvite, onShareResult, onRename }) => {
  const [flash, setFlash] = useState('');

  const run = async (action) => {
    const message = await action();
    if (message) {
      setFlash(message);
      setTimeout(() => setFlash(''), 2500);
    }
  };

  const players = Object.entries(session.players)
    .map(([id, player]) => ({ id, player, outcome: playerOutcome(player, word) }))
    .sort((a, b) => a.outcome.score - b.outcome.score
      || b.player.guesses.length - a.player.guesses.length
      || a.player.name.localeCompare(b.player.name));

  return (
    <div className="session-panel">
      <div className="session-header">
        <b>Playing with friends</b>
        <span className={`session-status ${status}`}>
          <span className="dot" />{statusText(status, online.length)}
        </span>
      </div>

      <div className="session-actions">
        <button className="session-button" onClick={() => run(onInvite)}>Invite friends</button>
        <button className="session-button" disabled={!iAmDone} onClick={() => run(onShareResult)}
          title={iAmDone ? '' : 'Finish your game first'}>
          Share my result
        </button>
      </div>
      {flash && <div className="session-flash">{flash}</div>}

      <div className="session-players">
        {players.map(({ id, player, outcome }) => (
          <div className={`session-player ${id === playerId ? 'me' : ''}`} key={id}>
            <div className="session-player-name">
              <span className={`dot ${online.includes(id) ? 'online' : ''}`} />
              {player.name || 'Someone'}
              {id === playerId && <button className="rename" onClick={onRename}>(you · rename)</button>}
            </div>
            <div className="session-player-outcome">{outcomeText(player, outcome)}</div>
            <MiniGrid guesses={player.guesses} word={word} showLetters={iAmDone || id === playerId} />
          </div>
        ))}
      </div>
      {!iAmDone && players.length > 1 &&
        <div className="session-note">Other players' letters show up once you finish.</div>}
    </div>
  );
};

export const NamePrompt = ({ initialName, onSubmit, onCancel }) => {
  const [name, setName] = useState(initialName);
  const submit = (e) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name);
  };
  return (
    <div className="name-prompt-backdrop">
      <form className="name-prompt" onSubmit={submit}>
        <b>What should your friends call you?</b>
        <input autoFocus maxLength={20} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        <div className="session-actions">
          {onCancel && <button type="button" className="session-button secondary" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="session-button" disabled={!name.trim()}>Join game</button>
        </div>
      </form>
    </div>
  );
};

export default SessionPanel;
