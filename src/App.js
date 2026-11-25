import './App.css';
import React, { useState, useEffect} from 'react';
import Cookies from 'js-cookie';
import wordleAnswers from './wordleAnswers.json';
import { scoreGuess } from './scoring';
import SessionPanel, { NamePrompt, playerOutcome } from './SessionPanel';
import {
  useRoomSession, newRoomId, isValidRoomId, getPlayerId, getSavedName, saveName, cleanName,
  encodeResult, decodeResult,
} from './session';

const wordLength = 5;
const numberOfGuesses = 6;

// Timing of the tile flip when a guess is entered (matches the NYT game).
const flipDuration = 500;
const flipStagger = 300;
const revealDuration = flipStagger * (wordLength - 1) + flipDuration;

const wordleAnswerSet = new Set(wordleAnswers);

// The query string is base64 of "word=...&room=...&r=..." so the answer isn't readable at a glance.
const gameUrl = (word, extra = {}) => {
  const params = new URLSearchParams({ word: word.toLowerCase(), ...extra });
  return window.location.origin + window.location.pathname + `?${btoa(params.toString())}`;
};

const parseUrlArgs = () => {
  try {
    return Object.fromEntries(new URLSearchParams(atob(window.location.search.substring(1))));
  } catch (e) {
    return {};
  }
};

const urlArgs = parseUrlArgs();
const room = isValidRoomId(urlArgs.room) && urlArgs.word ? urlArgs.room : null;
const sharedResult = room && urlArgs.r ? decodeResult(urlArgs.r) : null;
const playerId = getPlayerId();

const emojiGrid = (guesses, word) => guesses
  .map((guess) => scoreGuess(guess, word).map((c) => ({ green: '🟩', yellow: '🟨', gray: '⬜' })[c]).join(''))
  .join('\n');

// Share sheet on phones, clipboard elsewhere. Returns a message to show, if any.
const shareLink = async (text, url) => {
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return '';
    } catch (e) {
      if (e && e.name === 'AbortError') return '';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'Link copied';
  } catch (e) {
    window.prompt('Copy this link:', url);
    return '';
  }
};

const getKeyboardLetterColors = (guesses, answer) => {
  const colors = {};
  guesses.forEach((guess) => {
    guess.split('').forEach((letter, i) => {
      if (answer[i] === letter) {
        colors[letter] = "green";
      } else if (answer.includes(letter)) {
        if (colors[letter] !== "green") {
          colors[letter] = "yellow";
        }
      } else if (!colors[letter]) {
        colors[letter] = "gray";
      }
    });
  });
  return colors;
}

