import './App.css';
import React, { useState, useEffect} from 'react';
import Cookies from 'js-cookie';
import wordleAnswers from './wordleAnswers.json';

const wordLength = 5;
const numberOfGuesses = 6;

// Timing of the tile flip when a guess is entered (matches the NYT game).
const flipDuration = 500;
const flipStagger = 300;
const revealDuration = flipStagger * (wordLength - 1) + flipDuration;

const wordleAnswerSet = new Set(wordleAnswers);

const gameUrl = (word) => window.location.origin + window.location.pathname + `?${btoa("word=" + word.toLowerCase())}`;

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
    if (activeGuess) {
      return ''
    } else if (index >= guess.length) {
      return '';
    } else if (guess[index] === word[index]) {
      return 'green'
    } else if (word.includes(guess[index]) && word.split(guess[index]).length > 1) {
      return 'yellow'
    } else {
      return 'gray'
    }
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

  const isRevealing = revealingRow !== null;
  const gameOver = guessIndex >= numberOfGuesses || previousGuesses.slice(0, guessIndex).includes(word);

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
    if (gameOver || isRevealing) {
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

    const urlParams = new URLSearchParams(atob(window.location.search.substring(1)));
    const args = {};
    for (let param of urlParams.entries()) {
      args[param[0]] = param[1];
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
          <div className="button new-game">
            <button className={`button-text new-game-button ${gameOver && !isRevealing ? 'game-over' : ''}`} onClick={() => {
              window.location.href = window.location.origin + window.location.pathname;
            }}><b>Make a new game!</b></button>
          </div>
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