const WordleBoard = ({word, previousGuesses, guessIndex, invalidGuess, revealingRow}) => {

  const getLetterStatus = (guess, index, activeGuess) => {
    if (activeGuess || index >= guess.length) {
      return '';
    }
    return scoreGuess(guess, word)[index];
  }

  return (
    <div className="gameboard">
      {previousGuesses.map((guess, word_index) => (
        <div key={word_index} className={`gameboard-row ${(invalidGuess && guessIndex === word_index) ? "shake" : ""}`}>
          {[...Array(wordLength)].map((e, letter_index) => (
            <div
              key={letter_index}
              className={`letter ${getLetterStatus(guess, letter_index, guessIndex === word_index)} ${revealingRow === word_index ? "flip" : ""}`}
              style={revealingRow === word_index ? {
                animationDuration: `${flipDuration}ms`,
                animationDelay: `${letter_index * flipStagger}ms`,
              } : undefined}
            >
              <b>{guess.length > letter_index ? guess[letter_index].toUpperCase() : ''}</b>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const Keyboard = ({ handleKeyPress, letterColors}) => {
  const keys = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['ENTER','z', 'x', 'c', 'v', 'b', 'n', 'm','⌫'],
  ];

  const handleClick = (letter) => {
    handleKeyPress(letter);
  };

  return (
    <div className="keyboard">
      {keys.map((row) => (
        <div className="keyboard-row" key={row}>
          {row.map((letter) => (
            <button
              key={letter}
              className={`key ${letterColors[letter] ?? ''} ${letter === 'ENTER'?'enter':''} ${letter === '⌫' ? 'backspace' : ''}`}
              onClick={() => handleClick(letter)}
            >
              <b>{letter.toUpperCase()}</b>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

const WordleGame = () => {
  const [word, setWord] = useState('');
  const [previousGuesses, setPreviousGuesses] = useState(Array(numberOfGuesses).fill(''));
  const [guessIndex, setGuessIndex] = useState(0);
  const [scrabbleDictionary, setScrabbleDictionary] = useState(new Set());
  const [invalidGuess, setInvalidGuess] = useState(false);
  const [requestedWord, setRequestedWord] = useState('');
  const [invalidRequestedWord, setInvalidRequestedWord] = useState(false);
  // Index of the row whose letters are currently flipping over, or null.
  const [revealingRow, setRevealingRow] = useState(null);
  const [playerName, setPlayerName] = useState(getSavedName);
  const [namePromptOpen, setNamePromptOpen] = useState(room !== null && !getSavedName());

  const isRevealing = revealingRow !== null;
  const gameOver = guessIndex >= numberOfGuesses || previousGuesses.slice(0, guessIndex).includes(word);

  const submittedGuesses = previousGuesses.slice(0, guessIndex);
  const me = room && playerName && word ? { name: playerName, guesses: submittedGuesses } : null;
  const { session, status, online } = useRoomSession(room, playerId, me, sharedResult);

  const handleNameSubmit = (name) => {
    const clean = cleanName(name);
    saveName(clean);
    setPlayerName(clean);
    setNamePromptOpen(false);
  };

  const handleInvite = () => shareLink('Play this Wordle with me', gameUrl(word, { room }));

  const handleShareResult = () => {
    const mine = session.players[playerId];
    if (!mine) return Promise.resolve('');
    const outcome = playerOutcome(mine, word);
    const text = `Wordle Pick ${outcome.solved ? outcome.score : 'X'}/${numberOfGuesses}\n${emojiGrid(mine.guesses, word)}`;
    return shareLink(text, gameUrl(word, { room, r: encodeResult(playerId, mine) }));
  };

  const handlePlayWithFriends = () => {
    window.location.href = gameUrl(word, { room: newRoomId() });
  };

  // The keyboard and the new game button only catch up once the flip has finished.
  const keyboardLetterColors = getKeyboardLetterColors(
    previousGuesses.slice(0, isRevealing ? revealingRow : guessIndex),
    word
  );

  // The Scrabble dictionary is missing a couple of the official Wordle answers.
  const isValidWord = (candidate) => (
    scrabbleDictionary.has(candidate.toUpperCase()) || wordleAnswerSet.has(candidate.toLowerCase())
  );

  const handleKeyPress = (letter) => {
    if (gameOver || isRevealing || namePromptOpen) {
      return;
    }
    const newGuesses = [...previousGuesses];
    setInvalidGuess(false);
    if (letter === '⌫') {
      if (newGuesses[guessIndex].length > 0) {
        newGuesses[guessIndex] = newGuesses[guessIndex].slice(0, -1);
      }
    } else if (letter === 'ENTER') {
      if (newGuesses[guessIndex].length === wordLength && isValidWord(newGuesses[guessIndex])) {
        setRevealingRow(guessIndex);
        setGuessIndex(guessIndex + 1);
        Cookies.set(word, JSON.stringify(newGuesses));
      } else {
        setInvalidGuess(true);
      }
    } else if (newGuesses[guessIndex].length < wordLength) {
      newGuesses[guessIndex] = newGuesses[guessIndex].concat(letter);
    }

    setPreviousGuesses(newGuesses);
  };

  const handleWordCreation = (requestedWord) => {
    if (isValidWord(requestedWord)) {
      window.location.href = gameUrl(requestedWord);
    } else {
      setInvalidRequestedWord(true);
    }
  }

  const handleRandomWord = () => {
    window.location.href = gameUrl(wordleAnswers[Math.floor(Math.random() * wordleAnswers.length)]);
  }

  useEffect(() => {
    document.title = 'Wordle Pick';

    const args = urlArgs;
    // A result link has done its job once merged; keep the plain room link.
    if (args.r && room) {
      window.history.replaceState(null, '', gameUrl(args.word, { room }));
    }
    if ('word' in args) {
      setWord(args['word']);
      if (Cookies.get(args['word'])) {
        const savedGuesses = JSON.parse(Cookies.get(args['word']));
        setPreviousGuesses(savedGuesses);
        setGuessIndex(savedGuesses.filter((guess) => guess.length === wordLength).length);
      }
    }

    fetch(window.location.origin + window.location.pathname + 'dictionary.json')
    .then(response => response.json())
    .then(data => {
      setScrabbleDictionary(new Set(data.dictionary[wordLength-1]));
    });
  }, []);

  // Re-subscribed on every render so the handler always sees the current game state.
  useEffect(() => {
    function handleKeyDown(e) {
      if (word.length === 0 || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (e.target instanceof Element && e.target.closest('input, textarea')) {
        return;
      }
      const focusedButton = e.target instanceof Element ? e.target.closest('button') : null;
      if (focusedButton && !focusedButton.closest('.keyboard')) {
        return;
      }
      if (e.key === "Backspace") {
        handleKeyPress("⌫")
      } else if (e.key === "Enter") {
        // Otherwise Enter would also "click" the on-screen key that was pressed last.
        e.preventDefault();
        handleKeyPress("ENTER")
      } else if (/^[a-z]$/i.test(e.key)) {
        handleKeyPress(e.key.toLowerCase());
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    // Don't forget to clean up
    return function cleanup() {
      document.removeEventListener('keydown', handleKeyDown);
    }
  });

  useEffect(() => {
    if (revealingRow === null) {
      return;
    }
    const timer = setTimeout(() => setRevealingRow(null), revealDuration);
    return () => clearTimeout(timer);
  }, [revealingRow]);

  return (
    <div className="App">
      { word.length !== 0 &&
        <div className="game">
          <WordleBoard word={word} previousGuesses={previousGuesses} guessIndex={guessIndex} invalidGuess={invalidGuess} revealingRow={revealingRow}/>
          <Keyboard handleKeyPress={handleKeyPress} letterColors={keyboardLetterColors}/>
          { room &&
            <SessionPanel
              session={session}
              status={status}
              online={online}
              playerId={playerId}
              word={word}
              iAmDone={gameOver && !isRevealing}
              onInvite={handleInvite}
              onShareResult={handleShareResult}
              onRename={() => setNamePromptOpen(true)}
            />
          }
          <div className="button new-game">
            <button className={`button-text new-game-button ${gameOver && !isRevealing ? 'game-over' : ''}`} onClick={() => {
              window.location.href = window.location.origin + window.location.pathname;
            }}><b>Make a new game!</b></button>
            { !room &&
              <button className="button-text new-game-button friends-button" onClick={handlePlayWithFriends}>
                <b>Play with friends</b>
              </button>
            }
          </div>
          { room && namePromptOpen &&
            <NamePrompt
              initialName={playerName}
              onSubmit={handleNameSubmit}
              onCancel={playerName ? () => setNamePromptOpen(false) : null}
            />
          }
        </div>
      }

      { word.length === 0 &&
        <div>
          <div className="wordPickerText">
            <b>Pick a 5 letter word for people to guess</b>
          </div>
          <input className={`wordInput ${invalidRequestedWord? 'shake': ''}`} onChange={evt => {
            setRequestedWord(evt.target.value);
            setInvalidRequestedWord(false);
          }}>
          </input>
          <div className="button">
            <button className="button-text" onClick={() => handleWordCreation(requestedWord)}><b>Make Game!</b></button>
          </div>
          <div className="button">
            <button className="button-text" onClick={handleRandomWord}><b>Pick a random word</b></button>
          </div>
        </div>
      }
    </div>
  )
}

function App() {
  return (
    <WordleGame />
  );
}

export default App;
